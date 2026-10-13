// The local admin door (#211): a Unix socket in the workspace's folder through which a client on the machine calls the core's channels. Only local sockets in a temp folder.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { type AddressInfo, type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

let sandbox = '';
let dataDir = '';
let cleanup: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  vi.resetModules();
  sandbox = mkdtempSync(join(tmpdir(), 'cxa-'));
  dataDir = join(sandbox, 'data');
  mkdirSync(dataDir);
  cleanup = [];
});
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

const load = async () => {
  (await import('../src/shared/i18n')).setLanguage('en');
  return { ...(await import('../src/main/core')), rpc: await import('../src/main/rpc'), env: await import('../src/main/env'), door: await import('../src/shared/adminDoor'), contract: await import('../src/shared/contract') };
};

async function boot(extra: Record<string, unknown> = {}) {
  const m = await load();
  const core = m.createCoxia({ dataDir, adminDoor: true, ...extra });
  cleanup.push(() => core.stop({ deadlineMs: 500 }));
  await core.start();
  return { ...m, core, path: join(m.env.atasDir(), m.door.ADMIN_SOCKET_NAME) };
}

type Line = Record<string, any>;
interface Client {
  socket: Socket;
  lines: Line[];
  send(obj: unknown): void;
  next(match?: (l: Line) => boolean): Promise<Line>;
  closed: Promise<void>;
}

async function client(path: string): Promise<Client> {
  const socket = connect(path);
  socket.setEncoding('utf8');
  const lines: Line[] = [];
  const waiting: Array<() => void> = [];
  let buf = '';
  socket.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
    for (const w of waiting.splice(0)) w();
  });
  const closed = new Promise<void>((r) => socket.on('close', () => r()));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  cleanup.push(() => void socket.destroy());
  return {
    socket,
    lines,
    send: (obj) => void socket.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`),
    async next(match = () => true) {
      for (;;) {
        const i = lines.findIndex(match);
        if (i >= 0) return lines.splice(i, 1)[0] as Line;
        await new Promise<void>((r) => waiting.push(r));
      }
    },
    closed,
  };
}

async function greeted(path: string, version: number): Promise<Client> {
  const c = await client(path);
  c.send({ hello: version });
  expect(await c.next()).toMatchObject({ hello: { version } });
  return c;
}

describe('the handshake', () => {
  it('answers a matching hello with the version and the workspace', async () => {
    const { path, contract, env } = await boot();
    const c = await client(path);
    c.send({ hello: contract.CONTRACT_VERSION });
    expect(await c.next()).toEqual({ hello: { version: contract.CONTRACT_VERSION, workspace: env.workspaceId() } });
  });

  it('refuses another version with both numbers in the message, and closes', async () => {
    const { path, contract } = await boot();
    const c = await client(path);
    c.send({ hello: contract.CONTRACT_VERSION + 1 });
    const answer = await c.next();
    expect(answer.error.code).toBe('contract-mismatch');
    expect(answer.error.message).toContain(String(contract.CONTRACT_VERSION + 1));
    expect(answer.error.message).toContain(String(contract.CONTRACT_VERSION));
    await c.closed;
  });

  it.each([['not json'], ['{"id":1,"channel":"settings:get","args":[]}'], ['[1]'], ['null']])('refuses a first line that is not a hello (%s)', async (first) => {
    const { path } = await boot();
    const c = await client(path);
    c.send(first);
    expect((await c.next()).error.code).toBe('invalid-input');
    await c.closed;
  });

  it('closes a connection that sends a line longer than the limit', async () => {
    const { path, door } = await boot();
    const c = await greeted(path, 1);
    c.socket.write('x'.repeat(door.ADMIN_LINE_MAX + 10));
    await c.closed;
  });
});

describe('calls', () => {
  it('answers a call with its value', async () => {
    const { path, rpc } = await boot();
    rpc.handle('test:echo', (a: unknown, b: unknown) => ({ a, b }));
    const c = await greeted(path, 1);
    c.send({ id: 7, channel: 'test:echo', args: [1, 'two'] });
    expect(await c.next()).toEqual({ id: 7, ok: true, value: { a: 1, b: 'two' } });
  });

  it('answers a failure with its contract code', async () => {
    const { path, contract } = await boot();
    const c = await greeted(path, 1);
    c.send({ id: 1, channel: contract.HELLO_CHANNEL, args: [99] });
    const answer = await c.next();
    expect(answer).toMatchObject({ id: 1, ok: false, error: { code: 'contract-mismatch' } });
    expect(contract.isErrorCode(answer.error.code)).toBe(true);
  });

  it('answers an unknown channel, and a channel only a window serves', async () => {
    const { path } = await boot();
    const c = await greeted(path, 1);
    c.send({ id: 1, channel: 'nope:nothing', args: [] });
    c.send({ id: 2, channel: 'clipboard:copy', args: ['x'] });
    expect(await c.next((l) => l.id === 1)).toMatchObject({ ok: false, error: { code: 'unknown-channel' } });
    expect(await c.next((l) => l.id === 2)).toMatchObject({ ok: false, error: { code: 'unknown-channel' } });
  });

  it('answers calls in flight together by their ids, in any order', async () => {
    const { path, rpc } = await boot();
    rpc.handle('test:slow', (ms: number, tag: string) => new Promise((r) => setTimeout(() => r(tag), ms)));
    const c = await greeted(path, 1);
    c.send({ id: 1, channel: 'test:slow', args: [150, 'slow'] });
    c.send({ id: 2, channel: 'test:slow', args: [1, 'fast'] });
    const first = await c.next();
    const second = await c.next();
    expect([first, second]).toEqual([
      { id: 2, ok: true, value: 'fast' },
      { id: 1, ok: true, value: 'slow' },
    ]);
  });

  it('names the door in the origin of the call', async () => {
    const { path, rpc } = await boot();
    rpc.handle('test:origin', () => [rpc.callOrigin(), rpc.viaOf()]);
    const c = await greeted(path, 1);
    c.send({ id: 1, channel: 'test:origin', args: [] });
    expect(await c.next()).toMatchObject({ value: ['admin', 'admin'] });
  });

  it('returns a pairing code from web:pair', async () => {
    const { path } = await boot({ web: { host: '127.0.0.1', port: await freePort() } });
    const c = await greeted(path, 1);
    c.send({ id: 1, channel: 'web:pair', args: [] });
    const answer = await c.next();
    expect(answer.ok).toBe(true);
    expect(JSON.stringify(answer.value)).toMatch(/\d{4,}|[A-Z0-9]{4,}/);
  });
});

describe('events', () => {
  it('delivers what the core emits to a client that said hello, and not before', async () => {
    const { path } = await boot();
    const early = await client(path);
    const c = await greeted(path, 1);
    c.send({ id: 1, channel: 'settings:get', args: [] });
    const settings = (await c.next()).value;
    c.send({ id: 2, channel: 'settings:save', args: [settings] });
    const event = await c.next((l) => 'event' in l);
    expect(event.event.type).toBe('settings');
    await c.next((l) => l.id === 2);
    expect(early.lines).toEqual([]);
  });
});

describe('the socket file', () => {
  it('is 0600 while the core runs and gone after stop', async () => {
    const { path, core } = await boot();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(core.adminDoor()).toMatchObject({ listening: true, path });
    await core.stop({ deadlineMs: 500 });
    expect(existsSync(path)).toBe(false);
  });

  it('replaces a stale file left by a killed process', async () => {
    const m = await load();
    const core = m.createCoxia({ dataDir, adminDoor: true });
    cleanup.push(() => core.stop({ deadlineMs: 500 }));
    const path = join(m.env.atasDir(), m.door.ADMIN_SOCKET_NAME);
    mkdirSync(m.env.atasDir(), { recursive: true });
    // A socket whose process was killed: the file stays, nobody answers.
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(path)}, () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((r) => child.stdout.once('data', r));
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    expect(existsSync(path)).toBe(true);
    await core.start();
    expect(core.adminDoor()?.listening).toBe(true);
    const c = await greeted(path, 1);
    c.socket.destroy();
  });

  it('does not take a live socket: the door stays closed, the core starts, the reason is given', async () => {
    const m = await load();
    const core = m.createCoxia({ dataDir, adminDoor: true });
    cleanup.push(() => core.stop({ deadlineMs: 500 }));
    const path = join(m.env.atasDir(), m.door.ADMIN_SOCKET_NAME);
    mkdirSync(m.env.atasDir(), { recursive: true });
    const owner = createServer((s) => s.end('mine\n'));
    await new Promise<void>((r) => owner.listen(path, r));
    cleanup.push(() => new Promise<void>((r) => owner.close(() => r())));
    await core.start();
    const state = core.adminDoor();
    expect(state?.listening).toBe(false);
    expect(state?.reason).toMatch(/another process|outro processo/);
    expect(m.rpc.hasChannel('settings:get')).toBe(true);
    // The other process still owns it.
    const raw = connect(path);
    cleanup.push(() => void raw.destroy());
    expect(await new Promise((r) => raw.once('data', (d) => r(String(d))))).toBe('mine\n');
  });

  it('stays closed, with a reason, when the path is too long for a socket', async () => {
    dataDir = join(sandbox, 'd'.repeat(120));
    mkdirSync(dataDir);
    const { core } = await boot();
    expect(core.adminDoor()).toMatchObject({ listening: false });
    expect(core.adminDoor()?.reason).toMatch(/too deep|funda demais/);
  });

  it('stays closed, with a reason, when the folder cannot take a socket', async () => {
    const { createAdminDoor } = await import('../src/main/adminDoor');
    const door = createAdminDoor(join(sandbox, 'missing'), () => 'principal');
    const state = await door.start();
    expect(state.listening).toBe(false);
    expect(state.reason).not.toBe('');
  });

  it('is not opened unless asked for', async () => {
    const m = await load();
    const core = m.createCoxia({ dataDir });
    cleanup.push(() => core.stop({ deadlineMs: 500 }));
    await core.start();
    expect(core.adminDoor()).toBeNull();
    expect(existsSync(join(m.env.atasDir(), m.door.ADMIN_SOCKET_NAME))).toBe(false);
  });
});

describe('a slow client', () => {
  it('is closed when what is unsent to it passes the bound, and the core answers the others', async () => {
    const { path, rpc, door } = await boot();
    rpc.handle('test:big', () => 'y'.repeat(door.ADMIN_WRITE_MAX));
    const slow = await greeted(path, 1);
    slow.socket.pause();
    for (let i = 1; i <= 6; i++) slow.send({ id: i, channel: 'test:big', args: [] });
    await new Promise((r) => setTimeout(r, 500));
    const other = await greeted(path, 1);
    other.send({ id: 1, channel: 'test:echo2', args: [] });
    expect((await other.next()).error.code).toBe('unknown-channel');
    // Reading again shows the core hung up on the slow one instead of keeping everything for it.
    slow.socket.resume();
    await slow.closed;
  });
});

describe('where it is on', () => {
  it('is left off by the desktop entry and on by the headless one', () => {
    const desktop = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
    expect(desktop).not.toMatch(/adminDoor/);
    const headless = readFileSync(join(__dirname, '..', 'src', 'headless', 'main.ts'), 'utf8');
    expect(headless).toMatch(/adminDoor: opts\.adminDoor/);
    expect(headless).toMatch(/no-admin-door/);
    expect(headless).toMatch(/COXIA_ADMIN_DOOR/);
  });

  it('keeps the helper script on the contract version', () => {
    const script = readFileSync(join(__dirname, '..', 'scripts', 'admin-call.mjs'), 'utf8');
    const contract = readFileSync(join(__dirname, '..', 'src', 'shared', 'contract.ts'), 'utf8');
    expect(script.match(/const CONTRACT_VERSION = (\d+)/)?.[1]).toBe(contract.match(/export const CONTRACT_VERSION = (\d+)/)?.[1]);
  });

  it('is opened by the headless entry, which prints the socket path in its ready output', async () => {
    const keyFile = join(sandbox, 'master.key');
    writeFileSync(keyFile, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    (await import('../src/shared/i18n')).setLanguage('en');
    const { main } = await import('../src/headless/main');
    const out: string[] = [];
    const running = await main(['--data-dir', dataDir, '--master-key-file', keyFile, '--port', String(await freePort())], {}, { out: (l) => out.push(l), err: (l) => out.push(l), exit: () => undefined });
    expect(running).not.toBeNull();
    cleanup.push(async () => {
      running?.signals.dispose();
      await running?.core.stop({ deadlineMs: 500 });
    });
    const sock = (await import('../src/main/env')).atasDir();
    expect(out.join('\n')).toMatch(new RegExp(`(admin door|porta de administração): ${join(sock, 'admin.sock')}`));
    expect(existsSync(join(sock, 'admin.sock'))).toBe(true);
  });

  it('is not opened with --no-admin-door', async () => {
    const keyFile = join(sandbox, 'master.key');
    writeFileSync(keyFile, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    (await import('../src/shared/i18n')).setLanguage('en');
    const { main } = await import('../src/headless/main');
    const running = await main(['--data-dir', dataDir, '--master-key-file', keyFile, '--port', String(await freePort()), '--no-admin-door'], {}, { out: () => undefined, err: () => undefined, exit: () => undefined });
    cleanup.push(async () => {
      running?.signals.dispose();
      await running?.core.stop({ deadlineMs: 500 });
    });
    expect(running?.core.adminDoor()).toBeNull();
  });
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const p = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  return p;
}
