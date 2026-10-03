import { describe, expect, it } from 'vitest';
import { agendaOrder, bringIntoAgenda } from '../src/shared/sameDay';
import { compareCards, literalLabel, priorityOf, resolvePriority, sortCards, writableLabels } from '../src/shared/priority';
import type { Card, CardsResult } from '../src/shared/types';

describe('priorityOf', () => {
  const levels = ['^P0$', '^P1$', 'priority::low'];

  it('is the first configured level that one of the issue labels matches, with the issue\'s own label', () => {
    expect(priorityOf(['bug', 'p1', 'P0'], levels)).toEqual({ rank: 0, label: 'P0' });
    expect(priorityOf(['bug', 'P1'], levels)).toEqual({ rank: 1, label: 'P1' });
    expect(priorityOf(['Priority::Low'], levels)).toEqual({ rank: 2, label: 'Priority::Low' });
  });

  it('is null with no match, no labels, no levels or labels the tracker did not report', () => {
    expect(priorityOf(['bug', 'P10'], levels)).toBeNull();
    expect(priorityOf([], levels)).toBeNull();
    expect(priorityOf(['P0'], [])).toBeNull();
    expect(priorityOf(undefined, levels)).toBeNull();
  });

  it('matches like a stage pattern: a level without anchors is a substring, and a broken one is skipped', () => {
    expect(priorityOf(['urgent-now'], ['urgent'])).toEqual({ rank: 0, label: 'urgent-now' });
    expect(priorityOf(['P1'], ['[', '^P1$'])).toEqual({ rank: 1, label: 'P1' });
  });
});

const card = (ref: string, over: Partial<Card> = {}): Card => ({
  ref, iid: ref.split('#')[1], title: ref, stage: null, spec: null, mrs: [], mrPaths: [], blockers: [], pending: [], changes: [], note: null, url: '', ...over,
});
const p = (rank: number): Card['priority'] => ({ rank, label: `P${rank}` });

describe('the order of the cards', () => {
  it('puts blocked first, then priority (none last), then the most recently updated (none last)', () => {
    const cards = [
      card('a#1', { updatedAt: '2026-10-01T10:00:00Z' }),
      card('a#2', { priority: p(1), updatedAt: '2026-09-01T10:00:00Z' }),
      card('a#3', { blockers: ['x'], updatedAt: '2026-08-01T10:00:00Z' }),
      card('a#4', { priority: p(0), updatedAt: '2026-09-01T10:00:00Z' }),
      card('a#5', { updatedAt: '2026-10-02T10:00:00Z' }),
      card('a#6', { priority: p(1), updatedAt: '2026-09-15T10:00:00Z' }),
      card('a#7'),
      card('a#8', { blockers: ['y'], priority: p(2) }),
      card('a#9', { blockers: ['z'], priority: p(0) }),
    ];
    expect(sortCards(cards).map((c) => c.ref)).toEqual(['a#9', 'a#8', 'a#3', 'a#4', 'a#6', 'a#2', 'a#5', 'a#1', 'a#7']);
  });

  it('pending items no longer move a card up, and a malformed time counts as none', () => {
    const cards = [card('a#1', { updatedAt: 'not a date' }), card('a#2', { pending: ['review'], updatedAt: '2026-09-01T10:00:00Z' }), card('a#3', { updatedAt: '2026-09-02T10:00:00Z' })];
    expect(sortCards(cards).map((c) => c.ref)).toEqual(['a#3', 'a#2', 'a#1']);
  });

  it('does not break a tie by the ref: equal cards keep the order they came in, in both directions', () => {
    const [x, y] = [card('web#9'), card('web#10')];
    expect(compareCards(x, y)).toBe(0);
    expect(sortCards([x, y]).map((c) => c.ref)).toEqual(['web#9', 'web#10']);
    expect(sortCards([y, x]).map((c) => c.ref)).toEqual(['web#10', 'web#9']);
  });

  it('returns a sorted copy and leaves the input alone', () => {
    const input = [card('a#1'), card('a#2', { blockers: ['x'] })];
    sortCards(input);
    expect(input.map((c) => c.ref)).toEqual(['a#1', 'a#2']);
  });

  it('is the one order of Today and the call: the same cards in the same order whichever way they arrive, with the same-day rule on top', () => {
    const cards = [card('a#1'), card('a#2', { priority: p(0) }), card('a#3', { blockers: ['x'] }), card('a#4', { priority: p(0), updatedAt: '2026-10-01T10:00:00Z' })];
    const marks = { 'a#4': { kind: 'unchanged' as const } };
    const expected = ['a#3', 'a#2', 'a#1', 'a#4'];
    expect(agendaOrder(cards, marks).map((c) => c.ref)).toEqual(expected);
    expect(agendaOrder([...cards].reverse(), marks).map((c) => c.ref)).toEqual(expected);
    // What the loader hands the call is in this order already, so Today (which lists it as it is) shows the same.
    const loaded = agendaOrder(cards, marks);
    expect(agendaOrder(loaded, marks)).toEqual(loaded);
  });
});

describe('bringing a left out card into the agenda', () => {
  const result = (): CardsResult => ({ generatedAt: '', total: 5, cards: [card('a#1'), card('a#2'), card('a#3')], rest: [card('a#4'), card('a#5')] });

  it('puts it right after the card in progress, and takes it out of the rest', () => {
    const r = bringIntoAgenda(result(), 'a#5', 1);
    expect(r.cards.map((c) => c.ref)).toEqual(['a#1', 'a#2', 'a#5', 'a#3']);
    expect(r.rest?.map((c) => c.ref)).toEqual(['a#4']);
    expect(r.total).toBe(5);
  });

  it('puts it at the end before the call has started, and after the last card when that one is in progress', () => {
    expect(bringIntoAgenda(result(), 'a#4', -1).cards.map((c) => c.ref)).toEqual(['a#1', 'a#2', 'a#3', 'a#4']);
    expect(bringIntoAgenda(result(), 'a#4', 2).cards.map((c) => c.ref)).toEqual(['a#1', 'a#2', 'a#3', 'a#4']);
  });

  it('does nothing for a card that is not among the left out ones, and does not mutate the input', () => {
    const input = result();
    expect(bringIntoAgenda(input, 'a#1', 0)).toBe(input);
    bringIntoAgenda(input, 'a#4', 0);
    expect(input.rest).toHaveLength(2);
  });
});

describe('the labels a priority can be written to', () => {
  it('are the levels that are plain names, with or without anchors', () => {
    expect([literalLabel('P0'), literalLabel('^P1$'), literalLabel('priority::high'), literalLabel('^prio-2')]).toEqual(['P0', 'P1', 'priority::high', 'prio-2']);
    expect([literalLabel('^P[01]$'), literalLabel('urgent|asap'), literalLabel('P0.'), literalLabel('^$'), literalLabel('')]).toEqual([null, null, null, null, null]);
    expect(writableLabels(['^P0$', '^P[12]$', 'P3'])).toEqual(['P0', 'P3']);
  });
});

describe('resolvePriority', () => {
  const levels = ['^P0$', '^P1$', '^P2$'];
  const base = (over: Partial<Card> = {}) => card('app#12', { project: 'acme/app', labels: ['bug', 'P1'], priority: { rank: 1, label: 'P1' }, ...over });

  it('"first" is the highest level and the old priority label goes away while the other labels stay', () => {
    expect(resolvePriority(base(), 'first', levels)).toEqual({ to: 'first', from: 'P1', label: 'P0', add: 'P0', remove: ['P1'], noWrite: null, project: 'acme/app', iid: 12, title: 'app#12' });
  });

  it('"later" is the lowest, and a configured label is itself, whatever its case', () => {
    expect(resolvePriority(base(), 'later', levels)).toMatchObject({ add: 'P2', remove: ['P1'], noWrite: null });
    expect(resolvePriority(base(), 'p0', levels)).toMatchObject({ add: 'P0', remove: ['P1'] });
  });

  it('takes off every priority label the issue has, not only the one that ranked it', () => {
    expect(resolvePriority(base({ labels: ['P2', 'bug', 'P1'] }), 'first', levels)).toMatchObject({ add: 'P0', remove: ['P2', 'P1'] });
  });

  it('puts a label on a card that had none, and does not add what the issue already has', () => {
    expect(resolvePriority(base({ labels: ['bug'], priority: null }), 'first', levels)).toMatchObject({ from: null, label: 'P0', add: 'P0', remove: [] });
    expect(resolvePriority(base({ labels: ['P0', 'P1'] }), 'first', levels)).toMatchObject({ label: 'P0', add: null, remove: ['P1'], noWrite: null });
  });

  it('writes nothing when the card already has that priority, with the reason', () => {
    expect(resolvePriority(base({ labels: ['bug', 'P1'] }), 'p1', levels)).toMatchObject({ label: 'P1', add: null, remove: [], noWrite: 'same' });
  });

  it('writes nothing, with the reason, with no levels, a level that is a pattern, a label that is not a level or an issue that is not known', () => {
    expect(resolvePriority(base(), 'first', []).noWrite).toBe('unconfigured');
    expect(resolvePriority(base(), 'first', ['^P[01]$', '^P2$']).noWrite).toBe('unmapped');
    expect(resolvePriority(base(), 'urgent', levels).noWrite).toBe('unmapped');
    expect(resolvePriority(base({ project: undefined }), 'first', levels)).toMatchObject({ noWrite: 'unidentified', label: 'P0' });
    expect(resolvePriority(base({ iid: 'x' }), 'first', levels).noWrite).toBe('unidentified');
  });
});
