// Upstream failures as typed errors, and the parameter fallbacks that make one request body work across OpenAI-compatible servers.
import { budgetRefusal } from '../budget';
import { type Lang, msg } from './messages';
import { estimateTokens } from './text';
import type { ChatRequest } from './types';

export type ErrorKind =
  | 'auth'
  | 'forbidden'
  | 'budget'
  | 'not_found'
  | 'rate_limit'
  | 'quota'
  | 'context'
  | 'no_tools'
  | 'bad_request'
  | 'server'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'aborted'
  | 'invalid_response';

export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly status?: number,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface ErrorContext {
  lang: Lang;
  model: string;
  // host:port of the upstream, for messages.
  host: string;
}

export interface ParsedUpstreamError {
  message: string;
  type?: string;
  code?: string;
}

export function parseUpstreamError(text: string): ParsedUpstreamError {
  const trimmed = text.trim();
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { message: trimmed.replace(/\s+/g, ' ').slice(0, 300) };
  }
  if (Array.isArray(json)) json = json[0];
  if (typeof json === 'string') return { message: json.slice(0, 300) };
  if (!json || typeof json !== 'object') return { message: trimmed.slice(0, 300) };
  const root = json as Record<string, unknown>;
  const e = root.error;
  const holder = e && typeof e === 'object' ? (e as Record<string, unknown>) : root;
  const raw = typeof e === 'string' ? e : holder.message ?? root.detail ?? root.message;
  const message = typeof raw === 'string' ? raw : raw === undefined ? trimmed : JSON.stringify(raw);
  const type = typeof holder.type === 'string' ? holder.type : undefined;
  const code = holder.code !== undefined && holder.code !== null ? String(holder.code) : undefined;
  return { message: message.replace(/\s+/g, ' ').slice(0, 400), type, code };
}

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.|\[::1\]|::1|0\.0\.0\.0)/.test(host);
}

const CONTEXT_RE =
  /context[_ ]length|maximum context|context window|context size|exceeds? the (available )?context|too many tokens|prompt is too long|input is too long|reduce the length|token limit|exceed_context_size|n_ctx|requested \d+ tokens/i;
const NO_TOOLS_RE = /does not support tools|tool use is not supported|tools? (is|are) not supported|doesn't support tool|does not support function|no tool use|tool_use is not supported/i;
const MODEL_RE = /model[^.]*(not found|does not exist|is not supported|unknown|not available|not loaded|no longer available)|no such model|invalid model|unknown model|model_not_found/i;

function retryAfterMs(headers: { get(name: string): string | null }): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs, 60) * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 60_000) : undefined;
}

export function mapHttpError(status: number, bodyText: string, headers: { get(name: string): string | null }, ctx: ErrorContext): EngineError {
  const parsed = parseUpstreamError(bodyText);
  const detail = parsed.message;
  const lower = `${detail} ${parsed.code ?? ''} ${parsed.type ?? ''}`.toLowerCase();
  const wait = retryAfterMs(headers);

  if (status === 401) return new EngineError(msg(ctx.lang, 'auth', { status, detail }), 'auth', status);
  // A refusal by budget, not a failure: the runner waits on it instead of spending an attempt. The 403 is read by its body, never by the word "authenticate".
  if (budgetRefusal(status, detail)) return new EngineError(msg(ctx.lang, 'budget', { status, provider: ctx.host, detail }), 'budget', status);
  if (status === 403) return new EngineError(msg(ctx.lang, 'forbidden', { status, detail }), 'forbidden', status);
  if (status === 402 || parsed.code === 'insufficient_quota' || (status === 429 && /quota|billing|credit|balance/.test(lower))) {
    return new EngineError(msg(ctx.lang, 'quota', { detail }), 'quota', status);
  }
  if (status === 429) return new EngineError(msg(ctx.lang, 'rateLimit', { detail }), 'rate_limit', status, true, wait);
  if ((status === 400 || status === 422) && NO_TOOLS_RE.test(lower)) return new EngineError(msg(ctx.lang, 'noTools', { model: ctx.model, detail }), 'no_tools', status);
  if (status === 404 || parsed.code === 'model_not_found' || ((status === 400 || status === 422) && MODEL_RE.test(lower))) {
    // i18n-ignore: command the person is told to run
    const hint = isLocalHost(ctx.host) ? 'ollama list / GET /v1/models' : 'GET /v1/models';
    return new EngineError(msg(ctx.lang, 'modelNotFound', { model: ctx.model, detail, hint }), 'not_found', status);
  }
  if ([400, 413, 422].includes(status) && (CONTEXT_RE.test(lower) || parsed.code === 'context_length_exceeded')) {
    return new EngineError(msg(ctx.lang, 'contextTooLong', { detail }), 'context', status);
  }
  if (status === 408 || status === 504) return new EngineError(msg(ctx.lang, 'timeout', { host: ctx.host }), 'timeout', status, true);
  if (status === 503 || status === 529) return new EngineError(msg(ctx.lang, 'overloaded', { status, detail }), 'overloaded', status, true, wait);
  if (status >= 500) return new EngineError(msg(ctx.lang, 'serverError', { status, detail }), 'server', status, true, wait);
  return new EngineError(msg(ctx.lang, 'badRequest', { status, detail }), 'bad_request', status);
}

interface NetworkLike {
  code?: string;
  name?: string;
  message?: string;
  cause?: unknown;
}

function networkCode(err: unknown): { code: string; message: string } {
  let cur = err as NetworkLike | undefined;
  let message = cur?.message ?? String(err);
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.code) return { code: cur.code, message: cur.message ?? message };
    cur = cur.cause as NetworkLike | undefined;
    if (cur?.message) message = cur.message;
  }
  return { code: '', message };
}

export function mapNetworkError(err: unknown, ctx: ErrorContext): EngineError {
  const { code, message } = networkCode(err);
  if (code === 'ECONNREFUSED') return new EngineError(msg(ctx.lang, 'connRefused', { host: ctx.host }), 'network');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new EngineError(msg(ctx.lang, 'hostNotFound', { host: ctx.host }), 'network');
  if (/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(code)) {
    return new EngineError(msg(ctx.lang, 'timeout', { host: ctx.host }), 'timeout', undefined, true);
  }
  if (/CERT|TLS|SSL/.test(code)) return new EngineError(msg(ctx.lang, 'upstreamUnreachable', { host: ctx.host, detail: `${code} ${message}` }), 'network');
  return new EngineError(msg(ctx.lang, 'connReset', { host: ctx.host, detail: code || message }), 'network', undefined, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Parameter fallbacks. OpenAI-compatible servers disagree on small things: max_tokens vs max_completion_tokens, the cap on the output,
// temperature on reasoning models, tool_choice, stream_options. A 400 that names the culprit is fixed once and remembered.

export interface Learned {
  dropParams: Set<string>;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  maxOutputTokens?: number;
  // The upstream sent reasoning_content, so it expects it back on assistant turns with tool calls.
  echoReasoning?: boolean;
  // The model answered that it cannot use tools: the engine stops offering them.
  noTools?: boolean;
  // The server refused a request with an image: images are replaced by a line from then on, and Read says the model does not see them.
  noImages?: boolean;
}

export function newLearned(): Learned {
  return { dropParams: new Set() };
}

const DROPPABLE = ['stream_options', 'parallel_tool_calls', 'tool_choice', 'response_format', 'temperature', 'top_p', 'stop'];

function outputLimit(message: string, current: number): number | null {
  const vllm = message.match(/(\d+)\s*>\s*(\d+)\s*-\s*(\d+)/);
  if (vllm) {
    const room = Number(vllm[2]) - Number(vllm[3]);
    return room > 0 && room < current ? room : null;
  }
  const nums = [...message.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => n >= 64 && n < current);
  return nums.length ? Math.max(...nums) : null;
}

// Returns the body to retry with, or null when the error is not one of the known parameter complaints.
const hasImage = (body: ChatRequest): boolean => body.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'));

/** The messages with every image replaced by a line that says one was there: what a server that takes no image gets. */
export function withoutImages(messages: ChatRequest['messages'], note: string): ChatRequest['messages'] {
  return messages.map((m) => (Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url') ? { ...m, content: m.content.map((c) => (c.type === 'image_url' ? { type: 'text' as const, text: note } : c)) } : m));
}

export function adaptBodyForError(body: ChatRequest, status: number, message: string, learned: Learned, imageNote = '[image]'): ChatRequest | null {
  if (status !== 400 && status !== 422) return null;
  const m = message.toLowerCase();
  const next: ChatRequest = { ...body };
  // A model that takes no image says so in many words; the request goes again without them, and the client stops sending any.
  if (hasImage(body) && /image|vision|multimodal|multi-modal|image_url|content type|content part/.test(m)) {
    learned.noImages = true;
    next.messages = withoutImages(body.messages, imageNote);
    return next;
  }
  if (next.max_tokens !== undefined && /max_completion_tokens/.test(m)) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
    learned.maxTokensField = 'max_completion_tokens';
    return next;
  }
  const field = next.max_tokens !== undefined ? 'max_tokens' : next.max_completion_tokens !== undefined ? 'max_completion_tokens' : null;
  if (field && /max_tokens|max_completion_tokens|max_output|output tokens/.test(m)) {
    const current = next[field] as number;
    if (/unsupported|not supported|unknown|unrecognized/.test(m) && field === 'max_completion_tokens' && !/range|less than|at most|maximum|too large/.test(m)) {
      next.max_tokens = current;
      delete next.max_completion_tokens;
      learned.maxTokensField = 'max_tokens';
      return next;
    }
    const limit = outputLimit(m, current);
    if (limit) {
      next[field] = limit;
      learned.maxOutputTokens = limit;
      return next;
    }
  }
  for (const param of DROPPABLE) {
    if (param in next && new RegExp(`\\b${param}\\b`).test(m)) {
      delete next[param];
      learned.dropParams.add(param);
      return next;
    }
  }
  return null;
}

export function requestEstimate(body: ChatRequest): number {
  return estimateTokens(body.messages) + estimateTokens(body.tools ?? []);
}
