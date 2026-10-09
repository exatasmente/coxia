import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

process.env.CERIMONIAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'cerimonias-errors-rpc-'));

const { bindIpc, callOrigin, handle, handleDevice, invoke } = await import('../src/main/rpc');
const { errorsView, errorlog } = await import('../src/main/errorlog');
const { DATA_ROOT } = await import('../src/main/env');
const { readEntries } = await import('../src/main/errorlog-core');

const logs = () => readEntries(join(DATA_ROOT, 'logs'));

const ipc = new Map<string, (...args: unknown[]) => unknown>();
bindIpc((channel, fn) => ipc.set(channel, fn as (...args: unknown[]) => unknown));

describe('rpc failures reach the error log', () => {
  it('logs a sync failure from the web door without the arguments', async () => {
    handle('t:sync', (() => {
      throw new Error('sync boom');
    }) as never);
    await expect(invoke('t:sync', ['secret user text'], 'dev-1')).rejects.toThrow('sync boom');
    const last = logs().at(-1);
    expect(last).toMatchObject({ source: 'rpc:t:sync', message: 'sync boom', context: { channel: 't:sync', via: 'web' } });
    expect(JSON.stringify(last)).not.toContain('secret user text');
  });

  it('logs an async failure from the ipc door', async () => {
    handle('conflict:t-async', (async (_id: string) => {
      throw new Error('agent ended with error_max_turns');
    }) as never);
    await expect(ipc.get('conflict:t-async')?.('103-a', 'free text')).rejects.toThrow('error_max_turns');
    expect(logs().at(-1)).toMatchObject({ source: 'rpc:conflict:t-async', context: { via: 'ipc', id: '103-a' } });
  });

  it('logs device channel failures and does not log successes', async () => {
    handleDevice('t:dev', (() => {
      throw new Error('device boom');
    }) as never);
    handle('t:ok', (() => 'fine') as never);
    const before = logs().length;
    expect(await invoke('t:ok', [], 'dev-1')).toBe('fine');
    expect(logs()).toHaveLength(before);
    await expect(invoke('t:dev', [], 'dev-1')).rejects.toThrow('device boom');
    expect(logs().at(-1)?.message).toBe('device boom');
  });
});

describe('the door a call came through', () => {
  it('is known to the handler, across its awaits: ipc for the window and web for a browser', async () => {
    const seen: string[] = [];
    handle('t:origin', (async () => {
      seen.push(callOrigin());
      await new Promise((r) => setTimeout(r, 5));
      seen.push(callOrigin());
    }) as never);
    await ipc.get('t:origin')?.();
    await invoke('t:origin', [], 'dev-1');
    expect(seen).toEqual(['ipc', 'ipc', 'web', 'web']);
    // Outside a call it is the window's.
    expect(callOrigin()).toBe('ipc');
  });
});

describe('log:renderer', () => {
  const channels = new Map<string, (...args: unknown[]) => unknown>();
  errorlog({ handle: (c, fn) => void channels.set(c, fn as (...args: unknown[]) => unknown), notify() {}, emit() {}, job() {} });
  const send = (report: unknown) => channels.get('log:renderer')?.(report);

  it('stores a valid report redacted and capped', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    send({ kind: 'error', message: `bad Bearer abcdef123456 ${'x'.repeat(5000)}`, stack: 'at a (b.js:1:1)', platform: 'web' });
    const last = logs().at(-1);
    expect(last?.source).toBe('renderer:error');
    expect(last?.message).not.toContain('abcdef123456');
    expect(last?.message.length).toBeLessThanOrEqual(300);
    expect(last?.context).toEqual({ platform: 'web', kind: 'error' });
  });

  it('ignores junk and unknown kinds', () => {
    const before = logs().length;
    send(null);
    send('text');
    send({ kind: 'other', message: 'x' });
    send({ kind: 'error' });
    expect(logs()).toHaveLength(before);
  });

  it('rate limits a flood', () => {
    const before = logs().length;
    for (let i = 0; i < 100; i++) send({ kind: 'error', message: `flood ${i}` });
    expect(logs().length - before).toBeLessThanOrEqual(20);
    expect(errorsView().total).toBeGreaterThan(0);
  });
});
