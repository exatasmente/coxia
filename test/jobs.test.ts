import { describe, expect, it, vi } from 'vitest';
import { RESULT_TTL_MS, createJobStore, formatElapsed, notificationText, sameScreen, screenPayload } from '../src/renderer/src/jobs';

type S = { name: string; ref?: string };
const meta = (label = 'Gate 1 da 101'): { label: string; screen: S } => ({ label, screen: { name: 'gate', ref: 'web#101' } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function store(start = 1_000_000) {
  const clock = { t: start };
  return { clock, jobs: createJobStore<S>({ now: () => clock.t }) };
}

describe('job registry', () => {
  it('joins the running job under the same key instead of calling the agent twice', async () => {
    const { jobs } = store();
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const a = jobs.run('gate:start:web#101', meta(), fn);
    const b = jobs.run('gate:start:web#101', meta(), fn);
    expect(b).toBe(a);
    expect(fn).toHaveBeenCalledTimes(1);
    d.resolve('ok');
    await expect(a).resolves.toBe('ok');
  });

  it('tracks status, timestamps and the result', async () => {
    const { jobs, clock } = store();
    const d = deferred<{ id: number }>();
    void jobs.run('k', meta(), () => d.promise);
    const running = jobs.get('k');
    expect(running).toMatchObject({ status: 'running', startedAt: clock.t, finishedAt: null, error: null, label: 'Gate 1 da 101' });
    clock.t += 5_000;
    d.resolve({ id: 7 });
    await flush();
    expect(jobs.get('k')).toMatchObject({ status: 'done', startedAt: 1_000_000, finishedAt: 1_005_000, result: { id: 7 } });
  });

  it('keeps the error text of a failed job and rejects the caller', async () => {
    const { jobs } = store();
    const p = jobs.run('k', meta(), () => Promise.reject(new Error('sem rede')));
    await expect(p).rejects.toThrow('sem rede');
    await flush();
    expect(jobs.get('k')).toMatchObject({ status: 'failed', error: 'sem rede', result: undefined });
  });

  it('turns a synchronous throw into a failed job', async () => {
    const { jobs } = store();
    jobs.launch('k', meta(), () => {
      throw new Error('boom');
    });
    await flush();
    expect(jobs.get('k')?.status).toBe('failed');
  });

  it('uses the given error formatter', async () => {
    const jobs = createJobStore<S>({ errorText: (e) => `fmt:${String(e)}` });
    jobs.launch('k', meta(), () => Promise.reject('x'));
    await flush();
    expect(jobs.get('k')?.error).toBe('fmt:x');
  });

  it('starts a fresh run when the previous one already finished', async () => {
    const { jobs } = store();
    const fn = vi.fn(() => Promise.resolve(1));
    await jobs.run('k', meta(), fn);
    await flush();
    await jobs.run('k', meta(), fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('hands a finished job over once and removes it', async () => {
    const { jobs } = store();
    await jobs.run('k', meta(), () => Promise.resolve('r'));
    await flush();
    expect(jobs.take('k')?.result).toBe('r');
    expect(jobs.take('k')).toBeUndefined();
    expect(jobs.get('k')).toBeUndefined();
  });

  it('does not hand over a running job', () => {
    const { jobs } = store();
    jobs.launch('k', meta(), () => new Promise(() => undefined));
    expect(jobs.take('k')).toBeUndefined();
    expect(jobs.get('k')?.status).toBe('running');
  });

  it('keeps results for 30 minutes and no longer', async () => {
    const { jobs, clock } = store();
    await jobs.run('k', meta(), () => Promise.resolve('r'));
    await flush();
    clock.t += RESULT_TTL_MS - 1;
    expect(jobs.get('k')?.result).toBe('r');
    clock.t += 1;
    expect(jobs.get('k')).toBeUndefined();
    expect(jobs.finished('')).toEqual([]);
    expect(jobs.take('k')).toBeUndefined();
  });

  it('sweeps expired results and notifies', async () => {
    const { jobs, clock } = store();
    await jobs.run('a', meta(), () => Promise.resolve(1));
    await flush();
    const seen = vi.fn();
    jobs.subscribe(seen);
    jobs.sweep();
    expect(seen).not.toHaveBeenCalled();
    clock.t += RESULT_TTL_MS;
    jobs.sweep();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(jobs.snapshot()).toEqual([]);
  });

  it('never expires a running job', () => {
    const { jobs, clock } = store();
    jobs.launch('k', meta(), () => new Promise(() => undefined));
    clock.t += RESULT_TTL_MS * 4;
    jobs.sweep();
    expect(jobs.get('k')?.status).toBe('running');
  });

  it('lists running jobs first, then the finished ones newest first', async () => {
    const { jobs, clock } = store();
    await jobs.run('old', meta('old'), () => Promise.resolve(1));
    await flush();
    clock.t += 1000;
    await jobs.run('new', meta('new'), () => Promise.resolve(2));
    await flush();
    clock.t += 1000;
    jobs.launch('busy', meta('busy'), () => new Promise(() => undefined));
    expect(jobs.snapshot().map((j) => j.key)).toEqual(['busy', 'new', 'old']);
  });

  it('keeps the snapshot identity until something changes', async () => {
    const { jobs } = store();
    const empty = jobs.snapshot();
    expect(jobs.snapshot()).toBe(empty);
    jobs.launch('k', meta(), () => Promise.resolve(1));
    const one = jobs.snapshot();
    expect(one).not.toBe(empty);
    expect(jobs.snapshot()).toBe(one);
    await flush();
    expect(jobs.snapshot()).not.toBe(one);
  });

  it('notifies subscribers on start and finish, and stops after unsubscribe', async () => {
    const { jobs } = store();
    const seen = vi.fn();
    const off = jobs.subscribe(seen);
    jobs.launch('k', meta(), () => Promise.resolve(1));
    await flush();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    jobs.dismiss('k');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('tells finish listeners once per job, with the outcome', async () => {
    const { jobs } = store();
    const done = vi.fn();
    jobs.onFinish(done);
    jobs.launch('a', meta('a'), () => Promise.resolve('x'));
    jobs.launch('b', meta('b'), () => Promise.reject(new Error('no')));
    await flush();
    expect(done).toHaveBeenCalledTimes(2);
    expect(done.mock.calls.map(([j]) => [j.key, j.status, j.error])).toEqual([
      ['a', 'done', null],
      ['b', 'failed', 'no'],
    ]);
  });

  it('filters by key prefix', async () => {
    const { jobs, clock } = store();
    await jobs.run('gate:web#1:start', meta('a'), () => Promise.resolve(1));
    await flush();
    clock.t += 10;
    await jobs.run('gate:web#1:answer', meta('b'), () => Promise.resolve(2));
    await flush();
    await jobs.run('deep:web#1:ask', meta('c'), () => Promise.resolve(3));
    await flush();
    jobs.launch('gate:web#2:start', meta('d'), () => new Promise(() => undefined));
    expect(jobs.finished('gate:web#1:').map((j) => j.key)).toEqual(['gate:web#1:start', 'gate:web#1:answer']);
    expect(jobs.running('gate:web#2:').map((j) => j.key)).toEqual(['gate:web#2:start']);
    expect(jobs.running('gate:web#1:')).toEqual([]);
  });

  it('dismisses and clears only finished jobs', async () => {
    const { jobs } = store();
    await jobs.run('a', meta(), () => Promise.resolve(1));
    await jobs.run('b', meta(), () => Promise.reject(new Error('x'))).catch(() => undefined);
    await flush();
    jobs.launch('c', meta(), () => new Promise(() => undefined));
    jobs.dismiss('c');
    expect(jobs.get('c')?.status).toBe('running');
    jobs.dismiss('a');
    expect(jobs.get('a')).toBeUndefined();
    jobs.clearFinished();
    expect(jobs.snapshot().map((j) => j.key)).toEqual(['c']);
  });
});

describe('job helpers', () => {
  it('formats the elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_400)).toBe('0:07');
    expect(formatElapsed(83_000)).toBe('1:23');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('compares screens by name and target, not by the card payload', () => {
    expect(sameScreen({ name: 'gate', ref: 'a#1' }, { name: 'gate', ref: 'a#1' })).toBe(true);
    expect(sameScreen({ name: 'gate', ref: 'a#1' }, { name: 'gate', ref: 'a#2' })).toBe(false);
    expect(sameScreen({ name: 'gate', ref: 'a#1' }, { name: 'qa', ref: 'a#1' })).toBe(false);
    expect(sameScreen({ name: 'retro' }, { name: 'retro' })).toBe(true);
    expect(sameScreen({ name: 'conflict', id: 'x' }, { name: 'conflict', id: 'y' })).toBe(false);
  });

  it('keeps only the serializable part of a screen', () => {
    expect(screenPayload({ name: 'deep', ref: 'a#1', back: 'today', card: { big: true } } as never)).toEqual({ name: 'deep', ref: 'a#1', back: 'today' });
    expect(screenPayload({ name: 'retro' })).toEqual({ name: 'retro' });
  });

  it('words the notification by outcome', () => {
    expect(notificationText({ label: 'Gate 1 da 101', status: 'done', error: null }).title).toBe('Gate 1 da 101 pronto');
    expect(notificationText({ label: 'Gate 1 da 101', status: 'failed', error: 'sem rede' })).toEqual({ title: 'Gate 1 da 101 falhou', body: 'sem rede' });
  });
});
