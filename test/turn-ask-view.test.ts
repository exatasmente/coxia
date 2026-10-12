// What the card of a question at a turn limit says (#246), without a DOM: the lines are pure, the card is only their markup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../src/shared/i18n';
import type { PendingTurnAsk } from '../src/shared/turnLimit';
import { sameTurnAsks, turnAskLines } from '../src/renderer/src/turnAskView';

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const ask = (over: Partial<PendingTurnAsk> = {}): PendingTurnAsk => ({
  id: 'a1', of: 'sub', run: 'r-1', thread: 'run-r-1', ref: 'app#101', stage: 'refine', agent: 'refiner', name: 'Refiner', kind: 'explore', task: 'map the tests of X',
  used: 12, round: 12, granted: 0, canContinue: true, since: '2026-10-10T10:00:00.000Z', ...over,
});
const lines = (a: PendingTurnAsk) => turnAskLines(a, t, () => '10:00');

describe('the lines of a question at a turn limit', () => {
  it('names a sub-agent of a kind with its task, the turns used and the size of the next round', () => {
    const l = lines(ask());
    expect(l.title).toBe('Sub-agent of kind explore: map the tests of X, used 12 of 12 turns');
    expect(l.details).toEqual(['Agent Refiner, in app#101, stage refine', 'Waiting since 10:00']);
    expect(l.continueLabel).toBe('Continue (12 more turns)');
    expect(l.finishLabel).toBe('Finish now');
  });

  it('names a stage by its agent, with no task', () => {
    const l = lines(ask({ of: 'stage', kind: null, task: '', used: 30, round: 30 }));
    expect(l.title).toBe('Refiner used 30 of 30 turns');
    expect(l.continueLabel).toBe('Continue (30 more turns)');
  });

  it('names a plain sub-agent without a kind, and says when it was given no task', () => {
    expect(lines(ask({ kind: null })).title).toBe('Sub-agent: map the tests of X, used 12 of 12 turns');
    expect(lines(ask({ kind: null, task: '  ' })).title).toBe('Sub-agent: no task given, used 12 of 12 turns');
  });

  it('clips a long task', () => {
    const title = lines(ask({ task: 'x'.repeat(500) })).title;
    expect(title.length).toBeLessThan(260);
    expect(title).toContain('…');
  });

  it('says the rounds already granted only when there were some', () => {
    expect(lines(ask({ granted: 0 })).details.some((d) => d.includes('Rounds'))).toBe(false);
    expect(lines(ask({ granted: 3 })).details).toContain('Rounds already granted: 3');
  });

  it('says where outside a run, and where without a stage', () => {
    expect(lines(ask({ ref: null, run: null, stage: null, thread: 'squads' })).details[0]).toBe('Agent Refiner, in a conversation');
    expect(lines(ask({ stage: null })).details[0]).toBe('Agent Refiner, in app#101');
  });

  it('leaves out the line of the time when it cannot be read, instead of drawing a placeholder', () => {
    const l = turnAskLines(ask(), t, () => null);
    expect(l.details.some((d) => d.includes('Waiting since'))).toBe(false);
    expect(l.details).toHaveLength(1);
  });

  it('offers no continue where the engine cannot go on', () => {
    const l = lines(ask({ canContinue: false }));
    expect(l.continueLabel).toBeNull();
    expect(l.finishLabel).toBe('Finish now');
  });

  it('speaks pt-BR from the same keys', () => {
    setLanguage('pt-BR');
    try {
      const l = lines(ask());
      expect(l.continueLabel).toBe('Continuar (mais 12 passos)');
      expect(l.finishLabel).toBe('Encerrar agora');
    } finally {
      setLanguage('en');
    }
  });
});

describe('a list that only came again', () => {
  it('is the same when the ids, the turns, the rounds and the engine are', () => {
    expect(sameTurnAsks([ask(), ask({ id: 'a2' })], [ask(), ask({ id: 'a2' })])).toBe(true);
    expect(sameTurnAsks([], [])).toBe(true);
  });

  it('differs by length, by id, by the turns used, by the rounds and by whether it can continue', () => {
    expect(sameTurnAsks([ask()], [])).toBe(false);
    expect(sameTurnAsks([ask()], [ask({ id: 'b' })])).toBe(false);
    expect(sameTurnAsks([ask()], [ask({ used: 24 })])).toBe(false);
    expect(sameTurnAsks([ask()], [ask({ granted: 1 })])).toBe(false);
    expect(sameTurnAsks([ask()], [ask({ canContinue: false })])).toBe(false);
  });
});
