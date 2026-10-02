// Upstream failures in Anthropic error shape, and the parameter fallbacks that make one request body work across OpenAI-compatible servers.
import { type Lang, msg } from './messages';
import { estimateTokens, type OpenAIRequest } from './openaiCore';

export type AnthropicErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'rate_limit_error'
  | 'api_error'
  | 'overloaded_error';

export interface AnthropicError {
  status: number;
  body: { type: 'error'; error: { type: AnthropicErrorType; message: string } };
  headers: Record<string, string>;
}

export interface ErrorContext {
  lang: Lang;
  model: string;
  // host:port of the upstream, for messages.
  host: string;
  inputEstimate?: number;
}

export function errorResponse(status: number, type: AnthropicErrorType, message: string, headers: Record<string, string> = {}): AnthropicError {
  return { status, body: { type: 'error', error: { type, message } }, headers };
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

// "prompt is too long: <actual> tokens > <limit> maximum" is the sentence the Claude Code binary reads to compact and retry.
function contextNumbers(message: string, estimate: number): { actual: number; limit: number } {
  const nums = [...message.matchAll(/\d[\d,]{2,}/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => n >= 256);
  if (nums.length >= 2) return { actual: Math.max(...nums), limit: Math.min(...nums) };
  if (nums.length === 1) return { actual: Math.max(estimate, nums[0] + 1), limit: nums[0] };
  return { actual: estimate, limit: Math.max(1, Math.floor(estimate * 0.8)) };
}

const CONTEXT_RE =
  /context[_ ]length|maximum context|context window|context size|exceeds? the (available )?context|too many tokens|prompt is too long|input is too long|reduce the length|token limit|exceed_context_size|n_ctx|requested \d+ tokens/i;
const NO_TOOLS_RE = /does not support tools|tool use is not supported|tools? (is|are) not supported|doesn't support tool|does not support function|no tool use|tool_use is not supported/i;
const MODEL_RE = /model[^.]*(not found|does not exist|is not supported|unknown|not available|not loaded|no longer available)|no such model|invalid model|unknown model|model_not_found/i;

export function mapUpstreamError(status: number, bodyText: string, headers: { get(name: string): string | null }, ctx: ErrorContext): AnthropicError {
  const parsed = parseUpstreamError(bodyText);
  const detail = parsed.message;
  const lower = `${detail} ${parsed.code ?? ''} ${parsed.type ?? ''}`.toLowerCase();
  const retryAfter = headers.get('retry-after');
  const extra: Record<string, string> = retryAfter ? { 'retry-after': retryAfter } : {};

  if (status === 401) return errorResponse(401, 'authentication_error', msg(ctx.lang, 'auth', { status, detail }));
  if (status === 403) return errorResponse(403, 'permission_error', msg(ctx.lang, 'forbidden', { status, detail }));
  if (status === 402 || parsed.code === 'insufficient_quota' || (status === 429 && /quota|billing|credit|balance/.test(lower))) {
    return errorResponse(429, 'rate_limit_error', msg(ctx.lang, 'quota', { detail }), { ...extra, 'x-should-retry': 'false' });
  }
  if (status === 429) return errorResponse(429, 'rate_limit_error', msg(ctx.lang, 'rateLimit', { detail }), extra);
  if ((status === 400 || status === 422) && NO_TOOLS_RE.test(lower)) {
    return errorResponse(400, 'invalid_request_error', msg(ctx.lang, 'noTools', { model: ctx.model, detail }));
  }
  if (status === 404 || parsed.code === 'model_not_found' || ((status === 400 || status === 422) && MODEL_RE.test(lower))) {
    const hint = isLocalHost(ctx.host) ? 'ollama list / GET /v1/models' : 'GET /v1/models';
    return errorResponse(404, 'not_found_error', msg(ctx.lang, 'modelNotFound', { model: ctx.model, detail, hint }));
  }
  if ([400, 413, 422].includes(status) && (CONTEXT_RE.test(lower) || parsed.code === 'context_length_exceeded')) {
    const { actual, limit } = contextNumbers(detail, ctx.inputEstimate ?? 0);
    return errorResponse(400, 'invalid_request_error', msg(ctx.lang, 'contextTooLong', { actual, limit, detail }));
  }
  if (status === 408 || status === 504) return errorResponse(504, 'api_error', msg(ctx.lang, 'timeout', { host: ctx.host }));
  if (status === 503 || status === 529) return errorResponse(status === 503 ? 503 : 529, 'overloaded_error', msg(ctx.lang, 'overloaded', { status, detail }), extra);
  if (status >= 500) return errorResponse(status === 500 ? 500 : 502, 'api_error', msg(ctx.lang, 'serverError', { status, detail }));
  return errorResponse(400, 'invalid_request_error', msg(ctx.lang, 'badRequest', { status, detail }));
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

export function mapNetworkError(err: unknown, ctx: ErrorContext): AnthropicError {
  const { code, message } = networkCode(err);
  const noRetry = { 'x-should-retry': 'false' };
  if (code === 'ECONNREFUSED') return errorResponse(502, 'api_error', msg(ctx.lang, 'connRefused', { host: ctx.host }), noRetry);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return errorResponse(502, 'api_error', msg(ctx.lang, 'hostNotFound', { host: ctx.host }), noRetry);
  if (/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(code)) {
    return errorResponse(504, 'api_error', msg(ctx.lang, 'timeout', { host: ctx.host }));
  }
  if (/CERT|TLS|SSL/.test(code)) return errorResponse(502, 'api_error', msg(ctx.lang, 'upstreamUnreachable', { host: ctx.host, detail: `${code} ${message}` }), noRetry);
  return errorResponse(502, 'api_error', msg(ctx.lang, 'connReset', { host: ctx.host, detail: code || message }));
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
export function adaptBodyForError(body: OpenAIRequest, status: number, message: string, learned: Learned): OpenAIRequest | null {
  if (status !== 400 && status !== 422) return null;
  const m = message.toLowerCase();
  const next: OpenAIRequest = { ...body };
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

export function inputEstimateOf(body: OpenAIRequest): number {
  return estimateTokens(body.messages) + estimateTokens(body.tools ?? []);
}
