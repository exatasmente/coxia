import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type Socket, connect } from 'node:net';
import { Duplex } from 'node:stream';
import { ADMIN_LINE_MAX } from '../shared/adminDoor';
import { CONTRACT_VERSION, ContractError, type ErrorCode, isErrorCode } from '../shared/contract';
import { t } from '../shared/i18n';
import { type InstanceDef, INSTANCE_EVENT, type InstanceStatus, type LinkState, parseSshTarget } from '../shared/instances';
import type { AppEvent } from '../shared/types';
import { decodeWire, encodeWire } from '../shared/wire';
import { type KeyStore, type SshCommands, SYSTEM_SSH, knownHostsPath, makeSocketDir, sshArgs, sshBridgeArgs, writeKeyFile } from './instances-core';

// The desktop as a client of a remote instance (#211). Either an `ssh -N -L` child forwards a local Unix socket to the admin socket of the instance's workspace (`socket`), or the
// ssh child runs `coxia-server bridge <workspace>` and its stdin/stdout are the socket (`server`: the admin socket belongs to the service user, so only the bridge can open it). Over it the desktop
// speaks the admin protocol (src/shared/adminDoor.ts) with the window's rights, which is the admin door's trust model: whoever reaches the socket is the user the core runs as.
// A call in flight when the link drops fails with `connection-lost` and is never sent again: the person decides whether to repeat what may or may not have run.

/** One live connection: an ssh child, a socket, the hello done. */
export interface Link {
  call(channel: string, args: unknown[]): Promise<unknown>;
  close(): void;
  readonly closed: Promise<void>;
  readonly workspace: string;
}

export interface LinkOptions {
  def: InstanceDef;
  /** The data folder of this computer (the known hosts live there). */
  root: string;
  keys: KeyStore;
  commands?: SshCommands;
  onEvent?: (ev: AppEvent) => void;
  /** How long to wait for the forwarding and for the hello. */
  timeoutMs?: number;
}

const lost = (detail = ''): ContractError => new ContractError('connection-lost', t('main.instances.connectionLost', { detail }).trim());

const tail = (s: string): string => s.trim().split('\n').slice(-3).join(' ').slice(0, 300);

/** Opens the forwarding and says hello. Rejects with the reason in the person's words; leaves no file and no process behind when it does. */
export async function openLink(o: LinkOptions): Promise<Link> {
  const target = parseSshTarget(o.def.sshTarget);
  if (!target) throw new ContractError('invalid-input', t('main.instances.badTarget'));
  const timeout = o.timeoutMs ?? 20_000;
  const key = writeKeyFile(o.keys.resolve(o.def.keyRef));
  const server = o.def.via === 'server';
  const sock = server ? null : makeSocketDir();
  let child: ChildProcess | null = null;
  let socket: Duplex | null = null;
  const cleanup = (): void => {
    key.remove();
    sock?.remove();
  };
  const killAll = (): void => {
    socket?.destroy();
    child?.stdin?.destroy();
    child?.kill('SIGTERM');
    cleanup();
  };
  try {
    const cmds = o.commands ?? SYSTEM_SSH;
    const common = { knownHosts: knownHostsPath(o.root), keyFile: key.path };
    const proc = server
      ? spawn(cmds.ssh, sshBridgeArgs(o.def, target, common), { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(cmds.ssh, sshArgs(o.def, target, { ...common, localSocket: (sock as { path: string }).path }), { stdio: ['ignore', 'ignore', 'pipe'] });
    child = proc;
    let stderr = '';
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (c: string) => {
      stderr = (stderr + c).slice(-2000);
    });
    const exited = new Promise<never>((_, reject) => {
      proc.once('error', (e) => reject(new ContractError('internal', t('main.instances.sshMissing', { detail: e.message }))));
      proc.once('exit', () => reject(new ContractError('internal', t('main.instances.sshFailed', { detail: tail(stderr) }))));
    });
    exited.catch(() => undefined);
    const deadline = Date.now() + timeout;
    // The forwarding exists once ssh has authenticated and listens: from then on it no longer needs the key.
    // With the bridge there is no socket file to wait for: the hello answer below is the proof, and the key goes then.
    if (!server) await Promise.race([
      exited,
      (async () => {
        while (!existsSync((sock as { path: string }).path)) {
          if (Date.now() > deadline) throw new ContractError('internal', t('main.instances.timeout'));
          await new Promise((r) => setTimeout(r, 40));
        }
      })(),
    ]);
    if (!server) key.remove();

    const s: Duplex = server ? Duplex.from({ readable: proc.stdout as never, writable: proc.stdin as never }) : connect((sock as { path: string }).path);
    socket = s;
    s.setEncoding('utf8');
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    let nextId = 1;
    let buf = '';
    let isClosed = false;
    let greeting: ((l: Record<string, unknown>) => void) | null = null;
    let signalClosed: () => void = () => undefined;
    const closed = new Promise<void>((r) => {
      signalClosed = r;
    });
    const end = (): void => {
      if (isClosed) return;
      isClosed = true;
      for (const p of pending.values()) p.reject(lost());
      pending.clear();
      cleanup();
      child?.kill('SIGTERM');
      signalClosed();
    };
    s.on('error', () => undefined);
    s.on('close', end);
    proc.stdin?.on('error', () => undefined);
    // The bridge's output may still be in the pipe when the process exits: its own close comes after.
    proc.once(server ? 'close' : 'exit', end);
    s.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > ADMIN_LINE_MAX + 1024) return void s.destroy();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let line: Record<string, unknown>;
        try {
          line = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (greeting) {
          const g = greeting;
          greeting = null;
          g(line);
        } else if (typeof line.id === 'number') {
          const p = pending.get(line.id);
          if (!p) continue;
          pending.delete(line.id);
          if (line.ok === true) p.resolve(decodeWire(line.value));
          else {
            const e = (line.error ?? {}) as { code?: unknown; message?: unknown };
            p.reject(new ContractError(isErrorCode(e.code) ? e.code : 'internal', typeof e.message === 'string' ? e.message : ''));
          }
        } else if (line.event && typeof line.event === 'object') {
          o.onEvent?.(decodeWire(line.event) as AppEvent);
        }
      }
    });
    if (!server) {
      await new Promise<void>((resolve, reject) => {
        s.once('connect', resolve);
        s.once('error', reject);
      });
    }
    const hello = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ContractError('internal', t('main.instances.noDoor', { detail: tail(stderr) }))), timeout);
      if (server) exited.catch(reject);
      closed.then(() => reject(new ContractError('internal', t('main.instances.noDoor', { detail: tail(stderr) }))));
      greeting = (l) => {
        clearTimeout(timer);
        resolve(l);
      };
      s.write(`${JSON.stringify({ hello: CONTRACT_VERSION })}\n`);
    });
    key.remove();
    const answer = hello.hello as { workspace?: unknown } | undefined;
    if (!answer) {
      const e = (hello.error ?? {}) as { code?: unknown; message?: unknown };
      throw new ContractError(isErrorCode(e.code) ? e.code : 'internal', typeof e.message === 'string' ? e.message : t('main.instances.noDoor', { detail: '' }));
    }
    return {
      workspace: String(answer.workspace ?? ''),
      closed,
      close: () => {
        proc.stdin?.end();
        s.destroy();
        end();
      },
      call: (channel, args) =>
        new Promise((resolve, reject) => {
          if (isClosed) return reject(lost());
          const text = `${JSON.stringify({ id: nextId, channel, args: encodeWire(args) })}\n`;
          if (text.length > ADMIN_LINE_MAX) return reject(new ContractError('invalid-input', t('main.instances.tooBig')));
          pending.set(nextId++, { resolve, reject });
          s.write(text);
        }),
    };
  } catch (e) {
    killAll();
    throw e;
  }
}

export interface BridgeOptions extends LinkOptions {
  onStatus?: (s: InstanceStatus) => void;
  /** First wait before retrying and the longest one. */
  backoffMs?: { base: number; max: number };
  /** How often the role (owner or client) is read again. */
  roleEveryMs?: number;
}

export interface InstanceBridge {
  /** Starts connecting and keeps the link up until `stop`. */
  start(): void;
  stop(): Promise<void>;
  /** Forwards a channel call. Rejects with `connection-lost` when the link is down or drops before the answer. */
  call(channel: string, args: unknown[]): Promise<unknown>;
  status(): InstanceStatus;
}

export function createInstanceBridge(o: BridgeOptions): InstanceBridge {
  const backoff = o.backoffMs ?? { base: 1000, max: 30_000 };
  let link: Link | null = null;
  let stopped = false;
  let everUp = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let roleTimer: ReturnType<typeof setInterval> | null = null;
  let st: InstanceStatus = { instance: { id: o.def.id, name: o.def.name }, link: 'connecting', role: null, detail: '' };

  const set = (patch: Partial<InstanceStatus>): void => {
    st = { ...st, ...patch };
    o.onStatus?.(st);
    o.onEvent?.({ type: 'module', name: INSTANCE_EVENT, payload: st });
  };

  async function readRole(l: Link): Promise<void> {
    try {
      const own = (await l.call('ownership:status', [])) as { role?: unknown } | null;
      if (own?.role === 'owner' || own?.role === 'client') {
        if (own.role !== st.role) set({ role: own.role });
      }
    } catch {
      // The link's own closing reports it.
    }
  }

  function retry(): void {
    if (stopped) return;
    failures++;
    const wait = Math.min(backoff.max, backoff.base * 2 ** Math.min(failures - 1, 10));
    timer = setTimeout(() => void connectNow(), wait);
  }

  async function connectNow(): Promise<void> {
    if (stopped) return;
    try {
      const l = await openLink(o);
      if (stopped) return l.close();
      link = l;
      failures = 0;
      everUp = true;
      set({ link: 'connected', detail: '' });
      await readRole(l);
      roleTimer = setInterval(() => void readRole(l), o.roleEveryMs ?? 15_000);
      void l.closed.then(() => {
        if (link !== l) return;
        link = null;
        if (roleTimer) clearInterval(roleTimer);
        if (stopped) return;
        set({ link: 'reconnecting', detail: '' });
        retry();
      });
    } catch (e) {
      const state: LinkState = everUp && failures < 3 ? 'reconnecting' : 'lost';
      set({ link: state, detail: e instanceof Error ? e.message : String(e) });
      retry();
    }
  }

  return {
    start() {
      set({ link: 'connecting' });
      void connectNow();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (roleTimer) clearInterval(roleTimer);
      const l = link;
      link = null;
      l?.close();
    },
    call(channel, args) {
      if (!link) return Promise.reject(lost(st.detail));
      return link.call(channel, args);
    },
    status: () => st,
  };
}
