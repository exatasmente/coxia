// The core as a value (#206): it starts and stops in one process, and leaves nothing running behind. Each test loads the modules afresh, as a new process would:
// the modules keep their registrations for the life of a process, so a second start in the same one is refused rather than half-honoured.
import { mkdtempSync, readFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

/** What keeps a process alive, by kind: the handles and timers that are not the test runner's own. */
const live = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const name of process.getActiveResourcesInfo()) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
};

// A closed handle is still listed until its close callback has run, a few milliseconds later.
const settled = async (): Promise<Record<string, number>> => {
  await new Promise((r) => setTimeout(r, 50));
  return live();
};

let dataDir = '';

beforeEach(() => {
  vi.resetModules();
  dataDir = mkdtempSync(join(tmpdir(), 'cerimonias-core-'));
});
afterEach(() => {
  vi.useRealTimers();
});

const load = async () => ({ ...(await import('../src/main/core')), ...(await import('../src/main/signals')), env: await import('../src/main/env') });

describe('createCoxia', () => {
  it('fixes the data folder it is given and starts nothing', async () => {
    const { createCoxia, env } = await load();
    const before = await settled();
    createCoxia({ dataDir });
    expect(env.dataRoot()).toBe(dataDir);
    expect(await settled()).toEqual(before);
  });

  it('starts and stops in one process with no timer, server or listener left behind', async () => {
    const { createCoxia } = await load();
    const before = await settled();
    const uncaught = process.listenerCount('uncaughtException');
    const core = createCoxia({ dataDir });
    await core.start();
    // It is really running: the scheduler's timers are alive.
    expect(live().Timeout ?? 0).toBeGreaterThan(before.Timeout ?? 0);
    expect(process.listenerCount('uncaughtException')).toBe(uncaught + 1);

    const started = Date.now();
    await core.stop({ deadlineMs: 2_000 });
    expect(Date.now() - started).toBeLessThan(2_000);

    expect(await settled()).toEqual(before);
    expect(process.listenerCount('uncaughtException')).toBe(uncaught);
  });

  it('closes the web door it opened', async () => {
    const { createCoxia } = await load();
    const { saveWebSettings } = await import('../src/main/config');
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    const before = await settled();
    const core = createCoxia({ dataDir });
    saveWebSettings({ enabled: true, host: '127.0.0.1', port, basePath: '/', publicUrl: `http://127.0.0.1:${port}`, trustedProxy: '127.0.0.1/32', allowExternalEffects: false });
    await core.start();
    expect(live().TCPServerWrap ?? 0).toBeGreaterThan(before.TCPServerWrap ?? 0);
    await core.stop({ deadlineMs: 2_000 });
    expect(await settled()).toEqual(before);
  });

  it('can be stopped twice, and before it was started', async () => {
    const { createCoxia } = await load();
    const core = createCoxia({ dataDir });
    await core.stop({ deadlineMs: 500 });
    await core.start();
    await Promise.all([core.stop({ deadlineMs: 500 }), core.stop({ deadlineMs: 500 })]);
    await core.stop();
  });

  it('refuses to start twice, and to start again after a stop', async () => {
    const { createCoxia } = await load();
    const core = createCoxia({ dataDir });
    await core.start();
    await expect(core.start()).rejects.toThrow(/already started/);
    await core.stop({ deadlineMs: 500 });
    await expect(core.start()).rejects.toThrow(/already started/);
  });

  it('serves the channels of the ceremonies to a host without a window', async () => {
    const { createCoxia } = await load();
    const { hasChannel } = await import('../src/main/rpc');
    const core = createCoxia({ dataDir });
    await core.start();
    expect(['state:load', 'cards:load', 'settings:get', 'runs:list'].map(hasChannel)).toEqual([true, true, true, true]);
    // What only a window can serve is not there.
    expect(hasChannel('clipboard:copy')).toBe(false);
    await core.stop({ deadlineMs: 500 });
  });
});

describe('installSignalHandlers', () => {
  it('stops the core on SIGTERM and SIGINT, then exits 0', async () => {
    const { installSignalHandlers } = await load();
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const stop = vi.fn(async () => undefined);
      const exit = vi.fn();
      const handlers = installSignalHandlers({ stop }, { deadlineMs: 123, exit });
      try {
        await handlers.deliver(signal);
      } finally {
        handlers.dispose();
      }
      expect(stop).toHaveBeenCalledWith({ deadlineMs: 123 });
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    }
  });

  it('exits 1 when the stop fails, and at once on a second signal', async () => {
    const { installSignalHandlers } = await load();
    const exit = vi.fn();
    let finish: () => void = () => undefined;
    const slow = installSignalHandlers({ stop: () => new Promise<void>((r) => (finish = r)) }, { exit });
    const first = slow.deliver('SIGTERM');
    await slow.deliver('SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    finish();
    await first;
    slow.dispose();

    const exit2 = vi.fn();
    const broken = installSignalHandlers({ stop: () => Promise.reject(new Error('boom')) }, { exit: exit2 });
    await broken.deliver('SIGINT');
    broken.dispose();
    expect(exit2).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('puts its listeners on the process and takes them off', async () => {
    const { installSignalHandlers } = await load();
    const term = process.listenerCount('SIGTERM');
    const int = process.listenerCount('SIGINT');
    const handlers = installSignalHandlers({ stop: async () => undefined }, { exit: () => undefined });
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]).toEqual([term + 1, int + 1]);
    handlers.dispose();
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]).toEqual([term, int]);
  });
});

describe('the desktop shell', () => {
  it('boots and quits through the core, and starts none of its parts itself', () => {
    const shell = readFileSync(join(import.meta.dirname, '../src/main/index.ts'), 'utf8');
    expect(shell).toContain('createCoxia(');
    expect(shell).toContain('core.start()');
    expect(shell).toContain('core.stop(');
    for (const part of ['MODULES', 'startScheduler', 'registerWebAccess', 'startVoice', 'startActions', 'installProcessHandlers']) expect(shell, part).not.toContain(part);
  });
});
