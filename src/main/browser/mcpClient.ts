import { type ChildProcess, type SpawnOptions, spawn as nodeSpawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

// The smallest client of the Model Context Protocol the app needs, over the standard input and output of a child: initialize, `tools/list`, `tools/call`. It exists so the
// app can sit between an agent and the Playwright MCP server (see `intermediary.ts`) without taking the protocol's SDK into the main process: the SDK is only a transitive
// dependency of the engines and is not in the public package. Messages are one JSON object per line (the protocol's stdio framing). No other new dependency.

export type McpErrorCode = 'timeout' | 'closed' | 'aborted' | 'protocol' | 'rpc';

export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    /** The JSON-RPC error code, for `rpc`. */
    readonly rpcCode?: number,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { type?: string; properties?: Record<string, McpProp>; required?: string[]; additionalProperties?: boolean };
}

export interface McpProp {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: McpProp;
  properties?: Record<string, McpProp>;
  required?: string[];
  [key: string]: unknown;
}

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: string; [key: string]: unknown };

export interface McpResult {
  content: McpContent[];
  isError?: boolean;
}

/** What of a child process the client uses; a `ChildProcess` is one. */
export interface McpChild {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit' | 'error', fn: (...args: unknown[]) => void): unknown;
}

export interface McpClientOptions {
  /** How long to wait for an answer when a call does not say (ms). */
  timeoutMs?: number;
  /** The most one line of the server may weigh; a longer one ends the connection. */
  lineMax?: number;
  /** The most of the server's standard error kept. */
  stderrMax?: number;
  clientName?: string;
}

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface McpClient {
  /** The handshake. Resolves with the server's name; the connection is used only after it. */
  initialize(): Promise<{ server: string; protocol: string }>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: CallOptions): Promise<McpResult>;
  /** The end of what the server wrote on its standard error, for the line that says why it failed. */
  stderrTail(): string;
  readonly closed: boolean;
  /** Told once when the server's output ends (it exited or was closed). */
  onClose(fn: () => void): void;
  /** Stops the server and rejects whatever waits. Idempotent. */
  close(): Promise<void>;
}

const PROTOCOL = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 60_000;
const LINE_MAX = 32 * 1024 * 1024;
const STDERR_MAX = 4000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: McpError): void;
  timer?: NodeJS.Timeout;
  detach?: () => void;
}

export function createMcpClient(child: McpChild, o: McpClientOptions = {}): McpClient {
  const timeoutDefault = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lineMax = o.lineMax ?? LINE_MAX;
  const stderrMax = o.stderrMax ?? STDERR_MAX;
  const pending = new Map<number, Pending>();
  const closers: (() => void)[] = [];
  let next = 1;
  let closed = false;
  let buffer = '';
  let stderr = '';

  const write = (message: object): void => {
    if (closed) throw new McpError('closed', 'the browser server has ended');
    try {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    } catch {
      throw new McpError('closed', 'the browser server has ended');
    }
  };

  const failAll = (error: McpError): void => {
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      if (p.timer) clearTimeout(p.timer);
      p.detach?.();
      p.reject(error);
    }
  };

  const end = (error: McpError): void => {
    if (closed) return;
    closed = true;
    failAll(error);
    for (const fn of closers.splice(0)) {
      try {
        fn();
      } catch {
        // Whoever listens must not keep the client open.
      }
    }
  };

  const handle = (line: string): void => {
    let m: { id?: unknown; method?: unknown; result?: unknown; error?: { code?: number; message?: string } };
    try {
      m = JSON.parse(line) as typeof m;
    } catch {
      // Not a message: a library that printed to the output. The server's own log goes to the other stream.
      return;
    }
    if (typeof m !== 'object' || m === null) return;
    if (typeof m.method === 'string' && m.id !== undefined) {
      // A request from the server: this client has no roots, no sampling and no prompts, so it answers `ping` and refuses the rest.
      try {
        write(m.method === 'ping' ? { jsonrpc: '2.0', id: m.id, result: {} } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
      } catch {
        // The connection is gone.
      }
      return;
    }
    if (typeof m.id !== 'number') return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (p.timer) clearTimeout(p.timer);
    p.detach?.();
    if (m.error) p.reject(new McpError('rpc', String(m.error.message ?? 'error').slice(0, 500), m.error.code));
    else p.resolve(m.result);
  };

  child.stdout?.setEncoding?.('utf8');
  child.stdout?.on('data', (chunk: string | Buffer) => {
    buffer += chunk.toString();
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim()) handle(line);
    }
    if (buffer.length > lineMax) {
      buffer = '';
      end(new McpError('protocol', 'the browser server sent a message that is too long'));
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  });
  child.stderr?.setEncoding?.('utf8');
  child.stderr?.on('data', (chunk: string | Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-stderrMax);
  });
  child.stdin?.on('error', () => undefined);
  child.stdout?.on('close', () => end(new McpError('closed', 'the browser server has ended')));
  child.once('exit', () => end(new McpError('closed', 'the browser server has ended')));
  child.once('error', () => end(new McpError('closed', 'the browser server could not start')));

  function request(method: string, params: object | undefined, options: CallOptions = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new McpError('closed', 'the browser server has ended'));
      if (options.signal?.aborted) return reject(new McpError('aborted', 'the call was stopped'));
      const id = next++;
      const entry: Pending = { resolve, reject };
      const cancel = (why: 'timeout' | 'aborted'): void => {
        if (!pending.delete(id)) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.detach?.();
        try {
          write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: why } });
        } catch {
          // The server is gone; nothing to tell.
        }
        reject(new McpError(why, why === 'timeout' ? 'the browser did not answer in time' : 'the call was stopped'));
      };
      entry.timer = setTimeout(() => cancel('timeout'), options.timeoutMs ?? timeoutDefault);
      entry.timer.unref?.();
      if (options.signal) {
        const onAbort = (): void => cancel('aborted');
        options.signal.addEventListener('abort', onAbort, { once: true });
        entry.detach = () => options.signal?.removeEventListener('abort', onAbort);
      }
      pending.set(id, entry);
      try {
        write({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
      } catch (e) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.detach?.();
        reject(e instanceof McpError ? e : new McpError('closed', 'the browser server has ended'));
      }
    });
  }

  const object = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

  return {
    async initialize() {
      const r = object(await request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: o.clientName ?? 'coxia', version: '1' } }, { timeoutMs: Math.max(timeoutDefault, 30_000) }));
      write({ jsonrpc: '2.0', method: 'notifications/initialized' });
      return { server: String(object(r.serverInfo).name ?? ''), protocol: String(r.protocolVersion ?? '') };
    },
    async listTools() {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      // The list may come in pages; a server that never ends it is cut at a number no server has.
      for (let page = 0; page < 20; page++) {
        const r = object(await request('tools/list', cursor ? { cursor } : undefined));
        if (!Array.isArray(r.tools)) throw new McpError('protocol', 'the browser server sent no list of tools');
        for (const t of r.tools) if (typeof t === 'object' && t !== null && typeof (t as McpTool).name === 'string') tools.push(t as McpTool);
        if (typeof r.nextCursor !== 'string' || !r.nextCursor) break;
        cursor = r.nextCursor;
      }
      return tools;
    },
    async callTool(name, args, options) {
      const r = object(await request('tools/call', { name, arguments: args }, options));
      if (!Array.isArray(r.content)) throw new McpError('protocol', 'the browser server sent no content');
      return { content: r.content.filter((c): c is McpContent => typeof c === 'object' && c !== null && typeof (c as McpContent).type === 'string'), ...(r.isError === true ? { isError: true } : {}) };
    },
    stderrTail: () => stderr,
    get closed() {
      return closed;
    },
    onClose(fn) {
      if (closed) fn();
      else closers.push(fn);
    },
    async close() {
      end(new McpError('closed', 'the browser server was closed'));
      try {
        child.stdin?.end();
      } catch {
        // Already closed.
      }
      try {
        // The server's own children (the browser) are killed with its group when it leads one; the process itself otherwise.
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // Gone.
        }
      }
    },
  };
}

export interface SpawnedMcp {
  child: ChildProcess;
  client: McpClient;
}

export interface McpSpawnOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Leads its own process group, so closing it takes everything it started with it. */
  detached?: boolean;
  client?: McpClientOptions;
}

/** Starts a server with its standard input and output held by the app and nothing else of it reachable: no terminal, no inherited descriptors. */
export function spawnMcp(o: McpSpawnOptions, spawn: (file: string, args: string[], options: SpawnOptions) => ChildProcess = nodeSpawn): SpawnedMcp {
  const child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'], detached: o.detached ?? false });
  return { child, client: createMcpClient(child as unknown as McpChild, o.client) };
}
