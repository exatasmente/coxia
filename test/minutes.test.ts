import { describe, expect, it } from 'vitest';
import { buildMinutes, teamsKey } from '../src/shared/minutes';
import { destination } from '../src/shared/destination';
import type { AgentTurn, Card, SavedCeremony } from '../src/shared/types';

type Source = Pick<SavedCeremony, 'cards' | 'turns' | 'answered' | 'decisions' | 'effects' | 'log' | 'startedAt' | 'endedAt'>;

const card = (ref: string, over: Partial<Card> = {}): Card => ({
  ref,
  iid: ref.split('#')[1],
  title: `Atividade ${ref}`,
  stage: 'In progress',
  spec: null,
  mrs: [],
  mrPaths: [],
  blockers: [],
  pending: [],
  changes: [],
  note: null,
  url: `https://x/${ref}`,
  ...over,
});

const turn = (ref: string, question: string | null): AgentTurn => ({
  ref,
  sessionId: null,
  speech: 'fala',
  did: 'andou',
  next: 'proximo',
  blocker: null,
  question,
});

function base(): Source {
  return {
    cards: { generatedAt: '2026-10-02T10:00:00Z', total: 2, cards: [card('sz4#1'), card('sz4#2', { blockers: ['MR parado'] })] },
    turns: { 'sz4#1': turn('sz4#1', 'Posso subir?'), 'sz4#2': turn('sz4#2', null) },
    answered: {},
    decisions: [{ ref: 'sz4#1', text: 'subir hoje', target: 'ata', dest: 'ata da cerimônia' }],
    effects: [{ ref: 'sz4#1', text: 'abrir MR', repo: 'sz4' }],
    log: [{ who: 'luiz', text: 'bom dia', at: '09:00', color: '#fff' }],
    startedAt: 1_000,
    endedAt: 2_000,
  };
}

describe('buildMinutes', () => {
  it('lists the questions the user did not answer', () => {
    const m = buildMinutes(base());
    expect(m.unanswered).toEqual([{ ref: 'sz4#1', question: 'Posso subir?' }]);
  });

  it('drops the questions that were answered, and cards without a question', () => {
    const s = base();
    s.answered = { 'sz4#1': true };
    expect(buildMinutes(s).unanswered).toEqual([]);
  });

  it('copies decisions, effects and the transcript, and formats the dates', () => {
    const m = buildMinutes(base());
    expect(m.decisions).toHaveLength(1);
    expect(m.effects).toHaveLength(1);
    expect(m.transcript).toEqual([{ who: 'luiz', text: 'bom dia', at: '09:00' }]);
    expect(m.startedAt).toBe(new Date(1_000).toISOString());
    expect(m.endedAt).toBe(new Date(2_000).toISOString());
  });

  it('copes with a ceremony that has no cards yet', () => {
    const s = base();
    s.cards = null;
    expect(buildMinutes(s).unanswered).toEqual([]);
  });
});

describe('teamsKey: the Teams text is regenerated only when what it is written from changes', () => {
  const key = (s: Source) => teamsKey(s);

  it('is stable for the same ceremony', () => {
    expect(key(base())).toBe(key(base()));
  });

  it('does not change with the conversation log, answers, turns or timestamps', () => {
    const k = key(base());
    const s = base();
    s.log = [...s.log, { who: 'agente', text: 'mais uma fala', at: '09:05', color: '#000' }];
    s.answered = { 'sz4#1': true };
    s.turns['sz4#1'] = turn('sz4#1', 'Outra pergunta?');
    s.startedAt = 5;
    s.endedAt = 6;
    expect(key(s)).toBe(k);
  });

  it('does not change when only the decision destination changes', () => {
    const s = base();
    s.decisions = [{ ...s.decisions[0], dest: 'outro lugar' }];
    expect(key(s)).toBe(key(base()));
  });

  it('changes when a decision is added, edited or removed', () => {
    const k = key(base());
    const added = base();
    added.decisions = [...added.decisions, { ref: 'sz4#2', text: 'esperar', target: 'ata', dest: 'ata' }];
    const edited = base();
    edited.decisions = [{ ...edited.decisions[0], text: 'subir amanhã' }];
    const removed = base();
    removed.decisions = [];
    expect(key(added)).not.toBe(k);
    expect(key(edited)).not.toBe(k);
    expect(key(removed)).not.toBe(k);
  });

  it('changes when an effect is added, edited or removed', () => {
    const k = key(base());
    const added = base();
    added.effects = [...added.effects, { ref: 'sz4#2', text: 'mover status', repo: 'sz4' }];
    const edited = base();
    edited.effects = [{ ...edited.effects[0], text: 'abrir MR de novo' }];
    const removed = base();
    removed.effects = [];
    expect(key(added)).not.toBe(k);
    expect(key(edited)).not.toBe(k);
    expect(key(removed)).not.toBe(k);
  });

  it('changes when a card changes stage, blockers or changes, or when a card appears', () => {
    const k = key(base());
    const stage = base();
    stage.cards!.cards[0] = card('sz4#1', { stage: 'Test OK' });
    const blockers = base();
    blockers.cards!.cards[0] = card('sz4#1', { blockers: ['novo bloqueio'] });
    const changes = base();
    changes.cards!.cards[0] = card('sz4#1', { changes: ['stage: A → B'] });
    const appears = base();
    appears.cards!.cards.push(card('sz4#3'));
    for (const s of [stage, blockers, changes, appears]) expect(key(s)).not.toBe(k);
  });

  it('is the same with no cards and with an empty list', () => {
    const none = base();
    none.cards = null;
    const empty = base();
    empty.cards = { generatedAt: 'x', total: 0, cards: [] };
    expect(key(none)).toBe(key(empty));
  });
});

const labels = { heading: 'Registro', noteTool: 'daily-report', noteFallback: 'nota do cartão', minutes: 'ata da cerimônia' };

describe('destination of a decision', () => {
  it('goes to the plan registry when the card has a spec', () => {
    const c = card('sz4#1', { spec: { folder: '/s/#1-x', phase: 'Plan escrito', planFile: '/s/#1-x/bug/2_PLAN.md' } });
    expect(destination(c, 'spec', labels)).toBe('/s/#1-x/bug/2_PLAN.md › Registro');
  });

  it('falls back to the spec folder without a plan file', () => {
    const c = card('sz4#1', { spec: { folder: '/s/#1-x', phase: 'x', planFile: null } });
    expect(destination(c, 'spec', labels)).toBe('/s/#1-x › Registro');
  });

  it('goes to the ata when a spec decision has no spec', () => {
    expect(destination(card('sz4#1'), 'spec', labels)).toBe('ata da cerimônia');
  });

  it('goes to the daily-report note or the ata', () => {
    expect(destination(card('sz4#1'), 'daily-report', labels)).toBe('daily-report note sz4#1');
    expect(destination(card('sz4#1'), 'ata', labels)).toBe('ata da cerimônia');
  });

  it('follows the cycle: no decision log means the minutes, no card tool means a plain card note', () => {
    const c = card('sz4#1', { spec: { folder: '/s/#1-x', phase: 'x', planFile: null } });
    expect(destination(c, 'spec', { ...labels, heading: '' })).toBe('ata da cerimônia');
    expect(destination(c, 'spec', { ...labels, heading: 'Decision log' })).toBe('/s/#1-x › Decision log');
    expect(destination(c, 'daily-report', { ...labels, noteTool: null })).toBe('nota do cartão sz4#1');
  });
});

import { nullish } from '../src/main/agents';

describe('nullish', () => {
  it('turns textual nulls into null and keeps real text', () => {
    for (const v of ['null', 'NULL', ' none ', 'nenhum', 'Nenhuma.', 'n/a', '-', '', null]) expect(nullish(v as string | null)).toBeNull();
    expect(nullish('O 797 está com conflito.')).toBe('O 797 está com conflito.');
  });
});
