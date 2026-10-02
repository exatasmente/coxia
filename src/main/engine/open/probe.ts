// "Testar conexão" of the provider wizard: is the server reachable, which models it lists, and whether a plain completion, a tool call
// and response_format json_schema work. The capability flags feed the engine's choices (tools on/off, structured output strategy).
import { ChatClient, normalizeBaseUrl } from './client';
import { EngineError } from './errors';
import { type Lang, msg } from './messages';
import { validate } from './schema';
import { parseToolArguments } from './text';
import type { Json } from './types';

export interface ProbeStep {
  ok: boolean;
  ms?: number;
  detail?: string;
}

export interface ProbeCapabilities {
  chat: boolean;
  tools: boolean;
  jsonSchema: boolean;
  streaming: boolean;
  reasoning: boolean;
  contextWindow?: number;
}

export interface ProbeResult {
  baseUrl: string;
  reachable: boolean;
  // Chat works. Tools and json_schema are reported separately: a model without them can still run in degraded mode.
  ok: boolean;
  models: ProbeStep & { ids: string[]; modelListed: boolean };
  chat: ProbeStep;
  tools: ProbeStep;
  jsonSchema: ProbeStep;
  capabilities: ProbeCapabilities;
  // Human readable lines for the wizard, in the requested language.
  messages: string[];
  ms: number;
}

export interface ProbeOptions {
  lang?: Lang;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  // Per call; a local model may need minutes to load.
  timeoutMs?: number;
}

const ECHO_TOOL = {
  type: 'function' as const,
  function: {
    name: 'echo',
    description: 'Repeats the given text.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
};

const PROBE_SCHEMA: Json = {
  type: 'object',
  properties: { answer: { type: 'string' }, n: { type: 'integer' } },
  required: ['answer', 'n'],
  additionalProperties: false,
};

function contextOf(raw: Json[], model: string): number | undefined {
  const m = raw.find((x) => String(x.id ?? x.name ?? x.model) === model);
  if (!m) return undefined;
  const meta = (m.meta ?? {}) as Json;
  const candidates = [m.context_length, m.max_model_len, m.context_window, m.loaded_context_length, m.max_context_length, meta.n_ctx_train, meta.n_ctx];
  const n = candidates.find((c) => typeof c === 'number' && c > 0);
  return typeof n === 'number' ? n : undefined;
}

export async function probeOpenAIProvider(baseUrl: string, key: string, model: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const lang = opts.lang ?? 'pt-BR';
  const started = Date.now();
  const url = normalizeBaseUrl(baseUrl);
  const messages: string[] = [];
  const mk = (stream: boolean) =>
    new ChatClient({ baseUrl: url, apiKey: key || undefined, model, lang, stream, fetchImpl: opts.fetchImpl, maxRetries: 0, timeoutMs: opts.timeoutMs ?? 120_000 });
  const client = mk(true);
  const result: ProbeResult = {
    baseUrl: url,
    reachable: false,
    ok: false,
    models: { ok: false, ids: [], modelListed: false },
    chat: { ok: false },
    tools: { ok: false },
    jsonSchema: { ok: false },
    capabilities: { chat: false, tools: false, jsonSchema: false, streaming: false, reasoning: false },
    messages,
    ms: 0,
  };
  const finish = (): ProbeResult => {
    result.ms = Date.now() - started;
    return result;
  };

  // 1. reachability and model list
  try {
    const t = Date.now();
    const { ids, raw } = await client.listModels(opts.signal);
    result.reachable = true;
    result.models = { ok: true, ids, modelListed: ids.includes(model), ms: Date.now() - t };
    messages.push(msg(lang, 'probeModelsOk', { count: ids.length }));
    if (!ids.includes(model) && ids.length) messages.push(msg(lang, 'probeModelMissing', { model, hint: ids.slice(0, 3).join(', ') }));
    const ctx = contextOf(raw, model);
    if (ctx) {
      result.capabilities.contextWindow = ctx;
      messages.push(msg(lang, 'probeContext', { tokens: ctx }));
      if (ctx < 12_000) messages.push(msg(lang, 'probeSmallContext', { tokens: ctx }));
    }
  } catch (e) {
    const err = e as EngineError;
    if (err.kind === 'network' && /conex|recusada|DNS|endereço|connect|refused/i.test(err.message)) {
      messages.push(msg(lang, 'probeUnreachable', { url, detail: err.message }));
      result.models.detail = err.message;
      return finish();
    }
    result.reachable = err.kind !== 'network';
    result.models.detail = err.message;
    if (err.kind === 'auth' || err.kind === 'forbidden') {
      messages.push(err.message);
      return finish();
    }
    messages.push(msg(lang, 'probeModelsFail', { detail: err.message }));
  }

  // 2. plain completion (streaming first, then plain JSON)
  const plain = async (c: ChatClient) => {
    const t = Date.now();
    const out = await c.complete({ messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 256, signal: opts.signal });
    return { out, ms: Date.now() - t };
  };
  try {
    const { out, ms } = await plain(client);
    result.chat = { ok: true, ms };
    result.capabilities.streaming = true;
    result.capabilities.reasoning = out.reasoning.length > 0;
    messages.push(msg(lang, 'probePlainOk', { ms }));
    if (out.reasoning) messages.push(msg(lang, 'probeReasoning'));
    if (ms > 60_000) messages.push(msg(lang, 'probeSlow', { ms }));
  } catch (e) {
    const err = e as EngineError;
    if (err.kind === 'network' || err.kind === 'invalid_response') {
      try {
        const { ms } = await plain(mk(false));
        result.chat = { ok: true, ms };
        messages.push(msg(lang, 'probePlainOk', { ms }));
      } catch (e2) {
        result.chat = { ok: false, detail: (e2 as Error).message };
        messages.push(msg(lang, 'probePlainFail', { detail: (e2 as Error).message }));
        return finish();
      }
    } else {
      result.chat = { ok: false, detail: err.message };
      result.reachable = true;
      messages.push(msg(lang, 'probePlainFail', { detail: err.message }));
      return finish();
    }
  }
  result.capabilities.chat = true;
  result.ok = true;

  // 3. tool call
  try {
    const t = Date.now();
    const out = await client.complete({
      messages: [{ role: 'user', content: 'Call the echo tool with the text "ola". Do not answer in text.' }],
      tools: [ECHO_TOOL],
      toolChoice: 'auto',
      maxTokens: 256,
      signal: opts.signal,
    });
    const ms = Date.now() - t;
    const call = out.toolCalls.find((c) => c.function.name === 'echo');
    if (!call) {
      result.tools = { ok: false, ms, detail: msg(lang, 'probeToolsNoCall') };
      messages.push(msg(lang, 'probeToolsNoCall'));
    } else if (typeof parseToolArguments(call.function.arguments).text !== 'string') {
      result.tools = { ok: false, ms, detail: msg(lang, 'probeToolsBadArgs') };
      messages.push(msg(lang, 'probeToolsBadArgs'));
    } else {
      result.tools = { ok: true, ms };
      result.capabilities.tools = true;
      messages.push(msg(lang, 'probeToolsOk', { ms }));
    }
  } catch (e) {
    result.tools = { ok: false, detail: (e as Error).message };
    messages.push(msg(lang, 'probeToolsFail', { detail: (e as Error).message }));
  }

  // 4. response_format json_schema
  try {
    const t = Date.now();
    const out = await client.complete({
      messages: [{ role: 'user', content: 'Return a JSON object with answer "ok" and n 1.' }],
      responseFormat: { type: 'json_schema', json_schema: { name: 'probe', schema: PROBE_SCHEMA, strict: false } },
      maxTokens: 256,
      signal: opts.signal,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(out.text.trim());
    } catch {
      parsed = undefined;
    }
    const dropped = client.learned.dropParams.has('response_format');
    const ok = !dropped && parsed !== undefined && validate(parsed, PROBE_SCHEMA).length === 0;
    result.jsonSchema = { ok, ms: Date.now() - t, ...(ok ? {} : { detail: dropped ? 'response_format recusado pelo servidor' : 'resposta fora do esquema' }) };
    result.capabilities.jsonSchema = ok;
  } catch (e) {
    result.jsonSchema = { ok: false, detail: (e as Error).message };
  }
  return finish();
}
