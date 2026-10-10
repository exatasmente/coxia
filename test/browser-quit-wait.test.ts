// The quit waits for the open screens, but only for a few seconds: a browser that does not answer must not hold the app open.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUIT_WAIT_MS, settleWithin } from '../src/main/browser/quit';

afterEach(() => vi.useRealTimers());

describe('waiting for the screens at quit', () => {
  it('is done as soon as the work is, and as soon as it fails: it never rejects', async () => {
    expect(await settleWithin(Promise.resolve(1), 50)).toBe('done');
    expect(await settleWithin(Promise.reject(new Error('no')), 50)).toBe('done');
  });

  it('gives up after the time it was given, and does not wait for work that never ends', async () => {
    vi.useFakeTimers();
    const pending = settleWithin(new Promise(() => undefined), QUIT_WAIT_MS);
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS - 1);
    let settled: string | null = null;
    void pending.then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBe('late');
  });

  it('is a few seconds, inside the 8 seconds the update flow gives a quit', () => {
    expect(QUIT_WAIT_MS).toBeGreaterThan(0);
    expect(QUIT_WAIT_MS).toBeLessThan(8000);
  });
});
