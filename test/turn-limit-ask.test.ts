// The asker that a caller of the engine builds for the question at a turn limit (#246): the record, the conversation lines, the masking of the task, and the clocks of the
// caller standing still for as long as the question waits (acceptance 6 and 7), through the stage's real watchdog.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TurnStop } from '../src/main/engine/contract';
import { StageError, watchdog } from '../src/main/runner/executor';
import { createTurnAsks } from '../src/main/turnAsks-core';
import { turnAsker } from '../src/main/turnLimit';

afterEach(() => vi.useRealTimers());

const stop = (over: Partial<TurnStop> = {}): TurnStop => ({ of: 'sub', role: 'deep:explore', kind: 'explore', name: null, task: 'map the tests of the parser', used: 12, round: 12, granted: 0, canContinue: true, ...over });

function setup(over: Partial<Parameters<typeof turnAsker>[0]> = {}) {
  const store = createTurnAsks({ changed: () => undefined, newId: (() => { let n = 0; return () => `q${++n}`; })() });
  const lines: { code: string; params: Record<string, string | number> }[] = [];
  const clocks: string[] = [];
  const ac = new AbortController();
  const ask = turnAsker({
    store,
    place: { run: 'r1', thread: 'run-r1', stage: 'review', ref: 'app#123', issue: 123 },
    agent: { id: 'reviewer', name: 'Reviewer' },
    say: (code, params) => void lines.push({ code, params }),
    pause: () => {
      clocks.push('paused');
      return () => void clocks.push('resumed');
    },
    signal: ac.signal,
    ...over,
  });
  return { store, lines, clocks, ac, ask };
}

describe('the asker', () => {
  it('files the record, says the question, waits, and says the answer', async () => {
    const { store, lines, ask } = setup();
    const waiting = ask(stop());
    expect(store.list()).toMatchObject([{ of: 'sub', run: 'r1', thread: 'run-r1', ref: 'app#123', issue: 123, stage: 'review', agent: 'reviewer', name: 'Reviewer', kind: 'explore', task: 'map the tests of the parser', used: 12, round: 12, granted: 0, canContinue: true }]);
    expect(lines).toEqual([{ code: 'runner.turns.ask.sub', params: { agent: 'Reviewer', what: 'explore: map the tests of the parser', used: 12, round: 12 } }]);
    store.answer('q1', 'continue', 'window');
    await expect(waiting).resolves.toBe('continue');
    expect(lines.map((l) => l.code)).toEqual(['runner.turns.ask.sub', 'runner.turns.continue.sub']);
  });

  it('uses the code of what asked and of what was decided', async () => {
    for (const [of, decision] of [['stage', 'continue'], ['stage', 'finish'], ['sub', 'finish']] as const) {
      const { store, lines, ask } = setup();
      const waiting = ask(stop({ of, kind: of === 'stage' ? null : 'edit', task: of === 'stage' ? '' : 'edit the loader' }));
      store.answer(store.list()[0].id, decision, 'paired');
      await waiting;
      expect(lines.map((l) => l.code)).toEqual([`runner.turns.ask.${of}`, `runner.turns.${decision}.${of}`]);
    }
  });

  it('says no answer line when the wait ended by an abort, and reports finish: a cancel is not the person\'s choice', async () => {
    const { store, lines, ac, ask } = setup();
    const waiting = ask(stop());
    ac.abort();
    await expect(waiting).resolves.toBe('finish');
    expect(lines.map((l) => l.code)).toEqual(['runner.turns.ask.sub']);
    expect(store.list()).toEqual([]);
  });

  it('ends the wait with the engine\'s own signal too', async () => {
    const { store, lines, ask } = setup();
    const own = new AbortController();
    const waiting = ask(stop(), own.signal);
    own.abort();
    await expect(waiting).resolves.toBe('finish');
    expect(lines.map((l) => l.code)).toEqual(['runner.turns.ask.sub']);
    expect(store.list()).toEqual([]);
  });

  it('masks and clips the task like an activity line: a secret, a secret file and a very long task', async () => {
    const { store, ask } = setup({ isSecretPath: (token) => token.endsWith('.env') });
    void ask(stop({ task: `read ./config/.env with sk-or-v1-abcdefghijklmnop then ${'word '.repeat(80)}` }));
    const [record] = store.list();
    expect(record.task).not.toContain('.env');
    expect(record.task).not.toContain('abcdefghijklmnop');
    expect(record.task.length).toBeLessThanOrEqual(120);
    expect(record.task.startsWith('read ')).toBe(true);
  });

  it('names a sub-agent that has no kind by its task alone, and a stage by nothing but the agent', async () => {
    const { lines, ask } = setup();
    void ask(stop({ kind: null, task: 'find the callers' }));
    void ask(stop({ of: 'stage', kind: null, task: '' }));
    expect(lines.map((l) => l.params.what)).toEqual(['find the callers', '-']);
  });

  it('stands the clocks still before the wait and starts them after it, on every outcome', async () => {
    const outcomes: [string, (s: ReturnType<typeof setup>) => void][] = [
      ['continue', (s) => void s.store.answer(s.store.list()[0].id, 'continue', 'window')],
      ['finish', (s) => void s.store.answer(s.store.list()[0].id, 'finish', 'paired')],
      ['abort', (s) => s.ac.abort()],
    ];
    for (const [name, end] of outcomes) {
      const s = setup();
      const waiting = s.ask(stop());
      expect(s.clocks, name).toEqual(['paused']);
      end(s);
      await waiting;
      expect(s.clocks, name).toEqual(['paused', 'resumed']);
    }
  });

  it('starts the clocks again when the line cannot be written', async () => {
    const s = setup({
      say: () => {
        throw new Error('thread gone');
      },
    });
    await expect(s.ask(stop())).rejects.toThrow('thread gone');
    expect(s.clocks).toEqual(['paused', 'resumed']);
    expect(s.store.list()).toEqual([]);
  });
});

describe('the stage\'s clocks while a question waits (a minute for each limit)', () => {
  const MINUTE = 60_000;
  function stage(limits = { idleMs: MINUTE, maxMs: MINUTE }) {
    const abort = new AbortController();
    const watch = watchdog(abort, limits);
    const s = setup({ pause: watch.pause, signal: abort.signal });
    return { ...s, abort, watch };
  }

  it('never trips the idle limit or the wall cap during a wait much longer than both, and the stage finishes after the answer', async () => {
    vi.useFakeTimers();
    const s = stage();
    const guarded = s.watch.guard(
      (async () => {
        await new Promise((r) => setTimeout(r, 1000));
        const decision = await s.ask(stop({ of: 'stage', kind: null, task: '' }));
        return decision;
      })(),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.store.list()).toHaveLength(1);
    // an hour and then a week: past the idle limit and past the cap
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * MINUTE);
    expect(s.abort.signal.aborted).toBe(false);
    expect(s.store.list()).toHaveLength(1);
    s.store.answer(s.store.list()[0].id, 'continue', 'window');
    await expect(guarded).resolves.toBe('continue');
    expect(s.abort.signal.aborted).toBe(false);
  });

  it('gives the wall cap back with what was left of it, and the idle limit from the moment the wait ends', async () => {
    vi.useFakeTimers();
    const s = stage({ idleMs: 10 * MINUTE, maxMs: 5 * MINUTE });
    let tripped: unknown = null;
    const guarded = s.watch.guard(
      (async () => {
        await new Promise((r) => setTimeout(r, 2 * MINUTE));
        await s.ask(stop());
        await new Promise(() => undefined);
      })(),
    );
    guarded.catch((e: unknown) => (tripped = e));
    await vi.advanceTimersByTimeAsync(2 * MINUTE + 1000);
    expect(s.store.list()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    s.store.answer(s.store.list()[0].id, 'continue', 'window');
    // 3 minutes of the cap were left: 2 minutes later it has not tripped, a little over 3 it has
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(tripped).toBeNull();
    await vi.advanceTimersByTimeAsync(MINUTE + 5000);
    expect(tripped).toBeInstanceOf(StageError);
    expect((tripped as StageError).code).toBe('too-long');
  });

  it('ignores a sign of life that arrives while paused, and starts the idle clock when the wait ends', async () => {
    vi.useFakeTimers();
    const s = stage({ idleMs: MINUTE, maxMs: 60 * MINUTE });
    let tripped: unknown = null;
    const guarded = s.watch.guard(
      (async () => {
        await new Promise((r) => setTimeout(r, 1000));
        await s.ask(stop());
        await new Promise(() => undefined);
      })(),
    );
    guarded.catch((e: unknown) => (tripped = e));
    await vi.advanceTimersByTimeAsync(2000);
    s.watch.beat();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(tripped).toBeNull();
    s.store.answer(s.store.list()[0].id, 'finish', 'window');
    await vi.advanceTimersByTimeAsync(MINUTE - 1000);
    expect(tripped).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect((tripped as StageError).code).toBe('timeout');
  });

  it('restarts the clocks only after both of two overlapping waits are answered', async () => {
    vi.useFakeTimers();
    const s = stage({ idleMs: MINUTE, maxMs: 60 * MINUTE });
    let tripped: unknown = null;
    const guarded = s.watch.guard(
      (async () => {
        await new Promise((r) => setTimeout(r, 1000));
        await Promise.all([s.ask(stop({ task: 'first' })), s.ask(stop({ task: 'second' }))]);
        await new Promise(() => undefined);
      })(),
    );
    guarded.catch((e: unknown) => (tripped = e));
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.store.list()).toHaveLength(2);
    const [one, two] = s.store.list();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    s.store.answer(one.id, 'continue', 'window');
    // one still waits: the clocks are still stopped
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(tripped).toBeNull();
    s.store.answer(two.id, 'continue', 'window');
    await vi.advanceTimersByTimeAsync(MINUTE - 1000);
    expect(tripped).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect((tripped as StageError).code).toBe('timeout');
  });
});
