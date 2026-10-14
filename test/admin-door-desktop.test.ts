// The desktop's admin door (#309): off unless the person switched it on in the window, kept in the data root, switched from the window alone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webAccess } from '../src/main/webPolicy';

vi.setConfig({ testTimeout: 60_000 });

let dataDir = '';
let cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetModules();
  dataDir = join(mkdtempSync(join(tmpdir(), 'cxd-')), 'data');
  mkdirSync(dataDir);
  cleanup = [];
});
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function boot() {
  const m = { ...(await import('../src/main/core')), rpc: await import('../src/main/rpc'), env: await import('../src/main/env') };
  // What the desktop does: the window's channels are bound to IPC and a call through it is the window's.
  const ipc = new Map<string, (...a: unknown[]) => unknown>();
  m.rpc.bindIpc((channel, fn) => void ipc.set(channel, fn as (...a: unknown[]) => unknown));
  const core = m.createCoxia({ dataDir });
  cleanup.push(() => core.stop({ deadlineMs: 500 }));
  await core.start();
  return { ...m, core, ipc, socket: join(m.env.atasDir(), 'admin.sock') };
}

describe('the admin door of the desktop', () => {
  it('is off by default: no socket and no state', async () => {
    const { core, socket, ipc } = await boot();
    expect(core.adminDoor()).toBeNull();
    expect(existsSync(socket)).toBe(false);
    expect(await ipc.get('adminDoor:get')?.()).toMatchObject({ enabled: false, listening: false });
    expect(existsSync(join(dataDir, 'admin-door.json'))).toBe(false);
  });

  it('opens at once when the window switches it on, closes when it switches it off, and remembers it across a start', async () => {
    let m = await boot();
    expect(await m.ipc.get('adminDoor:set')?.(true)).toMatchObject({ enabled: true, listening: true });
    expect(existsSync(m.socket)).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, 'admin-door.json'), 'utf8'))).toEqual({ enabled: true });
    // The one state the person's window shows is the same the door reports.
    expect(m.core.adminDoor()).toMatchObject({ listening: true });
    await cleanup.pop()?.();

    vi.resetModules();
    m = await boot();
    expect(m.core.adminDoor()).toMatchObject({ listening: true });
    expect(await m.ipc.get('adminDoor:set')?.(false)).toMatchObject({ enabled: false, listening: false });
    expect(existsSync(m.socket)).toBe(false);
    expect(m.core.adminDoor()).toBeNull();
  });

  it('reads an unreadable setting as off', async () => {
    writeFileSync(join(dataDir, 'admin-door.json'), '{not json');
    const { core } = await boot();
    expect(core.adminDoor()).toBeNull();
  });

  it('is not switched through the admin door itself, nor by a paired browser', async () => {
    const { rpc, ipc } = await boot();
    await ipc.get('adminDoor:set')?.(true);
    await expect(rpc.invokeAdmin('adminDoor:set', [false])).rejects.toMatchObject({ code: 'forbidden' });
    await expect(rpc.invoke('adminDoor:set', [false], 'device-1')).rejects.toMatchObject({ code: 'forbidden' });
    expect(await ipc.get('adminDoor:get')?.()).toMatchObject({ enabled: true });
    for (const channel of ['adminDoor:get', 'adminDoor:set']) {
      expect(webAccess(channel, false)).toBe('deny');
      expect(webAccess(channel, true)).toBe('deny');
    }
    await expect(ipc.get('adminDoor:set')?.('yes')).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('is left to the host when the host says so: the headless flag wins over the file', async () => {
    writeFileSync(join(dataDir, 'admin-door.json'), JSON.stringify({ enabled: true }));
    const { createCoxia } = await import('../src/main/core');
    const core = createCoxia({ dataDir, adminDoor: false });
    cleanup.push(() => core.stop({ deadlineMs: 500 }));
    await core.start();
    expect(core.adminDoor()).toBeNull();
  });
});
