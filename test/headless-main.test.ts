// The headless entry in this process: it comes up on a given address with a master key file, answers the health route, takes its address from the
// host without saving it, refuses to start without a safe key, and leaves only its data folder behind.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

let sandbox = '';
let dataDir = '';
let keyFile = '';
let port = 0;
let running: { signals: { dispose(): void }; core: { stop(o?: { deadlineMs?: number }): Promise<void> } } | null = null;

const freePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const p = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  return p;
};

function get(path: string, method = 'GET'): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', fail);
    req.end();
  });
}

const args = (extra: string[] = []): string[] => ['--data-dir', dataDir, '--master-key-file', keyFile, '--port', String(port), ...extra];
// The modules are loaded afresh in each test, so the language is set on this load's catalog.
const entry = async () => {
  (await import('../src/shared/i18n')).setLanguage('en');
  return { ...(await import('../src/headless/main')), rpc: await import('../src/main/rpc') };
};
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();

beforeEach(async () => {
  vi.resetModules();
  sandbox = mkdtempSync(join(tmpdir(), 'cerimonias-headless-'));
  dataDir = join(sandbox, 'data');
  mkdirSync(dataDir);
  keyFile = join(sandbox, 'master.key');
  writeFileSync(keyFile, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  port = await freePort();
  running = null;
});

afterEach(async () => {
  running?.signals.dispose();
  await running?.core.stop({ deadlineMs: 1_000 });
});

describe('main', () => {
  it('comes up, answers /healthz without data of the person, and stops on SIGTERM with exit 0', async () => {
    const { main } = await entry();
    const exit = vi.fn();
    const lines: string[] = [];
    const started = await main(args(), {}, { exit, out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`) });
    expect(started).not.toBeNull();
    running = started;
    expect(exit).not.toHaveBeenCalled();
    // Said in the workspace's language, which is applied by the time the core is up.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^(admin door|porta de administração): .*admin\.sock$/);
    expect(lines[0]).toMatch(new RegExp(`^coxia (ready: listening on|pronto: escutando em) 127\\.0\\.0\\.1:${port}/cerimonias/, workspace principal$`));

    const health = await get('/cerimonias/healthz');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ ok: true, version: JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version, workspace: 'principal' });
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.body).not.toContain(dataDir);
    expect((await get('/cerimonias/healthz', 'HEAD')).status).toBe(200);
    // At the root too, for a probe that does not know the base path; a POST is no health check.
    expect(JSON.parse((await get('/healthz')).body)).toMatchObject({ ok: true, workspace: 'principal' });
    expect((await get('/healthz', 'POST')).status).toBe(404);
    // Not a route of the API: nothing else is open without a session.
    expect((await get('/cerimonias/api/rpc/state:load', 'POST')).status).toBeGreaterThanOrEqual(400);

    // What a service manager sends: the installed handler stops the core and ends the process cleanly.
    await started?.signals.deliver('SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    await expect(get('/cerimonias/healthz')).rejects.toThrow();
  });

  it('listens where the host said without saving it, and keeps it when a client reconfigures the door', async () => {
    const { main, rpc } = await entry();
    const started = await main(args(), {}, { exit: vi.fn(), out: () => undefined, err: () => undefined });
    running = started;
    // The saved web settings were not written by the override.
    expect(existsSync(join(dataDir, 'web.json'))).toBe(false);

    const view = (await rpc.invoke('web:view', [])) as { addressFixed?: boolean; settings: { enabled: boolean; host: string; port: number }; status: { listening: boolean } };
    expect(view.addressFixed).toBe(true);
    expect(view.settings).toMatchObject({ enabled: true, host: '127.0.0.1', port });
    expect(view.status.listening).toBe(true);

    // Moving or switching off from a client (the admin socket: a call from the paired door would now need a passkey) changes the other fields only; the door stays where it is and the saved address stays as it was.
    const after = (await rpc.invokeAdmin('web:configure', [{ enabled: false, port: port + 1, basePath: '/other/' }])) as typeof view & { settings: { basePath: string } };
    expect(after.settings).toMatchObject({ enabled: true, port, basePath: '/other/' });
    expect(after.status.listening).toBe(true);
    const saved = JSON.parse(readFileSync(join(dataDir, 'web.json'), 'utf8')) as { enabled: boolean; port: number; basePath: string };
    expect(saved).toMatchObject({ enabled: false, port: 4330, basePath: '/other/' });
    expect((await get('/other/healthz')).status).toBe(200);
    expect((await get('/healthz')).status).toBe(200);
  });

  it('runs the workspace it is told to and leaves the registry current one alone', async () => {
    const wc = await import('../src/main/workspaces-core');
    wc.ensureWorkspaces(dataDir);
    wc.createWorkspace(dataDir, { name: 'Second', copySettings: false });
    const before = readFileSync(join(dataDir, 'workspaces.json'), 'utf8');
    const { main } = await entry();
    running = await main(args(['--workspace', 'second']), {}, { exit: vi.fn(), out: () => undefined, err: () => undefined });
    expect(running).not.toBeNull();
    expect(JSON.parse((await get('/cerimonias/healthz')).body).workspace).toBe('second');
    expect(readFileSync(join(dataDir, 'workspaces.json'), 'utf8')).toBe(before);
  });

  it('reads its options from the environment, COXIA_DATA_DIR over CERIMONIAS_DATA_DIR', async () => {
    const { main } = await entry();
    const env = { COXIA_DATA_DIR: dataDir, CERIMONIAS_DATA_DIR: join(sandbox, 'other'), COXIA_MASTER_KEY_FILE: keyFile, COXIA_PORT: String(port), COXIA_HOST: '127.0.0.1' };
    running = await main([], env, { exit: vi.fn(), out: () => undefined, err: () => undefined });
    expect(running).not.toBeNull();
    expect((await get('/cerimonias/healthz')).status).toBe(200);
    expect(existsSync(join(sandbox, 'other'))).toBe(false);
  });

  it('writes nothing outside its data folder', async () => {
    const { main } = await entry();
    const before = tree(sandbox).filter((f) => !f.startsWith('data'));
    const exit = vi.fn();
    const started = await main(args(), {}, { exit, out: () => undefined, err: () => undefined });
    running = started;
    await started?.signals.deliver('SIGTERM');
    expect(tree(sandbox).filter((f) => !f.startsWith('data'))).toEqual(before);
    expect(before).toEqual(['master.key']);
    expect(tree(dataDir).length).toBeGreaterThan(0);
  });
});

describe('main refuses to start', () => {
  async function refused(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | undefined; err: string }> {
    const { main } = await entry();
    const exit = vi.fn();
    const err: string[] = [];
    const started = await main(argv, env, { exit, out: () => undefined, err: (l) => err.push(l) });
    expect(started).toBeNull();
    return { code: exit.mock.calls[0]?.[0], err: err.join('\n') };
  }

  it('without a master key file', async () => {
    const r = await refused(['--data-dir', dataDir, '--port', String(port)]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--master-key-file is required/);
  });

  it('with a key file that does not exist, is open to others, is not a key, or sits in the data folder', async () => {
    const open = join(sandbox, 'open.key');
    writeFileSync(open, `${randomBytes(32).toString('hex')}\n`);
    chmodSync(open, 0o644);
    const junk = join(sandbox, 'junk.key');
    writeFileSync(junk, 'not a key\n', { mode: 0o600 });
    const inside = join(dataDir, 'inside.key');
    writeFileSync(inside, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    for (const file of [join(sandbox, 'absent.key'), open, junk, inside]) {
      vi.resetModules();
      const r = await refused(['--data-dir', dataDir, '--master-key-file', file, '--port', String(port)]);
      expect(r.code, file).toBe(1);
      expect(r.err, file).toContain(file);
    }
    // And the door never opened.
    await expect(get('/cerimonias/healthz')).rejects.toThrow();
  });

  it('without a data folder, even when the default one exists', async () => {
    const r = await refused(['--master-key-file', keyFile, '--port', String(port)]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--data-dir is required/);
  });

  it('with a port or host the web door would not accept, or an option it does not know', async () => {
    for (const bad of [['--port', '80'], ['--port', 'abc'], ['--host', 'not a host'], ['--nope']]) {
      vi.resetModules();
      const base = ['--data-dir', dataDir, '--master-key-file', keyFile];
      const withPort = bad[0] === '--port' ? [] : ['--port', String(port)];
      const r = await refused([...base, ...withPort, ...bad]);
      expect(r.code, bad.join(' ')).toBe(1);
    }
  });

  it('for a workspace the registry does not list', async () => {
    const wc = await import('../src/main/workspaces-core');
    wc.ensureWorkspaces(dataDir);
    const r = await refused(args(['--workspace', 'ghost']));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ghost/);
  });

  it('when the port is taken, and says so instead of running without a door', async () => {
    const taken = createServer();
    await new Promise<void>((r) => taken.listen(port, '127.0.0.1', r));
    try {
      const r = await refused(args());
      expect(r.code).toBe(1);
      // The language is the workspace's by then: either wording says the port is taken.
      expect(r.err).toMatch(/already in use|já está em uso/);
    } finally {
      await new Promise((r) => taken.close(r));
    }
  });

  it('prints the usage and exits 0 on --help', async () => {
    const { main } = await entry();
    const exit = vi.fn();
    const out: string[] = [];
    await main(['--help'], {}, { exit, out: (l) => out.push(l), err: () => undefined });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(out.join('\n')).toContain('--master-key-file');
  });
});

describe('main --init', () => {
  it('creates the workspace registry of an empty data folder, says its first workspace and exits 0, with no key, port or door', async () => {
    const { main } = await entry();
    const exit = vi.fn();
    const out: string[] = [];
    expect(await main(['--init', '--data-dir', dataDir], {}, { exit, out: (l) => out.push(l), err: () => undefined })).toBeNull();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(out).toEqual(['principal']);
    expect(JSON.parse(readFileSync(join(dataDir, 'workspaces.json'), 'utf8'))).toMatchObject({ current: 'principal' });
    // The config is made as a fresh install's, here and not by the next process, which would take the registry for an older install.
    expect(JSON.parse(readFileSync(join(dataDir, 'config-migration.json'), 'utf8'))).toMatchObject({ existingInstall: false });
    expect(tree(dataDir)).toContain(join('workspaces', 'principal', 'config.json'));
    expect(tree(dataDir).some((f) => f.endsWith('admin.sock'))).toBe(false);
  });

  it('still needs the data folder', async () => {
    const { main } = await entry();
    const exit = vi.fn();
    expect(await main(['--init'], {}, { exit, out: () => undefined, err: () => undefined })).toBeNull();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
