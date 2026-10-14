// The desktop as a client of a remote instance (#211). No real SSH: a fake `ssh` pipes the forwarded socket to the admin socket of a real in-process core, in a temp folder.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const FAKE = join(import.meta.dirname, 'helpers/fake-ssh.mjs');
const HOST_KEY = Buffer.from('a fake ed25519 host key blob').toString('base64');
const PEM_BODY = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACA';

let sandbox = '';
let cleanup: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  vi.resetModules();
  sandbox = mkdtempSync(join(tmpdir(), 'cxi-'));
  cleanup = [];
});
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

function fakeCommands() {
  const wrap = (name: string, program: string): string => {
    const path = join(sandbox, name);
    writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${program} "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  };
  return { ssh: wrap('ssh', 'ssh'), keyscan: wrap('ssh-keyscan', 'keyscan'), keygen: wrap('ssh-keygen', 'keygen') };
}

const keyStore = () => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    set: (input: { ref: string }) => (stored.set(input.ref, input), { ref: input.ref }) as never,
    remove: (ref: string) => void stored.delete(ref),
    resolve: (ref: string) => `-----BEGIN OPENSSH PRIVATE KEY----- ${PEM_BODY} -----END OPENSSH PRIVATE KEY-----`.replace(ref, ref),
  };
};

async function remote(extra: { fail?: boolean } = {}) {
  (await import('../src/shared/i18n')).setLanguage('en');
  const m = { ...(await import('../src/main/core')), rpc: await import('../src/main/rpc'), env: await import('../src/main/env'), door: await import('../src/shared/adminDoor'), bridge: await import('../src/main/instanceBridge'), core2: await import('../src/main/instances-core'), channels: await import('../src/main/instanceChannels') };
  const dataDir = join(sandbox, 'server');
  mkdirSync(dataDir);
  const core = m.createCoxia({ dataDir, adminDoor: true });
  cleanup.push(() => core.stop({ deadlineMs: 500 }));
  await core.start();
  // The core takes the language of the workspace it starts; the assertions read English.
  (await import('../src/shared/i18n')).setLanguage('en');
  const real = join(m.env.atasDir(), m.door.ADMIN_SOCKET_NAME);
  const workspace = m.env.workspaceId();
  const root = join(sandbox, 'desktop');
  mkdirSync(root);
  const log = join(sandbox, 'ssh.log');
  writeFileSync(log, '');
  const def = { id: 'vps', name: 'VPS', sshTarget: 'coxia@example.com:2222', remoteDataDir: '/srv/coxia', workspace, keyRef: 'instance.vps.ssh-key', via: 'socket' as const };
  const remoteSock = `/srv/coxia/workspaces/${workspace}/admin.sock`;
  Object.assign(process.env, { FAKE_SSH_LOG: log, FAKE_SSH_REAL: real, FAKE_SSH_REMOTE: remoteSock, FAKE_HOST_KEY: HOST_KEY });
  if (extra.fail) process.env.FAKE_SSH_FAIL = '1';
  cleanup.push(() => {
    for (const k of ['FAKE_SSH_LOG', 'FAKE_SSH_REAL', 'FAKE_SSH_REMOTE', 'FAKE_HOST_KEY', 'FAKE_SSH_FAIL']) delete process.env[k];
  });
  const spawned = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { pid: number; args: string[]; local: string; remote: string; keyMode: string; keyHad: string });
  return { ...m, core, def, root, spawned, commands: fakeCommands(), keys: keyStore(), workspace };
}

const until = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('the list of instances', () => {
  it('keeps a reference to the key and never the key', async () => {
    const m = await remote();
    const keys = keyStore();
    const added = m.core2.addInstance(m.root, { name: 'My VPS', sshTarget: 'coxia@example.com', workspace: 'main', key: { source: 'stored', value: 'SECRET-KEY-MATERIAL' } as never }, keys);
    expect(added).toMatchObject({ id: 'my-vps', keyRef: 'instance.my-vps.ssh-key', remoteDataDir: '/var/lib/coxia/data' });
    expect(keys.stored.get('instance.my-vps.ssh-key')).toMatchObject({ value: 'SECRET-KEY-MATERIAL' });
    const file = readFileSync(join(m.root, 'instances.json'), 'utf8');
    expect(file).not.toContain('SECRET-KEY-MATERIAL');
    expect(file).toContain('instance.my-vps.ssh-key');
    expect((statSync(join(m.root, 'instances.json')).mode & 0o777).toString(8)).toBe('600');
  });

  it.each([
    [{ name: '' }, 'name'],
    [{ sshTarget: '-oProxyCommand=x@y' }, 'SSH address'],
    [{ sshTarget: 'coxia@host:99999' }, 'SSH address'],
    [{ remoteDataDir: 'relative' }, 'data folder'],
    [{ remoteDataDir: '/a:b' }, 'data folder'],
    [{ workspace: '../x' }, 'workspace id'],
  ])('refuses %j', async (patch, word) => {
    const m = await remote();
    const input = { name: 'A', sshTarget: 'coxia@example.com', workspace: 'main', key: { source: 'env', name: 'K' }, ...patch } as never;
    expect(() => m.core2.addInstance(m.root, input, keyStore())).toThrow(new RegExp(word, 'i'));
  });

  it('selects, falls back to the local core when the selected one is gone, and removes the key with the instance', async () => {
    const m = await remote();
    const keys = keyStore();
    const a = m.core2.addInstance(m.root, { name: 'A', sshTarget: 'coxia@example.com', workspace: 'main', key: { source: 'env', name: 'K' } } as never, keys);
    expect(m.core2.selectInstance(m.root, a.id).current).toBe('a');
    expect(m.core2.readInstances(m.root).current).toBe('a');
    m.core2.removeInstance(m.root, 'a', keys);
    expect(keys.stored.size).toBe(0);
    expect(m.core2.readInstances(m.root)).toEqual({ current: 'local', list: [] });
    expect(() => m.core2.selectInstance(m.root, 'nope')).toThrow();
    expect(m.core2.selectInstance(m.root, 'local').current).toBe('local');
  });

  it('reads an entry saved without `via` as socket and a new one as server', async () => {
    const m = await remote();
    const { writeFileSync: w } = await import('node:fs');
    w(join(m.root, 'instances.json'), JSON.stringify({ current: 'old', list: [{ id: 'old', name: 'Old', sshTarget: 'coxia@example.com', remoteDataDir: '/srv/coxia', workspace: 'main', keyRef: 'instance.old.ssh-key' }] }));
    expect(m.core2.readInstances(m.root).list[0]).toMatchObject({ id: 'old', via: 'socket' });
    const added = m.core2.addInstance(m.root, { name: 'New', sshTarget: 'coxia@example.com', workspace: 'main', key: { source: 'env', name: 'K' } } as never, keyStore());
    expect(added.via).toBe('server');
    expect(m.core2.readInstances(m.root).list.map((i) => i.via)).toEqual(['socket', 'server']);
    expect(m.core2.addInstance(m.root, { name: 'Fwd', sshTarget: 'coxia@example.com', workspace: 'main', via: 'socket', key: { source: 'env', name: 'K' } } as never, keyStore()).via).toBe('socket');
    expect(() => m.core2.addInstance(m.root, { name: 'Odd', sshTarget: 'coxia@example.com', workspace: 'main', via: 'carrier-pigeon', key: { source: 'env', name: 'K' } } as never, keyStore())).toThrow(/coxia-server/);
  });

  it('puts the line breaks and the final newline back into a key pasted on one line', async () => {
    const m = await remote();
    const out = m.core2.normalizeKey(`-----BEGIN OPENSSH PRIVATE KEY-----${PEM_BODY}-----END OPENSSH PRIVATE KEY-----`);
    expect(out.split('\n')[0]).toBe('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(out.endsWith('-----END OPENSSH PRIVATE KEY-----\n')).toBe(true);
    expect(out.replace(/\s/g, '')).toContain(PEM_BODY);
  });

  it('asks ssh for a strict host key, only the given key and no user configuration', async () => {
    const m = await remote();
    const args = m.core2.sshArgs(m.def, { user: 'coxia', host: 'example.com', port: 2222 }, { knownHosts: '/k', keyFile: '/key', localSocket: '/l.sock' });
    expect(args).toEqual(expect.arrayContaining(['StrictHostKeyChecking=yes', 'IdentitiesOnly=yes', 'ExitOnForwardFailure=yes', 'StreamLocalBindUnlink=yes', 'BatchMode=yes', 'UserKnownHostsFile=/k', '/dev/null']));
    expect(args).toContain(`/l.sock:/srv/coxia/workspaces/${m.workspace}/admin.sock`);
    expect(args.at(-1)).toBe('coxia@example.com');
    expect(args[args.indexOf('-p') + 1]).toBe('2222');
  });
});

describe('the link through coxia-server bridge', () => {
  const viaServer = <D extends object>(m: { def: D }) => ({ ...m.def, via: 'server' as const });

  it('asks for the bridge as the remote command, with no forward and no -N', async () => {
    const m = await remote();
    const args = m.core2.sshBridgeArgs(viaServer(m), { user: 'admin', host: 'example.com', port: 2222 }, { knownHosts: '/k', keyFile: '/key' });
    expect(args).toEqual([
      '-T', '-F', '/dev/null',
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=/k',
      '-o', 'GlobalKnownHostsFile=/dev/null',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=15',
      '-i', '/key',
      '-p', '2222',
      'admin@example.com',
      'coxia-server', 'bridge', m.workspace,
    ]);
    expect(() => m.core2.sshBridgeArgs({ ...m.def, via: 'server' as const, workspace: 'x; rm -rf ~' }, { user: 'a', host: 'example.com', port: 22 }, { knownHosts: '/k', keyFile: '/key' })).toThrow(/workspace id/);
  });

  it('keeps the exact argv of the forward for the socket mode', async () => {
    const m = await remote();
    const args = m.core2.sshArgs(m.def, { user: 'coxia', host: 'example.com', port: 22 }, { knownHosts: '/k', keyFile: '/key', localSocket: '/l.sock' });
    expect(args.slice(0, 2)).toEqual(['-N', '-T']);
    expect(args.slice(-3)).toEqual(['-L', `/l.sock:/srv/coxia/workspaces/${m.workspace}/admin.sock`, 'coxia@example.com']);
  });

  it('says hello, answers a call, and removes the key file once the hello is answered', async () => {
    const m = await remote();
    const link = await m.bridge.openLink({ def: viaServer(m), root: m.root, keys: m.keys, commands: m.commands });
    cleanup.push(() => link.close());
    expect(link.workspace).toBe(m.workspace);
    expect(((await link.call('ownership:status', [])) as { role: string }).role).toBe('owner');
    const [run] = m.spawned();
    expect(run?.args.slice(-3)).toEqual(['coxia-server', 'bridge', m.workspace]);
    expect(run?.args).not.toContain('-L');
    expect(run?.keyMode).toBe('600');
    expect(existsSync(run?.args[(run?.args.indexOf('-i') ?? 0) + 1] as string)).toBe(false);
    link.close();
    await link.closed;
  });

  it('is a lost link when the ssh child exits, and fails a call in flight', async () => {
    const m = await remote();
    let release: () => void = () => undefined;
    m.rpc.handle('test:slow', () => new Promise<string>((r) => (release = () => r('done'))));
    const link = await m.bridge.openLink({ def: viaServer(m), root: m.root, keys: m.keys, commands: m.commands });
    cleanup.push(() => link.close());
    const inFlight = link.call('test:slow', []);
    await new Promise((r) => setTimeout(r, 100));
    process.kill(m.spawned()[0]?.pid as number, 'SIGKILL');
    await expect(inFlight).rejects.toMatchObject({ code: 'connection-lost' });
    await link.closed;
    await expect(link.call('ownership:status', [])).rejects.toMatchObject({ code: 'connection-lost' });
    release();
  });

  it('says why ssh failed and leaves no key file behind', async () => {
    const m = await remote({ fail: true });
    await expect(m.bridge.openLink({ def: viaServer(m), root: m.root, keys: m.keys, commands: m.commands })).rejects.toThrow(/Permission denied/);
    expect(existsSync(m.spawned()[0]?.args[(m.spawned()[0]?.args.indexOf('-i') ?? 0) + 1] as string)).toBe(false);
  });
});

describe('the link', () => {
  it('forwards a call, answers it, and removes the key file as soon as the forwarding is up', async () => {
    const m = await remote();
    const link = await m.bridge.openLink({ def: m.def, root: m.root, keys: m.keys, commands: m.commands });
    cleanup.push(() => link.close());
    expect(link.workspace).toBe(m.workspace);
    const status = (await link.call('ownership:status', [])) as { role: string };
    expect(status.role).toBe('owner');
    const [run] = m.spawned();
    expect(run?.keyMode).toBe('600');
    expect(run?.keyHad).toBe('-----BEGIN ');
    const keyFile = run?.args[(run?.args.indexOf('-i') ?? 0) + 1] as string;
    expect(existsSync(keyFile)).toBe(false);
    expect(run?.remote).toBe(`/srv/coxia/workspaces/${m.workspace}/admin.sock`);
    link.close();
    await link.closed;
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('coxia-ssh-') && existsSync(join(tmpdir(), f, 'a.sock')))).toEqual([]);
  });

  it('carries a recording and any other binary value both ways', async () => {
    const m = await remote();
    m.rpc.handle('test:bytes', (audio: ArrayBuffer) => ({ size: audio.byteLength, same: new Uint8Array(audio)[3], back: audio }));
    const link = await m.bridge.openLink({ def: m.def, root: m.root, keys: m.keys, commands: m.commands });
    cleanup.push(() => link.close());
    const sent = new Uint8Array([9, 8, 7, 6, 5]).buffer;
    const got = (await link.call('test:bytes', [sent])) as { size: number; same: number; back: ArrayBuffer };
    expect(got.size).toBe(5);
    expect(got.same).toBe(6);
    expect(got.back).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(got.back)]).toEqual([9, 8, 7, 6, 5]);
  });

  it('hands over the events of the instance', async () => {
    const m = await remote();
    const events: Array<{ type: string }> = [];
    const link = await m.bridge.openLink({ def: m.def, root: m.root, keys: m.keys, commands: m.commands, onEvent: (e) => events.push(e) });
    cleanup.push(() => link.close());
    const settings = await link.call('settings:get', []);
    await link.call('settings:save', [settings]);
    await until(() => events.some((e) => e.type === 'settings'));
  });

  it('shows the refusal of another contract version with both numbers', async () => {
    const m = await remote();
    const { createServer } = await import('node:net');
    const odd = join(sandbox, 'odd.sock');
    const server = createServer((s) => s.on('data', () => s.end(`${JSON.stringify({ error: { code: 'contract-mismatch', message: 'client 1 instance 2' } })}\n`)));
    await new Promise<void>((r) => server.listen(odd, r));
    cleanup.push(() => void server.close());
    process.env.FAKE_SSH_REAL = odd;
    await expect(m.bridge.openLink({ def: m.def, root: m.root, keys: m.keys, commands: m.commands })).rejects.toMatchObject({ code: 'contract-mismatch', message: 'client 1 instance 2' });
  });

  it('says why ssh failed and leaves no key file behind', async () => {
    const m = await remote({ fail: true });
    await expect(m.bridge.openLink({ def: m.def, root: m.root, keys: m.keys, commands: m.commands })).rejects.toThrow(/Permission denied/);
    const [run] = m.spawned();
    expect(existsSync(run?.args[(run?.args.indexOf('-i') ?? 0) + 1] as string)).toBe(false);
  });

  it('tells a workspace without a door from a refusal', async () => {
    const m = await remote();
    await expect(m.bridge.openLink({ def: { ...m.def, remoteDataDir: '/elsewhere' }, root: m.root, keys: m.keys, commands: m.commands, timeoutMs: 3000 })).rejects.toThrow(/admin socket/);
  });
});

describe('the bridge', () => {
  it('fails a call in flight when the link drops, does not send it again, reconnects, and goes on', async () => {
    const m = await remote();
    let runs = 0;
    let release: () => void = () => undefined;
    m.rpc.handle('test:slow', () => {
      runs++;
      return new Promise<string>((r) => {
        release = () => r('done');
      });
    });
    m.rpc.handle('test:count', () => runs);
    const states: string[] = [];
    const bridge = m.bridge.createInstanceBridge({ def: m.def, root: m.root, keys: m.keys, commands: m.commands, backoffMs: { base: 30, max: 100 }, onStatus: (s) => states.push(s.link) });
    cleanup.push(() => bridge.stop());
    bridge.start();
    await until(() => bridge.status().link === 'connected' && bridge.status().role === 'owner');
    expect(bridge.status().instance).toEqual({ id: 'vps', name: 'VPS' });

    const inFlight = bridge.call('test:slow', []);
    await until(() => runs === 1);
    process.kill(m.spawned()[0]?.pid as number, 'SIGKILL');
    await expect(inFlight).rejects.toMatchObject({ code: 'connection-lost' });
    // Down: a new call is refused at once instead of waiting or being queued.
    await expect(bridge.call('test:count', [])).rejects.toMatchObject({ code: 'connection-lost' });
    await until(() => m.spawned().length === 2 && bridge.status().link === 'connected');
    expect(states).toContain('reconnecting');
    expect(await bridge.call('test:count', [])).toBe(1);
    expect(runs).toBe(1);
    release();
  });

  it('reports a server it cannot reach as lost and keeps trying', async () => {
    const m = await remote({ fail: true });
    const bridge = m.bridge.createInstanceBridge({ def: m.def, root: m.root, keys: m.keys, commands: m.commands, backoffMs: { base: 20, max: 40 } });
    cleanup.push(() => bridge.stop());
    bridge.start();
    await until(() => bridge.status().link === 'lost' && m.spawned().length >= 3);
    expect(bridge.status().detail).toMatch(/Permission denied/);
    delete process.env.FAKE_SSH_FAIL;
    await until(() => bridge.status().link === 'connected');
  });

  it('puts the state in the events of the window', async () => {
    const m = await remote();
    const events: Array<{ type: string; name?: string; payload?: { link: string } }> = [];
    const bridge = m.bridge.createInstanceBridge({ def: m.def, root: m.root, keys: m.keys, commands: m.commands, onEvent: (e) => events.push(e as never) });
    cleanup.push(() => bridge.stop());
    bridge.start();
    await until(() => events.some((e) => e.name === 'instance:state' && e.payload?.link === 'connected'));
  });
});

describe('the channels of the instances', () => {
  const make = async (m: Awaited<ReturnType<typeof remote>>, restart = vi.fn()) => ({
    restart,
    ch: m.channels.createInstanceChannels({
      root: m.root,
      running: 'local',
      keys: Object.assign(m.keys, { storage: () => ({ secure: true, backend: 'x', insecureAccepted: false, canStore: true }), acceptInsecureStorage: () => undefined }),
      status: () => ({ instance: null, link: 'connected', role: null, detail: '' }),
      restart,
      commands: m.commands,
      restartDelayMs: 0,
    }),
  });

  it('asks the person to trust an unknown host, refuses another key, and then connects', async () => {
    const m = await remote();
    const { ch } = await make(m);
    const added = ch.add({ name: 'VPS', sshTarget: 'coxia@example.com:2222', remoteDataDir: '/srv/coxia', workspace: m.workspace, via: 'socket', key: { source: 'env', name: 'K' } } as never);
    const id = added.list[0]?.id as string;
    const first = await ch.test(id);
    expect(first).toMatchObject({ ok: false, code: 'host-unknown' });
    const fingerprint = (first as { fingerprints: string[] }).fingerprints[0] as string;
    expect(fingerprint).toMatch(/^SHA256:/);
    await expect(ch.trust(id, 'SHA256:other')).rejects.toMatchObject({ code: 'conflict' });
    expect(existsSync(m.core2.knownHostsPath(m.root))).toBe(false);
    const ok = await ch.trust(id, fingerprint);
    expect(ok).toMatchObject({ ok: true, workspace: m.workspace, role: 'owner' });
    expect(readFileSync(m.core2.knownHostsPath(m.root), 'utf8')).toContain(`[example.com]:2222 ssh-ed25519 ${HOST_KEY}`);
    expect((statSync(m.core2.knownHostsPath(m.root)).mode & 0o777).toString(8)).toBe('600');
  });

  it('relaunches for another instance and not for the one in use, and will not remove the one in use', async () => {
    const m = await remote();
    const { ch, restart } = await make(m);
    const id = ch.add({ name: 'VPS', sshTarget: 'coxia@example.com', workspace: 'main', via: 'socket', key: { source: 'env', name: 'K' } } as never).list[0]?.id as string;
    expect(ch.select('local')).toEqual({ restarting: false });
    expect(ch.select(id)).toEqual({ restarting: true });
    await until(() => restart.mock.calls.length === 1);
    expect(ch.list().current).toBe(id);
    expect(ch.select('local')).toEqual({ restarting: false });
    expect(ch.list().current).toBe('local');
    expect(ch.remove(id).list).toEqual([]);
  });
});

describe('the desktop entry', () => {
  const index = readFileSync(join(import.meta.dirname, '../src/main/index.ts'), 'utf8');

  it('does not make or start the core while an instance is selected, and wires every other channel to the bridge', () => {
    expect(index).toMatch(/const core = REMOTE\s*\? null\s*: createCoxia\(/);
    expect(index).toContain('if (core) await core.start();');
    expect(index).toMatch(/for \(const channel of CHANNELS\) \{\s*if \(own\.has\(channel\)\) continue;\s*ipcMain\.handle\(channel, \(_e, \.\.\.args\) => settle\(\(\) => b\.call\(channel, args\)\)\);/);
    expect(index).toContain('new Set<string>(DESKTOP_CHANNELS)');
  });

  it('keeps the window\'s own channels on this computer', async () => {
    const { DESKTOP_CHANNELS, CHANNELS } = await import('../src/shared/contract');
    for (const c of DESKTOP_CHANNELS) {
      expect(CHANNELS as readonly string[]).toContain(c);
      expect(index).toContain(`handle('${c}'`);
    }
    expect(DESKTOP_CHANNELS.filter((c) => c.startsWith('instances:')).length).toBe(7);
  });
});
