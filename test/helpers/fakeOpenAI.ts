import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, any> | null;
  // 1-based count of POST /chat/completions so far.
  n: number;
}

export type Step =
  | { status: number; json?: unknown; text?: string; headers?: Record<string, string> }
  // Streamed SSE: each item is one `data:` payload (objects are JSON-encoded), [DONE] is added unless done is false.
  | { chunks: (object | string)[]; done?: boolean; cutAfter?: number; headers?: Record<string, string> }
  // A plain JSON chat.completion body, whatever the request asked.
  | { completion: object; headers?: Record<string, string> };

export interface Fake {
  url: string;
  requests: FakeRequest[];
  chats: () => FakeRequest[];
  close: () => Promise<void>;
}

// The server-side extras some servers add to `usage`: `estimated_cost`, the cache write count (null when not billed) and the reasoning tokens.
export interface UsageExtras {
  estimatedCost?: number;
  cached?: number;
  cacheWrite?: number | null;
  reasoning?: number | null;
}

export const usage = (prompt: number, completion: number, cost?: number, extras: UsageExtras = {}) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
  ...(cost !== undefined ? { cost } : {}),
  ...(extras.estimatedCost !== undefined ? { estimated_cost: extras.estimatedCost } : {}),
  ...(extras.cached !== undefined || extras.cacheWrite !== undefined ? { prompt_tokens_details: { ...(extras.cached !== undefined ? { cached_tokens: extras.cached } : {}), ...(extras.cacheWrite !== undefined ? { cache_write_tokens: extras.cacheWrite } : {}) } } : {}),
  ...(extras.reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: extras.reasoning } } : {}),
});

const chunk = (delta: object, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

// A streamed text answer split into pieces.
export function textStep(text: string, opts: { pieces?: number; usageTokens?: [number, number]; cost?: number; extras?: UsageExtras; tier?: string; requestId?: string; reasoning?: string; reasoningField?: string } = {}): Step {
  const size = Math.max(1, Math.ceil(text.length / (opts.pieces ?? 3)));
  const chunks: object[] = [chunk({ role: 'assistant', content: '' })];
  if (opts.reasoning) chunks.push(chunk({ [opts.reasoningField ?? 'reasoning_content']: opts.reasoning }));
  for (let i = 0; i < text.length; i += size) chunks.push(chunk({ content: text.slice(i, i + size) }));
  chunks.push(chunk({}, 'stop'));
  if (opts.usageTokens) chunks.push({ choices: [], usage: usage(opts.usageTokens[0], opts.usageTokens[1], opts.cost, opts.extras) });
  return withServerFacts({ chunks }, opts);
}

// The tier on the root of every chunk and the request id header, as a server that has them sends them.
function withServerFacts(step: { chunks: (object | string)[]; headers?: Record<string, string> }, o: { tier?: string; requestId?: string }): Step {
  const chunks = o.tier ? step.chunks.map((c) => (typeof c === 'string' ? c : { ...c, service_tier: o.tier })) : step.chunks;
  return { ...step, chunks, ...(o.requestId ? { headers: { 'x-request-id': o.requestId } } : {}) };
}

export interface FakeCall {
  id?: string;
  name: string;
  args: object | string;
}

// A streamed answer with tool calls: id and name first, then the arguments in two pieces, like OpenAI.
export function toolStep(calls: FakeCall[], opts: { text?: string; usageTokens?: [number, number]; cost?: number; extras?: UsageExtras; tier?: string; requestId?: string; finish?: string } = {}): Step {
  const chunks: object[] = [chunk({ role: 'assistant', content: opts.text ?? null })];
  calls.forEach((c, index) => {
    const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args);
    const mid = Math.max(1, Math.floor(args.length / 2));
    chunks.push(chunk({ tool_calls: [{ index, id: c.id ?? `call_${index + 1}`, type: 'function', function: { name: c.name, arguments: '' } }] }));
    chunks.push(chunk({ tool_calls: [{ index, function: { arguments: args.slice(0, mid) } }] }));
    chunks.push(chunk({ tool_calls: [{ index, function: { arguments: args.slice(mid) } }] }));
  });
  chunks.push(chunk({}, opts.finish ?? 'tool_calls'));
  if (opts.usageTokens) chunks.push({ choices: [], usage: usage(opts.usageTokens[0], opts.usageTokens[1], opts.cost, opts.extras) });
  return withServerFacts({ chunks }, opts);
}

export const errorStep = (status: number, message: string, extra: Record<string, unknown> = {}): Step => ({ status, json: { error: { message, ...extra } } });

// Serves /v1/chat/completions and /v1/models. `script` returns the step for each chat call; a function sees the request.
export async function fakeOpenAI(script: Step[] | ((req: FakeRequest) => Step), opts: { models?: object[]; auth?: string; modelsStatus?: number } = {}): Promise<Fake> {
  const requests: FakeRequest[] = [];
  let n = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const isChat = req.method === 'POST' && req.url?.endsWith('/chat/completions');
      const fr: FakeRequest = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null, n: isChat ? ++n : n };
      requests.push(fr);
      if (opts.auth && req.headers.authorization !== `Bearer ${opts.auth}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }));
      }
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        res.writeHead(opts.modelsStatus ?? 200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(opts.modelsStatus && opts.modelsStatus >= 400 ? { error: { message: 'nope' } } : { object: 'list', data: opts.models ?? [{ id: 'fake-model' }] }));
      }
      if (!isChat) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'not found' } }));
      }
      const step = typeof script === 'function' ? script(fr) : (script[fr.n - 1] ?? script[script.length - 1]);
      if ('status' in step) {
        res.writeHead(step.status, { 'content-type': 'application/json', ...step.headers });
        return res.end(step.text ?? JSON.stringify(step.json ?? {}));
      }
      if ('completion' in step) {
        res.writeHead(200, { 'content-type': 'application/json', ...step.headers });
        return res.end(JSON.stringify(step.completion));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', ...step.headers });
      const items = step.cutAfter !== undefined ? step.chunks.slice(0, step.cutAfter) : step.chunks;
      for (const c of items) res.write(`data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`);
      if (step.cutAfter !== undefined) return res.destroy();
      if (step.done !== false) res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    chats: () => requests.filter((r) => r.method === 'POST' && r.url.endsWith('/chat/completions')),
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}

// A port nothing listens on, for "connection refused".
export async function closedPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}
