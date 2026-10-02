import { describe, expect, it } from 'vitest';
import type { AgentTurn, Card, ReleaseAction } from '../src/shared/types';
import { LEGACY_STAGES } from '../src/shared/config/legacy';
import { builtInTemplate, cycleOf, type CycleTemplate } from '../src/shared/cycles';
import { setLanguage } from '../src/shared/i18n';
import type { WatcherAlert } from '../src/shared/watchers';
import {
  agoraPlan,
  conflictMrs,
  bottomNavActive,
  greeting,
  mrLabel,
  needsYou,
  pendingQuestions,
  retroDue,
  sortByUrgency,
  stageLabel,
  urgencyRank,
  tempoSegments,
  type AgoraInput,
} from '../src/renderer/src/dashboard';

function card(iid: string, over: Partial<Card> = {}): Card {
  return { ref: `g/p#${iid}`, iid, title: `Atividade ${iid}`, stage: 'Doing', spec: null, mrs: [], mrPaths: [], blockers: [], pending: [], changes: [], note: null, url: '', ...over };
}

function turn(ref: string, over: Partial<AgentTurn> = {}): AgentTurn {
  return { ref, sessionId: null, speech: '', did: '', next: '', blocker: null, question: null, ...over };
}

function action(id: string, over: Partial<ReleaseAction> = {}): ReleaseAction {
  return { id, key: id, kind: 'sync', issue: 1, issueTitle: 'T', state: 'pending', ...over } as ReleaseAction;
}

const base: AgoraInput = { hasCards: true, loadingCards: false, startedAt: null, callEnded: false, saved: false, resumed: false, ready: 2, total: 5, decisions: 0, effects: 0, retroDue: false };

describe('agoraPlan', () => {
  it('offers to start the pre-daily with the agents progress', () => {
    const p = agoraPlan(base);
    expect(p.phase).toBe('ready');
    expect(p.primary).toEqual({ action: 'call', label: 'Começar a pré-daily' });
    expect(p.progress).toBe('Agentes prontos 2 de 5');
    expect(p.secondary).toEqual([]);
  });

  it('shows the loading state while the cards are being built', () => {
    const p = agoraPlan({ ...base, hasCards: false });
    expect(p.phase).toBe('loading');
    expect(p.primary.disabled).toBe(true);
    expect(p.progress).toBe('Montando cartões…');
  });

  it('returns to the call that is in progress and offers the minutes', () => {
    const p = agoraPlan({ ...base, startedAt: 1, decisions: 2, effects: 1 });
    expect(p.phase).toBe('live');
    expect(p.primary.label).toBe('Voltar à call');
    expect(p.secondary.map((b) => b.action)).toEqual(['ata']);
    expect(p.hint).toBe('2 decisões · 1 efeito aguardando “sim”');
  });

  it('never offers a new pre-daily in the middle of the call', () => {
    expect(agoraPlan({ ...base, startedAt: 1, resumed: true }).secondary.map((b) => b.action)).not.toContain('reset');
  });

  it('after the call the minutes come first and a new pre-daily is a secondary action', () => {
    for (const over of [{ callEnded: true }, { saved: true }]) {
      const p = agoraPlan({ ...base, startedAt: 1, ...over });
      expect(p.phase).toBe('ended');
      expect(p.primary.action).toBe('ata');
      expect(p.secondary.map((b) => b.action)).toEqual(['reset']);
    }
  });

  it('puts the retro as a secondary action only when it is due', () => {
    expect(agoraPlan({ ...base, retroDue: true }).secondary.map((b) => b.action)).toEqual(['retro']);
    expect(agoraPlan({ ...base, startedAt: 1, retroDue: true }).secondary.map((b) => b.action)).toEqual(['ata']);
    expect(agoraPlan({ ...base, callEnded: true, retroDue: true }).secondary.map((b) => b.action)).toEqual(['reset', 'retro']);
  });

  it('keeps the restore notice and the new pre-daily action when the day was recovered from disk', () => {
    const p = agoraPlan({ ...base, resumed: true, loadingCards: true });
    expect(p.hint).toContain('recuperados do disco');
    expect(p.secondary).toEqual([{ action: 'reset', label: 'Nova pré-daily', disabled: true }]);
  });
});

describe('retroDue', () => {
  it('is true only on the retro day from its time on', () => {
    // 2026-10-02 is a Friday
    expect(retroDue(new Date('2026-10-02T15:59:00'), 5, '16:00')).toBe(false);
    expect(retroDue(new Date('2026-10-02T16:00:00'), 5, '16:00')).toBe(true);
    expect(retroDue(new Date('2026-10-01T17:00:00'), 5, '16:00')).toBe(false);
  });
});

describe('needsYou', () => {
  const blocked = card('10', { blockers: ['Depende do MR !42', 'outro'] });
  const asking = card('11');
  const quiet = card('12');
  const cards = [quiet, asking, blocked];
  const turns = { [asking.ref]: turn(asking.ref, { question: 'Posso mergear?' }) };

  it('is empty when nothing needs the person', () => {
    expect(needsYou({ cards: [quiet], turns: {}, answered: {}, actions: [], alerts: [] })).toEqual([]);
  });

  it('lists blocked activities with the first reason and a way into the deep dive', () => {
    const [b] = needsYou({ cards, turns: {}, answered: {}, actions: [], alerts: [] });
    expect(b).toMatchObject({ kind: 'blocked', title: 'Depende do MR !42', detail: '#10 · Atividade 10', to: { to: 'deep', ref: blocked.ref } });
  });

  it('groups release actions in one row and lists each conflict on its own', () => {
    const items = needsYou({
      cards: [],
      turns: {},
      answered: {},
      actions: [action('a'), action('b', { state: 'failed' }), action('c', { state: 'done' }), action('d', { kind: 'conflict', issue: 7 })],
      alerts: [],
    });
    expect(items.map((i) => i.kind)).toEqual(['conflict', 'actions']);
    expect(items[0].to).toEqual({ to: 'conflict', id: 'd' });
    expect(items[1].title).toBe('2 ações de release aguardando o seu “seguir”');
  });

  it('uses the singular for one release action', () => {
    const [a] = needsYou({ cards: [], turns: {}, answered: {}, actions: [action('a')], alerts: [] });
    expect(a.title).toBe('1 ação de release aguardando o seu “seguir”');
  });

  it('skips questions that were already answered', () => {
    expect(needsYou({ cards: [asking], turns, answered: { [asking.ref]: true }, actions: [], alerts: [] })).toEqual([]);
    expect(pendingQuestions(cards, turns, {})).toEqual([asking]);
  });

  it('orders rejections first and keeps watcher rows dismissible', () => {
    const rej: WatcherAlert = { id: 'r1', kind: 'rejections', ref: 'x', iid: '1', title: 't', message: 'Três reprovações', detail: null, card: null, since: '' };
    const gate: WatcherAlert = { id: 'g1', kind: 'gate', ref: asking.ref, iid: '11', title: 't', message: 'Gate parado', detail: 'd', card: asking, since: '' };
    const items = needsYou({ cards, turns, answered: {}, actions: [], alerts: [gate, rej] });
    expect(items.map((i) => i.id)).toEqual(['watcher:r1', `blocked:${blocked.ref}`, `question:${asking.ref}`, 'watcher:g1']);
    expect(items[0]).toMatchObject({ tone: 'stop', to: null, alertId: 'r1' });
    expect(items[3]).toMatchObject({ cta: 'Abrir o gate', to: { to: 'gate', ref: asking.ref } });
  });
});

describe('sortByUrgency', () => {
  it('puts blocked, then pending questions, then QA returns, then near QA, keeping the incoming order inside a rank', () => {
    const plain1 = card('1');
    const plain2 = card('2');
    const ask = card('3');
    const ask2 = card('9');
    const fail = card('4', { stage: 'Test Fail' });
    const ready = card('5', { stage: 'Ready To Test' });
    const block = card('6', { blockers: ['x'] });
    const turns = { [ask.ref]: turn(ask.ref, { question: '?' }), [ask2.ref]: turn(ask2.ref, { question: '?' }) };
    const sorted = sortByUrgency([plain1, ready, plain2, fail, ask, block, ask2], turns, { [ask2.ref]: true }, LEGACY_STAGES);
    expect(sorted.map((c) => c.iid)).toEqual(['6', '3', '4', '5', '1', '2', '9']);
  });

  it('does not mutate the input', () => {
    const input = [card('1'), card('2', { blockers: ['x'] })];
    sortByUrgency(input, {}, {}, LEGACY_STAGES);
    expect(input.map((c) => c.iid)).toEqual(['1', '2']);
  });
});

describe('small helpers', () => {
  it('greets by the hour', () => {
    expect([3, 9, 12, 17, 18, 23].map(greeting)).toEqual(['Boa noite', 'Bom dia', 'Boa tarde', 'Boa tarde', 'Boa noite', 'Boa noite']);
  });

  it('labels MRs and stages', () => {
    expect([0, 1, 3].map(mrLabel)).toEqual(['sem MR', '1 MR', '3 MRs']);
    expect(stageLabel(card('1', { stage: 'STAGE:: Ready To Test' }))).toBe('Ready To Test');
    expect(stageLabel(card('1', { stage: null }))).toBe('sem estágio');
  });

  it('splits the day into percentages that add up to 100', () => {
    const segs = tempoSegments([
      { issue: '#1', title: 'a', minutes: 30, byCeremony: {} },
      { issue: null, title: 'b', minutes: 90, byCeremony: {} },
      { issue: '#2', title: 'c', minutes: 0, byCeremony: {} },
    ]);
    expect(segs.map((s) => s.pct)).toEqual([25, 75]);
    expect(tempoSegments([])).toEqual([]);
  });

  it('shows the bottom bar only where there is no floating composer', () => {
    expect(bottomNavActive('today')).toBe('today');
    expect(bottomNavActive('actions')).toBe('actions');
    expect(bottomNavActive('history')).toBe('history');
    expect(bottomNavActive('radar')).toBe('more');
    expect(bottomNavActive('call')).toBeNull();
    expect(bottomNavActive('deep')).toBeNull();
    expect(bottomNavActive('gate')).toBeNull();
  });
});

describe('MR conflicts', () => {
  const sz4 = { ref: 'sz4!9302', project: 'sz4/sz4', iid: 9302 };
  const hub = { ref: 'hub-whatsapp!797', project: 'broker-whatsapp/hub-whatsapp', iid: 797 };
  const conflicted = card('20', { mrs: [sz4.ref, hub.ref], mrPaths: [sz4, hub], blockers: [`${hub.ref}: MR com conflitos`, 'outro bloqueio'] });

  it('picks only the MRs the report blocks for conflicts', () => {
    expect(conflictMrs(conflicted)).toEqual([hub]);
    expect(conflictMrs(card('21', { mrPaths: [sz4], blockers: ['sz4!9302: pipeline falhou'] }))).toEqual([]);
    expect(conflictMrs(card('22', { mrPaths: [sz4], blockers: ['sz4!9302: MR com conflitos'] }))).toEqual([sz4]);
  });

  it('marks the blocked row so it can offer to resolve the conflict', () => {
    const [b] = needsYou({ cards: [conflicted], turns: {}, answered: {}, actions: [], alerts: [] });
    expect(b).toMatchObject({ kind: 'blocked', title: 'hub-whatsapp!797: MR com conflitos', conflictCard: conflicted });
    const [other] = needsYou({ cards: [card('23', { blockers: ['Depende do MR !42'] })], turns: {}, answered: {}, actions: [], alerts: [] });
    expect(other.conflictCard).toBeUndefined();
  });
});

describe('the dashboard follows the cycle', () => {
  const scrum = cycleOf(builtInTemplate('scrum') as CycleTemplate).stages;
  const kanban = cycleOf(builtInTemplate('kanban') as CycleTemplate).stages;
  const flow = cycleOf(builtInTemplate('github-flow') as CycleTemplate).stages;

  it('calls the daily preparation what the cycle calls it', () => {
    const p = agoraPlan({ ...base, label: 'daily scrum' });
    expect(p.title).toBe('Daily scrum');
    expect(p.primary.label).toBe('Começar a daily scrum');
    expect(agoraPlan({ ...base, callEnded: true, label: 'standup' }).title).toBe('Standup encerrada');
    expect(agoraPlan({ ...base, callEnded: true, saved: true, resumed: true, label: 'standup' }).hint).toBe('A standup de hoje já foi encerrada e a ata está gravada.');
    // Without a label it is what it always was.
    expect(agoraPlan(base).title).toBe('Pré-daily');
  });

  it('ranks the urgency by the stages of the cycle: a blocked card first, then the rest in the order they came', () => {
    const blocked = card('1', { blockers: ['x'] });
    const doing = card('2', { stage: 'In Progress' });
    const fresh = card('3', { stage: 'Backlog' });
    expect(sortByUrgency([fresh, doing, blocked], {}, {}, scrum).map((c) => c.iid)).toEqual(['1', '3', '2']);
    // A cycle with no QA stages has nothing "back from QA": the stage is just a stage.
    expect(urgencyRank(card('4', { stage: 'Test Fail' }), undefined, false, kanban)).toBe(4);
  });

  it('gives each cycle its own meaning to a stage, instead of the words of one company', () => {
    expect(urgencyRank(card('5', { stage: 'Test Fail' }), undefined, false, LEGACY_STAGES)).toBe(2);
    expect(urgencyRank(card('5', { stage: 'Changes requested' }), undefined, false, flow)).toBe(2);
    expect(urgencyRank(card('6', { stage: 'Approved' }), undefined, false, flow)).toBe(3);
  });

  it('greets in the language of the screen', () => {
    setLanguage('en');
    expect([3, 9, 14, 20].map(greeting)).toEqual(['Good evening', 'Good morning', 'Good afternoon', 'Good evening']);
    expect(stageLabel(card('7', { stage: null }))).toBe('no stage');
    setLanguage('pt-BR');
  });
});
