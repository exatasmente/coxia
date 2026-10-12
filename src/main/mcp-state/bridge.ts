import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';

// The local channel between the state server a terminal session spawns and the open app, for the persona's tools (`mcpState.act`). Electron-free: the app listens with it
// (persona/terminal.ts) and the state server calls through it. A Unix socket in the workspace's own folder, readable by its owner only, and a token the app writes next to
// it each time it starts listening: nothing listens on the network, and a process that cannot read the folder cannot call. One JSON object per line each way.

export const BRIDGE_SOCKET = 'terminal.sock';
export const BRIDGE_TOKEN = 'terminal.token';
/** A line longer than this is not a request: the connection is closed. */
export const BRIDGE_LINE_MAX = 1_000_000;
/** The longest path a Unix socket takes on Linux, less the terminator. */
export const SOCKET_PATH_MAX = 107;

export const bridgeSocketPath = (dir: string): string => join(dir, BRIDGE_SOCKET);
export const bridgeTokenPath = (dir: string): string => join(dir, BRIDGE_TOKEN);

export interface BridgeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type BridgeRequest = { id: number; token: string; method: 'call'; tool: string; input: Record<string, unknown> };

export interface BridgeAnswer {
  id: number;
  text: string;
  isError: boolean;
}

/** Why a call did not reach the app, as the model reads it: the app is closed, or it is not listening for this workspace. */
export type BridgeFailure = 'closed' | 'token' | 'timeout' | 'broken';

export interface BridgeClient {
  call(tool: string, input: Record<string, unknown>): Promise<BridgeAnswer | { failure: BridgeFailure }>;
  close(): void;
}

/**
 * One connection for the life of the state server, opened at the first call and again after it breaks: the app keeps one answer session per connection, so what a call
 * read is the basis of the write that follows it, as in the persona's own answer.
 */
export function createBridgeClient(dir: string, o: { timeoutMs?: number; open?: (path: string) => Socket } = {}): BridgeClient {
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const open = o.open ?? ((path: string) => connect(path));
  let socket: Socket | null = null;
  let ready: Promise<Socket> | null = null;
  let next = 1;
  const waiting = new Map<number, (a: BridgeAnswer | { failure: BridgeFailure }) => void>();

  const fail = (why: BridgeFailure): void => {
    for (const settle of waiting.values()) settle({ failure: why });
    waiting.clear();
    socket?.destroy();
    socket = null;
    ready = null;
  };

  const ensure = (): Promise<Socket> =>
    (ready ??= new Promise<Socket>((resolve, reject) => {
      const s = open(bridgeSocketPath(dir));
      let buf = '';
      s.setEncoding('utf8');
      s.once('connect', () => {
        socket = s;
        resolve(s);
      });
      s.on('data', (chunk: string) => {
        buf += chunk;
        if (buf.length > BRIDGE_LINE_MAX) return fail('broken');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          let answer: Partial<BridgeAnswer> & { failure?: unknown };
          try {
            answer = JSON.parse(line);
          } catch {
            continue;
          }
          const settle = typeof answer.id === 'number' ? waiting.get(answer.id) : undefined;
          if (!settle) continue;
          waiting.delete(answer.id as number);
          settle(answer.failure === 'token' ? { failure: 'token' } : { id: answer.id as number, text: String(answer.text ?? ''), isError: answer.isError === true });
        }
      });
      s.once('error', (e) => {
        if (socket !== s) return reject(e);
        fail('broken');
      });
      s.once('close', () => {
        if (socket === s) fail('broken');
      });
    }));

  return {
    async call(tool, input) {
      let token: string;
      try {
        token = readFileSync(bridgeTokenPath(dir), 'utf8').trim();
      } catch {
        return { failure: 'closed' };
      }
      let s: Socket;
      try {
        s = await ensure();
      } catch {
        ready = null;
        return { failure: 'closed' };
      }
      const id = next++;
      const request: BridgeRequest = { id, token, method: 'call', tool, input };
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve({ failure: 'timeout' });
        }, timeoutMs);
        waiting.set(id, (a) => {
          clearTimeout(timer);
          resolve(a);
        });
        s.write(`${JSON.stringify(request)}\n`);
      });
    },
    close() {
      fail('broken');
    },
  };
}
