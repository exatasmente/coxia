// OpenAI Chat Completions client: streaming with a JSON fallback, retries on transient failures, parameter fallbacks per server.
import { EngineError, type Learned, adaptBodyForError, mapHttpError, mapNetworkError, newLearned } from './errors';
import { type Lang, msg } from './messages';
import { SseParser, ThinkSplitter, newId } from './text';
import type { ChatChunk, ChatMessage, ChatRequest, ChatResponse, Completion, Json, ToolCall, ToolChoice, ToolDef, Usage } from './types';

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  // Extra headers some gateways want (OpenRouter's HTTP-Referer, X-Title).
  headers?: Record<string, string>;
  lang?: Lang;
  // Cap on the output of one call; the server's own default when absent.
  maxOutputTokens?: number;
  temperature?: number;
  // false asks for a plain JSON body instead of SSE (a few servers break one or the other).
  stream?: boolean;
  // Whole-call limit. Local models can take minutes to load and to read a long prompt.
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  // Base delay of the transient retry backoff (tests set it to 0).
  retryDelayMs?: number;
  maxRetries?: number;
}

// The user may paste http://localhost:11434, http://localhost:11434/v1 or the full .../chat/completions URL.
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
  try {
    const u = new URL(url);
    if (u.pathname === '' || u.pathname === '/') return `${u.origin}/v1`;
  } catch {
    // leave it: the request will fail with a clear message
  }
  return url;
}

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export interface CallOptions {
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
  responseFormat?: Json;
  maxTokens?: number;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

interface ToolAcc {
  id: string;
  idKnown: boolean;
  name: string;
  args: string;
  index?: number;
}

function completeJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Folds the chunks of one streamed answer (or the one message of a plain JSON answer) into a Completion.
export class ChunkFolder {
  private text = '';
  private reasoning = '';
  private tools: ToolAcc[] = [];
  private finish: string | null = null;
  private usage: Completion['usage'] = null;
  private field: Completion['reasoningField'] = null;
  private split = new ThinkSplitter();
  error: unknown = null;

  constructor(private hooks: { onText?: (t: string) => void; onReasoning?: (t: string) => void } = {}) {}

  private piece(kind: 'text' | 'thinking', text: string): void {
    if (!text) return;
    if (kind === 'text') {
      this.text += text;
      this.hooks.onText?.(text);
    } else {
      this.reasoning += text;
      this.hooks.onReasoning?.(text);
    }
  }

  push(chunk: ChatChunk): void {
    if (chunk.error !== undefined && chunk.error !== null) {
      this.error = chunk.error;
      return;
    }
    if (chunk.usage) this.usage = foldUsage(chunk.usage);
    const choice = chunk.choices?.find((c) => (c.index ?? 0) === 0);
    if (!choice) return;
    const d = choice.delta ?? {};
    if (d.reasoning_content) {
      this.field = 'reasoning_content';
      this.piece('thinking', d.reasoning_content);
    } else if (d.reasoning) {
      this.field = this.field ?? 'reasoning';
      this.piece('thinking', d.reasoning);
    }
    if (d.content) for (const p of this.split.feed(d.content)) this.piece(p.kind, p.text);
    if (d.refusal) this.piece('text', d.refusal);
    for (const tc of d.tool_calls ?? []) this.tool(tc);
    if (choice.finish_reason) this.finish = choice.finish_reason;
  }

  private tool(tc: NonNullable<NonNullable<NonNullable<ChatChunk['choices']>[number]['delta']>['tool_calls']>[number]): void {
    const idx = typeof tc.index === 'number' ? tc.index : undefined;
    const id = tc.id || undefined;
    const name = tc.function?.name || undefined;
    const args = tc.function?.arguments ?? '';
    const cur = this.tools[this.tools.length - 1];
    let startsNew = !cur;
    if (cur) {
      if (id && cur.idKnown && id !== cur.id) startsNew = true;
      else if (idx !== undefined && cur.index !== undefined && idx !== cur.index) startsNew = true;
      // Servers that number every parallel call 0 and omit the id: a call that already holds complete JSON is finished.
      else if (!id && name && cur.name && cur.args && completeJson(cur.args)) startsNew = true;
    }
    if (startsNew || !cur) {
      this.tools.push({ id: id ?? newId('call'), idKnown: !!id, name: name ?? '', args, index: idx });
      return;
    }
    if (id && !cur.idKnown) {
      cur.id = id;
      cur.idKnown = true;
    }
    if (name && !cur.name) cur.name = name;
    cur.args += args;
  }

  fromResponse(res: ChatResponse): void {
    if (res.error !== undefined && res.error !== null) {
      this.error = res.error;
      return;
    }
    if (res.usage) this.usage = foldUsage(res.usage);
    const choice = res.choices?.[0];
    const m = choice?.message;
    if (!m) return;
    const reasoning = m.reasoning_content ?? m.reasoning;
    if (reasoning) {
      this.field = m.reasoning_content ? 'reasoning_content' : 'reasoning';
      this.piece('thinking', reasoning);
    }
    for (const p of [...this.split.feed(m.content ?? ''), ...this.split.flush()]) this.piece(p.kind, p.text);
    if (m.refusal) this.piece('text', m.refusal);
    for (const tc of m.tool_calls ?? []) {
      this.tools.push({ id: tc.id || newId('call'), idKnown: !!tc.id, name: tc.function?.name ?? '', args: tc.function?.arguments ?? '' });
    }
    this.finish = choice?.finish_reason ?? null;
  }

  result(): Completion {
    for (const p of this.split.flush()) this.piece(p.kind, p.text);
    const toolCalls: ToolCall[] = this.tools
      .filter((t) => t.name)
      .map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args } }));
    return { text: this.text, reasoning: this.reasoning, toolCalls, finishReason: this.finish, usage: this.usage, reasoningField: this.field };
  }
}

function foldUsage(u: Usage): NonNullable<Completion['usage']> {
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
  return { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, cachedTokens: cached };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}

export class ChatClient {
  readonly baseUrl: string;
  readonly learned: Learned;
  private lang: Lang;
  private fetchImpl: typeof fetch;

  constructor(readonly cfg: ProviderConfig, learned?: Learned) {
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    this.learned = learned ?? newLearned();
    this.lang = cfg.lang ?? 'pt-BR';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  get host(): string {
    return hostOf(this.baseUrl);
  }

  private headers(stream: boolean): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
      ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      ...this.cfg.headers,
    };
  }

  private build(o: CallOptions): ChatRequest {
    const stream = this.cfg.stream !== false;
    const messages = this.learned.echoReasoning ? o.messages : o.messages.map(({ reasoning_content: _r, ...m }) => m as ChatMessage);
    const body: ChatRequest = { model: this.cfg.model, messages };
    if (stream) {
      body.stream = true;
      if (!this.learned.dropParams.has('stream_options')) body.stream_options = { include_usage: true };
    }
    const cap = o.maxTokens ?? this.cfg.maxOutputTokens;
    const limit = this.learned.maxOutputTokens;
    const maxTokens = cap && limit ? Math.min(cap, limit) : cap ?? limit;
    if (maxTokens) body[this.learned.maxTokensField ?? 'max_tokens'] = maxTokens;
    if (this.cfg.temperature !== undefined && !this.learned.dropParams.has('temperature')) body.temperature = this.cfg.temperature;
    if (o.tools?.length) {
      body.tools = o.tools;
      if (o.toolChoice && !this.learned.dropParams.has('tool_choice')) body.tool_choice = o.toolChoice;
    }
    if (o.responseFormat && !this.learned.dropParams.has('response_format')) body.response_format = o.responseFormat;
    return body;
  }

  async complete(o: CallOptions): Promise<Completion> {
    const timeout = this.cfg.timeoutMs ?? 15 * 60_000;
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const ctx = { lang: this.lang, model: this.cfg.model, host: this.host };
    let body = this.build(o);
    let transient = 0;
    let adapted = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(body.stream === true), body: JSON.stringify(body), signal });
      } catch (e) {
        const err = this.aborted(e, o.signal, ctx) ?? mapNetworkError(e, ctx);
        if (err.retryable && transient < (this.cfg.maxRetries ?? 2)) {
          await sleep((this.cfg.retryDelayMs ?? 1000) * 2 ** transient++, o.signal);
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = mapHttpError(res.status, text, res.headers, ctx);
        const retryBody = adapted < 4 ? adaptBodyForError(body, res.status, text, this.learned) : null;
        if (retryBody) {
          adapted++;
          body = retryBody;
          continue;
        }
        if (err.retryable && transient < (this.cfg.maxRetries ?? 2)) {
          await sleep(err.retryAfterMs ?? (this.cfg.retryDelayMs ?? 1000) * 2 ** transient++, o.signal);
          continue;
        }
        throw err;
      }
      try {
        const folder = new ChunkFolder({ onText: o.onText, onReasoning: o.onReasoning });
        const type = res.headers.get('content-type') ?? '';
        if (body.stream && /event-stream/i.test(type) && res.body) await this.readStream(res.body, folder);
        else folder.fromResponse(JSON.parse(await res.text()) as ChatResponse);
        if (folder.error !== null) throw this.streamError(folder.error, ctx);
        const done = folder.result();
        if (done.reasoningField === 'reasoning_content') this.learned.echoReasoning = true;
        return done;
      } catch (e) {
        if (e instanceof EngineError) throw e;
        const aborted = this.aborted(e, o.signal, ctx);
        if (aborted) throw aborted;
        if (e instanceof SyntaxError) throw new EngineError(msg(this.lang, 'invalidUpstream', { detail: e.message }), 'invalid_response');
        throw new EngineError(msg(this.lang, 'streamBroken', { detail: mapNetworkError(e, ctx).message }), 'network', undefined, true);
      }
    }
  }

  private streamError(error: unknown, ctx: { lang: Lang; model: string; host: string }): EngineError {
    const text = typeof error === 'string' ? error : JSON.stringify({ error });
    return mapHttpError(500, text, new Headers(), ctx);
  }

  private aborted(e: unknown, outer: AbortSignal | undefined, ctx: { lang: Lang; host: string }): EngineError | null {
    const name = (e as { name?: string })?.name;
    if (outer?.aborted) return new EngineError('aborted', 'aborted');
    if (name === 'TimeoutError') return mapNetworkError({ code: 'ETIMEDOUT', message: 'timeout' }, { ...ctx, model: this.cfg.model });
    return null;
  }

  private async readStream(stream: ReadableStream<Uint8Array>, folder: ChunkFolder): Promise<void> {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    const feed = (datas: string[]) => {
      for (const data of datas) {
        if (data.trim() === '[DONE]') continue;
        try {
          folder.push(JSON.parse(data) as ChatChunk);
        } catch {
          // a keep-alive or a partial line from a misbehaving server
        }
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(parser.push(decoder.decode(value, { stream: true })));
    }
    feed(parser.push(decoder.decode()));
    feed(parser.flush());
  }

  async listModels(signal?: AbortSignal): Promise<{ ids: string[]; raw: Json[] }> {
    const res = await this.fetchImpl(`${this.baseUrl}/models`, { headers: this.headers(false), signal: signal ?? AbortSignal.timeout(10_000) });
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''), res.headers, { lang: this.lang, model: this.cfg.model, host: this.host });
    const json = (await res.json()) as { data?: Json[]; models?: Json[] };
    const raw = json.data ?? json.models ?? [];
    const ids = raw.map((m) => String(m.id ?? m.name ?? m.model ?? '')).filter(Boolean);
    return { ids, raw };
  }
}
