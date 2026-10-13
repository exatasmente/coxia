import { chmodSync, existsSync, rmSync } from 'node:fs';
import { type Server, type Socket, connect, createServer } from 'node:net';
import { join } from 'node:path';
import { ADMIN_LINE_MAX, ADMIN_SOCKET_NAME, ADMIN_WRITE_MAX, type AdminLine } from '../shared/adminDoor';
import { ContractError, wireErrorOf } from '../shared/contract';
import { t } from '../shared/i18n';
import type { AppEvent } from '../shared/types';
import { SOCKET_PATH_MAX } from './mcp-state/bridge';
import { hello, invokeAdmin } from './rpc';

// The local admin door (#211): a Unix socket in the workspace's folder through which a client on the same machine calls the core's channels with the window's rights. Whoever can
// connect is the user the core runs as (the file is 0600, and SSH is what brings a remote person to it), so there is no token. The protocol is in src/shared/adminDoor.ts.

export interface AdminDoorState {
  listening: boolean;
  /** The socket's path when it listens, and when it could not be opened too (so the message can name it). */
  path: string;
  /** Why it stays closed, in the person's words; empty while it listens. */
  reason: string;
}

export interface AdminDoor {
  /** Listens, or leaves the door closed with a reason: a refusal never stops the core. */
  start(): Promise<AdminDoorState>;
  /** Closes the listener and every connection and removes the socket file it made. */
  stop(): Promise<void>;
  /** Sends an event to every client that said hello. */
  emit(ev: AppEvent): void;
  state(): AdminDoorState;
}

export const adminSocketPath = (dir: string): string => join(dir, ADMIN_SOCKET_NAME);

type Probe = 'free' | 'live' | 'stale' | 'unknown';

// A file left by a killed process still exists but nobody answers; a live one belongs to another process on this workspace and is never taken from it.
function probe(path: string): Promise<Probe> {
  return new Promise((resolve) => {
    if (!existsSync(path)) return resolve('free');
    const s = connect(path);
    s.once('connect', () => {
      s.destroy();
      resolve('live');
    });
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ECONNREFUSED' ? 'stale' : 'unknown'));
  });
}

export function createAdminDoor(dir: string, workspace: () => string): AdminDoor {
  const path = adminSocketPath(dir);
  let server: Server | null = null;
  let reason = '';
  const clients = new Set<Socket>();
  const greeted = new Set<Socket>();

  // A client that stopped reading is closed rather than waited for: what is unsent would otherwise pile up in the core's memory. It can connect again.
  const send = (socket: Socket, line: AdminLine): void => {
    if (socket.destroyed) return;
    if (socket.writableLength > ADMIN_WRITE_MAX) return void socket.destroy();
    socket.write(`${JSON.stringify(line)}\n`);
  };
  const refuse = (socket: Socket, e: unknown): void => {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify({ error: wireErrorOf(e) } satisfies AdminLine)}\n`);
  };

  async function call(socket: Socket, id: number, channel: string, args: unknown[]): Promise<void> {
    try {
      send(socket, { id, ok: true, value: (await invokeAdmin(channel, args)) ?? null });
    } catch (e) {
      send(socket, { id, ok: false, error: wireErrorOf(e) });
    }
  }

  function line(socket: Socket, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      msg = undefined;
    }
    const obj = msg && typeof msg === 'object' && !Array.isArray(msg) ? (msg as Record<string, unknown>) : null;
    if (!greeted.has(socket)) {
      if (!obj || !('hello' in obj)) return refuse(socket, new ContractError('invalid-input', t('main.admin.badFirst')));
      try {
        send(socket, { hello: { ...hello(obj.hello), workspace: workspace() } });
      } catch (e) {
        return refuse(socket, e);
      }
      greeted.add(socket);
      return;
    }
    if (!obj || typeof obj.id !== 'number' || typeof obj.channel !== 'string' || (obj.args !== undefined && !Array.isArray(obj.args))) {
      // Without a usable id there is nothing to answer by; the connection is the only thing left to refuse.
      return refuse(socket, new ContractError('invalid-input', t('main.admin.badRequest')));
    }
    void call(socket, obj.id, obj.channel, (obj.args as unknown[] | undefined) ?? []);
  }

  function accept(socket: Socket): void {
    clients.add(socket);
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (raw.length > ADMIN_LINE_MAX) return void socket.destroy();
        if (raw.trim()) line(socket, raw);
        if (socket.destroyed) return;
      }
      if (buf.length > ADMIN_LINE_MAX) socket.destroy();
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clients.delete(socket);
      greeted.delete(socket);
    });
  }

  const closed = (why: string): AdminDoorState => {
    reason = why;
    console.error('[admin]', why);
    return state();
  };

  const state = (): AdminDoorState => ({ listening: server !== null, path, reason });

  return {
    async start() {
      if (server) return state();
      if (path.length > SOCKET_PATH_MAX) return closed(t('main.admin.pathTooLong', { path }));
      const found = await probe(path);
      if (found === 'live') return closed(t('main.admin.inUse', { path }));
      if (found === 'unknown') return closed(t('main.admin.notASocket', { path }));
      if (found === 'stale') rmSync(path, { force: true });
      const s = createServer(accept);
      try {
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(path, () => resolve());
        });
        chmodSync(path, 0o600);
      } catch (e) {
        s.close();
        rmSync(path, { force: true });
        return closed(t('main.admin.listenFailed', { path, detail: e instanceof Error ? e.message : String(e) }));
      }
      server = s;
      reason = '';
      return state();
    },
    async stop() {
      const s = server;
      server = null;
      for (const socket of clients) socket.destroy();
      clients.clear();
      greeted.clear();
      if (s) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
        rmSync(path, { force: true });
      }
    },
    emit(ev) {
      for (const socket of greeted) send(socket, { event: ev });
    },
    state,
  };
}
