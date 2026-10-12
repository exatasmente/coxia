// The store of the questions an agent leaves at a turn limit: no timer of its own, one entry per question, one door for the answer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TURN_ASKS_EVENT, type PendingTurnAsk, type TurnAnswerer, type TurnAskInput, type TurnDecision } from '../src/shared/turnLimit';
import { type TurnOutcome, TurnAskGone, createTurnAsks } from '../src/main/turnAsks-core';

const input = (over: Partial<TurnAskInput> = {}): TurnAskInput => ({ of: 'sub', run: 'r1', thread: 'run-r1', ref: 'app#123', stage: 'review', agent: 'reviewer', name: 'Reviewer', kind: 'explore', task: 'map the tests', used: 12, round: 12, granted: 0, canContinue: true, ...over });

function setup(deps: Partial<Parameters<typeof createTurnAsks>[0]> = {}) {
  const lists: PendingTurnAsk[][] = [];
  const asked: PendingTurnAsk[] = [];
  const audits: { id: string; decision: TurnDecision; through: TurnAnswerer }[] = [];
  let n = 0;
  const store = createTurnAsks({
    changed: (l) => void lists.push(l),
    asked: (a) => void asked.push(a),
    audit: (a, decision, through) => void audits.push({ id: a.id, decision, through }),
    newId: () => `q${++n}`,
    now: () => new Date('2026-01-02T03:04:05Z'),
    ...deps,
  });
  return { store, lists, asked, audits };
}

afterEach(() => vi.useRealTimers());

describe('the store of questions at a turn limit', () => {
  it('lists a question, publishes the whole list on every change and tells the person once', async () => {
    const { store, lists, asked } = setup();
    const waiting = store.ask(input());
    expect(store.list()).toEqual([{ ...input(), id: 'q1', since: '2026-01-02T03:04:05.000Z' }]);
    expect(lists.at(-1)?.map((a) => a.id)).toEqual(['q1']);
    expect(asked.map((a) => a.id)).toEqual(['q1']);
    expect(store.answer('q1', 'continue', 'window')).toEqual({ ok: true });
    await expect(waiting).resolves.toEqual({ decision: 'continue', by: 'person' });
    expect(store.list()).toEqual([]);
    expect(lists.at(-1)).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('has no timer: a week later it still waits, and nothing declined or answered it', async () => {
    vi.useFakeTimers();
    const { store } = setup();
    let outcome: TurnOutcome | undefined;
    void store.ask(input()).then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(7 * 24 * 3600_000);
    expect(outcome).toBeUndefined();
    expect(store.list()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    store.answer('q1', 'finish', 'window');
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ decision: 'finish', by: 'person' });
  });

  it('applies an answer once: a second one and one after the work ended are gone, and change nothing', async () => {
    const { store, audits } = setup();
    const waiting = store.ask(input());
    store.answer('q1', 'finish', 'window');
    await waiting;
    expect(() => store.answer('q1', 'continue', 'paired')).toThrow(TurnAskGone);
    expect(() => store.answer('nope', 'finish', 'window')).toThrow(TurnAskGone);
    expect(audits).toEqual([{ id: 'q1', decision: 'finish', through: 'window' }]);
    // the work ended on its own (an abort), and an answer that arrives after is gone too
    const ac = new AbortController();
    void store.ask(input(), ac.signal);
    ac.abort();
    expect(() => store.answer('q2', 'continue', 'window')).toThrow(TurnAskGone);
  });

  it('ends a wait that is aborted as finish by abort, removes the question, and writes no audit line', async () => {
    const { store, lists, audits } = setup();
    const ac = new AbortController();
    const waiting = store.ask(input(), ac.signal);
    expect(store.list()).toHaveLength(1);
    ac.abort();
    await expect(waiting).resolves.toEqual({ decision: 'finish', by: 'abort' });
    expect(store.list()).toEqual([]);
    expect(lists.at(-1)).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('files nothing for a signal that is already aborted', async () => {
    const { store, lists, asked } = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(store.ask(input(), ac.signal)).resolves.toEqual({ decision: 'finish', by: 'abort' });
    expect(store.list()).toEqual([]);
    expect(lists).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('keeps every question apart: answering one leaves the others, and an abort takes only its own', async () => {
    const { store } = setup();
    const ac = new AbortController();
    const outcomes: Record<string, TurnOutcome> = {};
    for (const [key, signal] of [['a', undefined], ['b', ac.signal], ['c', undefined]] as const) void store.ask(input({ task: key }), signal).then((o) => (outcomes[key] = o));
    expect(store.list().map((a) => a.task)).toEqual(['a', 'b', 'c']);
    store.answer('q3', 'continue', 'paired');
    await Promise.resolve();
    expect(outcomes).toEqual({ c: { decision: 'continue', by: 'person' } });
    expect(store.list().map((a) => a.task)).toEqual(['a', 'b']);
    ac.abort();
    await Promise.resolve();
    expect(outcomes.b).toEqual({ decision: 'finish', by: 'abort' });
    expect(store.list().map((a) => a.task)).toEqual(['a']);
    store.answer('q1', 'finish', 'window');
    await Promise.resolve();
    expect(outcomes.a).toEqual({ decision: 'finish', by: 'person' });
  });

  it('refuses a decision that is not one, and continue where the engine cannot; the question stays', async () => {
    const { store, audits } = setup();
    const waiting = store.ask(input({ canContinue: false }));
    expect(store.answer('q1', 'continue', 'window')).toEqual({ ok: false, reason: 'decision' });
    expect(store.answer('q1', 'maybe' as TurnDecision, 'window')).toEqual({ ok: false, reason: 'decision' });
    expect(store.list()).toHaveLength(1);
    expect(audits).toEqual([]);
    expect(store.answer('q1', 'finish', 'window')).toEqual({ ok: true });
    await expect(waiting).resolves.toEqual({ decision: 'finish', by: 'person' });
  });

  it('says through which door each answer came, in the audit', async () => {
    const { store, audits } = setup();
    const a = store.ask(input());
    const b = store.ask(input());
    store.answer('q1', 'continue', 'window');
    store.answer('q2', 'finish', 'paired');
    await Promise.all([a, b]);
    expect(audits).toEqual([
      { id: 'q1', decision: 'continue', through: 'window' },
      { id: 'q2', decision: 'finish', through: 'paired' },
    ]);
  });

  it('is not decided by a listener that throws: the question is filed, answered and ended all the same', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const boom = (): never => {
        throw new Error('listener broke');
      };
      const { store } = setup({ changed: boom, asked: boom, audit: boom });
      const waiting = store.ask(input());
      expect(store.list()).toHaveLength(1);
      expect(store.answer('q1', 'continue', 'window')).toEqual({ ok: true });
      await expect(waiting).resolves.toEqual({ decision: 'continue', by: 'person' });
      expect(store.list()).toEqual([]);
    } finally {
      quiet.mockRestore();
    }
  });

  it('names its event, and its record has no field for tool output, file content or environment', () => {
    expect(TURN_ASKS_EVENT).toBe('turn-asks');
    const keys = Object.keys({ ...input(), id: 'x', since: 'y' } satisfies PendingTurnAsk).sort();
    expect(keys).toEqual(['agent', 'canContinue', 'granted', 'id', 'kind', 'name', 'of', 'ref', 'round', 'run', 'since', 'stage', 'task', 'thread', 'used']);
  });
});
