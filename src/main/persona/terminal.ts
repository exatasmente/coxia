import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { BRIDGE_LINE_MAX, SOCKET_PATH_MAX, bridgeSocketPath, bridgeTokenPath, type BridgeAnswer } from '../mcp-state/bridge';
import { ToolError } from '../engine/open/tools/types';
import type { Door } from './door';
import { doorText } from './doorText';
import { createSession, type AnswerSession } from './session';

// The app's end of the terminal bridge (`mcpState.act`): a Claude Code session calls the persona's tools through the state server, and they run here, through the persona's
// own door, with the terminal as the door the request came by. So the Stop, the argument checks, the settings guard, the test-workspace guard, the audit and the act lines in
// the persona's conversation are the ones the persona has, once: the terminal reaches nothing the persona cannot. One answer session per connection, finished when it closes.

/** The door name the audit and the act lines carry for a call from a terminal session. */
export const TERMINAL_DOOR = 'terminal';

export interface TerminalDeps {
  /** The workspace's folder: the socket and the token live there. */
  dir: string;
  door: Door;
  /** The persona and its conversation now, or null when the workspace has none. */
  persona: () => { id: string; thread: string } | null;
  /** Whether the switch is still on: read at every call, so turning it off stops a session that is connected. */
  on: () => boolean;
}

export interface TerminalBridge {
  /** Listens, or does nothing when it already does; a refusal (a path too long, a folder it cannot write) is said and the bridge stays closed. */
  start(): Promise<void>;
  /** Closes the listener and every connection, and removes the socket and the token. */
  stop(): Promise<void>;
  listening(): boolean;
}

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createTerminalBridge(deps: TerminalDeps): TerminalBridge {
  const socketPath = bridgeSocketPath(deps.dir);
  const tokenPath = bridgeTokenPath(deps.dir);
  let server: Server | null = null;
  let token = '';
  const open = new Set<Socket>();

  const remove = (): void => {
    rmSync(socketPath, { force: true });
    rmSync(tokenPath, { force: true });
  };

  async function answer(session: () => AnswerSession | null, raw: string): Promise<BridgeAnswer | { id: number; failure: 'token' } | null> {
    let req: { id?: unknown; token?: unknown; method?: unknown; tool?: unknown; input?: unknown };
    try {
      req = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!req || typeof req.id !== 'number') return null;
    const id = req.id;
    if (typeof req.token !== 'string' || !sameToken(req.token, token)) return { id, failure: 'token' };
    if (!deps.on()) return { id, text: doorText('terminal.off'), isError: true };
    const s = session();
    if (!s) return { id, text: doorText('terminal.noPersona'), isError: true };
    if (req.method !== 'call' || typeof req.tool !== 'string') return { id, text: doorText('terminal.badRequest'), isError: true };
    const input = req.input && typeof req.input === 'object' && !Array.isArray(req.input) ? (req.input as Record<string, unknown>) : {};
    try {
      return { id, text: await deps.door.run(s, req.tool, input), isError: false };
    } catch (e) {
      if (e instanceof ToolError) return { id, text: e.message, isError: true };
      return { id, text: doorText('terminal.failed', { reason: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) }), isError: true };
    }
  }

  function accept(socket: Socket): void {
    open.add(socket);
    socket.setEncoding('utf8');
    let session: AnswerSession | null = null;
    // The session is the persona's of the moment the first call arrives; a persona made or removed later is read again by the next connection.
    const sessionOf = (): AnswerSession | null => {
      if (session) return session;
      const p = deps.persona();
      if (!p) return null;
      session = createSession({ persona: p.id, thread: p.thread, seq: 0, door: TERMINAL_DOOR });
      return session;
    };
    let buf = '';
    socket.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > BRIDGE_LINE_MAX) return void socket.destroy();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        void answer(sessionOf, line).then((a) => {
          if (a && !socket.destroyed) socket.write(`${JSON.stringify(a)}\n`);
        });
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      open.delete(socket);
      if (session) deps.door.finish(session);
    });
  }

  return {
    async start() {
      if (server) return;
      if (socketPath.length > SOCKET_PATH_MAX) {
        console.error('[terminal] the workspace folder is too deep for a local socket; the persona tools are not offered to a terminal session');
        return;
      }
      // A socket left by an app that did not close cleanly would refuse the listen; the token is new for every start, so an old one opens nothing.
      remove();
      token = randomBytes(32).toString('hex');
      const s = createServer(accept);
      try {
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(socketPath, () => resolve());
        });
        chmodSync(socketPath, 0o600);
        writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
        chmodSync(tokenPath, 0o600);
        server = s;
      } catch (e) {
        s.close();
        remove();
        console.error('[terminal] could not listen for the terminal session:', e instanceof Error ? e.message : e);
      }
    },
    async stop() {
      const s = server;
      server = null;
      token = '';
      for (const socket of open) socket.destroy();
      open.clear();
      if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
      remove();
    },
    listening: () => server !== null,
  };
}
