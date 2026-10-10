import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openersOf } from '../src/shared/cycles';
import type { AgentTurn, Card, Decision, SavedCeremony } from '../src/shared/types';
import { card as plainCard, ceremony } from './helpers/ceremony';
import { installLegacyConfig } from './helpers/config';
import { type Captured, calls, cardFixture, installFakeEngine, specFiles } from './helpers/promptCapture';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));

type Agents = typeof import('../src/main/agents');
type State = typeof import('../src/main/state');
type SameDay = typeof import('../src/main/sameDay');

let agents: Agents;
let state: State;
let sameDay: SameDay;
let falas: typeof import('../src/main/falas');
let saver: typeof import('../src/main/store');
let config: typeof import('../src/main/workspaceConfig');
let folder: string;
let plan: string;

const FIRST = '2026-10-02T094000';
const SECOND = '2026-10-02T141000';
const THIRD = '2026-10-02T170000';

const at = (clock: string) => vi.setSystemTime(new Date(`2026-10-02T${clock}`));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('09:40:00');
  await installLegacyConfig();
  await installFakeEngine();
  agents = await import('../src/main/agents');
  state = await import('../src/main/state');
  sameDay = await import('../src/main/sameDay');
  falas = await import('../src/main/falas');
  saver = await import('../src/main/store');
  config = await import('../src/main/workspaceConfig');
  ({ folder, plan } = specFiles(process.env.CERIMONIAS_SPECS_DIR as string));
});

beforeEach(async () => {
  const { ATAS } = await import('../src/main/env');
  const { rmSync, readdirSync } = await import('node:fs');
  for (const name of readdirSync(ATAS)) if (!['config.json', 'secrets.json'].includes(name)) rmSync(join(ATAS, name), { recursive: true, force: true });
  config.updateConfig((c) => {
    c.language = 'pt-BR';
    c.voice.enabled = true;
    return c;
  });
  calls.length = 0;
  at('09:40:00');
});

const subject = (over: Partial<Card> = {}): Card => cardFixture(folder, plan, { ref: 'web#101', iid: '101', title: 'Fix the report filter', mrs: ['web!303'], mrPaths: [{ ref: 'web!303', project: 'acme/web', iid: 303 }], url: 'https://git.acme.test/acme/web/-/work_items/101', stage: 'Doing', blockers: ['web!303: MR com conflitos'], pending: ['pipeline vermelha'], changes: [], ...over });

// The first meeting of the day, as the app saves it: the turn the agent gave, what Ana answered, what was decided and queued.
async function firstMeeting(c: Card, extra: { question?: string; answered?: boolean; decisions?: Decision[]; reply?: string } = {}): Promise<{ turn: AgentTurn; saved: SavedCeremony }> {
  at('09:40:00');
  const prepared = await agents.prepareTurn(c, { ceremonyId: FIRST });
  const turn: AgentTurn = { ...prepared, speech: 'The pipeline is red and the MR has conflicts.', next: 'Fix the conflicts', blocker: 'web!303: MR com conflitos', question: extra.question ?? null, options: ['yes', 'no'] };
  const saved = ceremony({
    id: FIRST,
    cards: [c],
    turns: { [c.ref]: turn },
    spoken: [c.ref],
    answered: extra.answered ? [c.ref] : [],
    decisions: extra.decisions ?? [{ ref: c.ref, text: 'Rebase on main before merging', target: 'ata', dest: 'minutes' }],
    effects: [{ ref: c.ref, text: 'Rebase the branch', repo: 'web' }],
    log: [
      { who: 'Moderador', text: 'Good morning', at: '0:00', color: '#000' },
      { who: `#${c.iid}`, text: turn.speech, at: '0:05', color: '#000' },
      { who: 'Você', text: extra.reply ?? 'Rebase it, Bruno owns the MR', at: '0:20', color: '#000' },
      { who: `#${c.iid}`, text: 'Noted.', at: '0:25', color: '#000' },
    ],
  });
  state.saveState(saved);
  calls.length = 0;
  return { turn, saved };
}

describe('the context an earlier meeting leaves', () => {
  it('reads what the person said to a card from the log, up to the next card', () => {
    const a = plainCard('acme#1');
    const b = plainCard('acme#2');
    const log = [
      { who: 'Moderador', text: 'Hello', at: '0:00', color: '' },
      { who: '#1', text: 'agent one', at: '0:01', color: '' },
      { who: 'Você', text: 'first reply', at: '0:02', color: '' },
      { who: '#1', text: 'ack', at: '0:03', color: '' },
      { who: 'Você', text: 'second reply', at: '0:04', color: '' },
      { who: '#2', text: 'agent two', at: '0:05', color: '' },
      { who: 'Você', text: 'for two', at: '0:06', color: '' },
      { who: 'Moderador', text: 'The end', at: '0:07', color: '' },
      { who: 'Você', text: 'after the end', at: '0:08', color: '' },
    ];
    const s = ceremony({ id: FIRST, cards: [a, b], log });
    expect(sameDay.repliesOf(s, a)).toEqual(['first reply', 'second reply']);
    expect(sameDay.repliesOf(s, b)).toEqual(['for two']);
  });

  it('only counts meetings of today that started a call and came before the one being held', async () => {
    const c = subject();
    state.saveState(ceremony({ id: '2026-10-01T094000', cards: [c], turns: { [c.ref]: {} as AgentTurn }, spoken: [c.ref] }));
    state.saveState(ceremony({ id: FIRST, cards: [c], startedAt: null }));
    state.saveState(ceremony({ id: SECOND, cards: [c] }));
    state.saveState(ceremony({ id: THIRD, cards: [c] }));
    expect(sameDay.earlierMeetings(THIRD).map((m) => m.state.id)).toEqual([SECOND]);
    expect(sameDay.earlierMeetings(undefined).map((m) => m.state.id)).toEqual([SECOND, THIRD]);
  });
});

describe('a card nothing happened to since an earlier meeting today', () => {
  it('gets a short turn built from the earlier one, with no agent call and no new speech', async () => {
    const c = subject();
    const { turn } = await firstMeeting(c, { question: 'Can Bruno rebase today?' });
    at('14:10:00');
    const again = await agents.prepareTurn(c, { ceremonyId: SECOND });
    expect(calls).toHaveLength(0);
    expect(again.sameDay).toMatchObject({ kind: 'unchanged', changes: [], decided: ['Rebase on main before merging'], version: 1 });
    expect(again.speech).toBe('Sem mudanças desde a call das 09:40. Ficou decidido: Rebase on main before merging. Bloqueio: web!303: MR com conflitos. Pendente: Can Bruno rebase today?');
    expect(again.did).toBe('Sem mudanças desde a call das 09:40.');
    expect(again.next).toBe(turn.next);
    expect(again.question).toBe('Can Bruno rebase today?');
    expect(again.options).toEqual(['yes', 'no']);
    expect(again.seen?.at).toBe(new Date('2026-10-02T14:10:00').toISOString());
  });

  it('drops the question once it was answered, and falls back to the next step as what is pending', async () => {
    const c = subject();
    await firstMeeting(c, { question: 'Can Bruno rebase today?', answered: true });
    at('14:10:00');
    const again = await agents.prepareTurn(c, { ceremonyId: SECOND });
    expect(again.question).toBeNull();
    expect(again.options).toEqual([]);
    expect(again.speech).toContain('Pendente: Fix the conflicts.');
  });

  it('uses the words of a conversation with no voice, and of English', async () => {
    const c = subject();
    await firstMeeting(c);
    config.updateConfig((cfg) => {
      cfg.voice.enabled = false;
      return cfg;
    });
    at('14:10:00');
    expect((await agents.prepareTurn(c, { ceremonyId: SECOND })).speech).toMatch(/^Sem mudanças desde a conversa das 09:40\./);
    config.updateConfig((cfg) => {
      cfg.language = 'en';
      return cfg;
    });
    expect((await agents.prepareTurn(c, { ceremonyId: SECOND })).speech).toMatch(/^No changes since the chat at 09:40\./);
    config.updateConfig((cfg) => {
      cfg.voice.enabled = true;
      return cfg;
    });
    const spoken = (await agents.prepareTurn(c, { ceremonyId: SECOND })).speech;
    expect(spoken).toMatch(/^No changes since the call at 09:40\. It was decided: Rebase on main before merging\./);
    expect(calls).toHaveLength(0);
  });

  it('counts as a speech that was not made, in the cost figures', async () => {
    const c = subject();
    await firstMeeting(c);
    const before = falas.reuseTimes().length;
    at('14:10:00');
    await agents.prepareTurn(c, { ceremonyId: SECOND });
    expect(falas.reuseTimes().length).toBe(before + 1);
  });

  it('goes to the agent anyway when the person asks to go deeper, and the prompt says nothing changed', async () => {
    const c = subject();
    await firstMeeting(c);
    at('14:10:00');
    const deeper = await agents.prepareTurn(c, { ceremonyId: SECOND, deepen: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].role).toBe('turn');
    expect(calls[0].prompt).toContain('Nada mudou no cartão desde então');
    expect(calls[0].prompt).toContain('Rebase on main before merging');
    expect(deeper.sameDay).toMatchObject({ kind: 'unchanged', deepened: true });
  });

  it('does not take the decision the app wrote itself into the plan for news', async () => {
    const c = subject();
    await firstMeeting(c, { decisions: [{ ref: c.ref, text: 'Rebase on main before merging', target: 'spec', dest: `${plan} › Registro` }] });
    // The ata was saved after the meeting: the Registro of the plan changed, and the app knows it did.
    at('09:55:00');
    await saver.saveMinutes(
      { startedAt: new Date('2026-10-02T09:40:00').toISOString(), endedAt: new Date('2026-10-02T09:50:00').toISOString(), decisions: [{ ref: c.ref, text: 'Rebase on main before merging', target: 'spec', dest: `${plan} › Registro` }], effects: [], unanswered: [], transcript: [] },
      '',
      [0],
      FIRST,
    );
    expect(readFileSync(plan, 'utf8')).toContain('Rebase on main before merging');
    utimesSync(plan, new Date(Date.now() + 3_600_000), new Date(Date.now() + 3_600_000));
    // utimes after the write: record it the way the write did (a real run has the time of the write itself).
    const { recordSelfWrite } = await import('../src/main/minutesStore');
    recordSelfWrite('2026-10-02', { file: plan });
    at('14:10:00');
    const again = await agents.prepareTurn(c, { ceremonyId: SECOND });
    expect(calls).toHaveLength(0);
    expect(again.sameDay?.kind).toBe('unchanged');
  });
});

describe('a card that changed since an earlier meeting today', () => {
  it('goes to the agent with what changed, and what was said, answered and decided before', async () => {
    const c = subject();
    await firstMeeting(c, { question: 'Can Bruno rebase today?' });
    at('14:10:00');
    const moved = subject({ stage: 'Code Review', blockers: [], pending: ['pipeline vermelha', 'falta aprovação'], changes: ['stage: Doing → Code Review'] });
    const turn = await agents.prepareTurn(moved, { ceremonyId: SECOND });
    expect(calls).toHaveLength(1);
    const prompt = calls[0].prompt;
    expect(prompt.split('\n')[0]).toBe('Você é o agente da atividade web#101 na pré-daily por voz.');
    expect(openersOf('turn.main').some((re) => re.test(prompt))).toBe(true);
    expect(prompt).toContain('na conversa das 09:40');
    expect(prompt).toContain('- etapa: Doing → Code Review');
    expect(prompt).toContain('- bloqueio resolvido: web!303: MR com conflitos');
    expect(prompt).toContain('- nova pendência: falta aprovação');
    expect(prompt).toContain('- O agente disse: The pipeline is red and the MR has conflicts.');
    expect(prompt).toContain('Rebase it, Bruno owns the MR');
    expect(prompt).toContain('- Decisões tomadas: Rebase on main before merging');
    expect(prompt).toContain('- Efeitos na fila para o Claude Code: Rebase the branch');
    expect(prompt).toContain('- Pergunta que ficou sem resposta: Can Bruno rebase today?');
    expect(prompt).toContain('Não repita o que já foi dito');
    expect(prompt).toContain('ainda valem');
    expect(prompt).not.toContain('desde ontem');
    expect(turn.sameDay).toMatchObject({ kind: 'changed', version: 1, decided: ['Rebase on main before merging'] });
    expect(turn.sameDay?.changes).toEqual(['etapa: Doing → Code Review', 'bloqueio resolvido: web!303: MR com conflitos', 'nova pendência: falta aprovação', 'movimento: stage: Doing → Code Review']);
    expect(turn.seen?.stage).toBe('Code Review');
  });

  it('takes a change in the spec files as a change', async () => {
    const c = subject();
    await firstMeeting(c);
    at('14:10:00');
    const file = join(folder, 'bug', '1_INVESTIGATION.md');
    writeFileSync(file, '# Investigation\n\nnew finding\n');
    utimesSync(file, new Date('2026-10-02T13:00:00'), new Date('2026-10-02T13:00:00'));
    await agents.prepareTurn(subject(), { ceremonyId: SECOND });
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('arquivos do spec mudaram: bug/1_INVESTIGATION.md');
  });

  it('is told in English for an English workspace', async () => {
    config.updateConfig((cfg) => {
      cfg.language = 'en';
      return cfg;
    });
    const c = subject();
    await firstMeeting(c);
    at('14:10:00');
    await agents.prepareTurn(subject({ stage: 'Code Review' }), { ceremonyId: SECOND });
    expect(calls[0].prompt).toContain('in the conversation at 09:40');
    expect(calls[0].prompt).toContain('- stage: Doing → Code Review');
    expect(calls[0].prompt).toContain('Do not repeat what was already said');
  });
});

describe('what the earlier meeting precedes', () => {
  it('comes before the reuse of a speech from an earlier day', async () => {
    const c = subject();
    // Yesterday's speech is saved for the same card state: without an earlier meeting today it is served again, with no call.
    at('09:40:00');
    falas.rememberTurn(c, { ref: c.ref, sessionId: null, speech: 'Yesterday.', did: 'did', next: 'Next', blocker: null, question: null }, falas.cardFingerprint(c), Date.parse('2026-10-01T10:00:00'));
    const first = await agents.prepareTurn(c, { ceremonyId: FIRST });
    expect(calls).toHaveLength(0);
    expect(first.reused).toBeDefined();
    expect(first.sameDay).toBeUndefined();
    expect(first.seen).toBeDefined();
    // A meeting earlier today covered the card: the same-day logic answers, and the card did change.
    state.saveState(ceremony({ id: FIRST, cards: [c], turns: { [c.ref]: first }, spoken: [c.ref] }));
    at('14:10:00');
    const changed = await agents.prepareTurn(subject({ stage: 'Code Review' }), { ceremonyId: SECOND });
    expect(calls).toHaveLength(1);
    expect(changed.reused).toBeUndefined();
    expect(changed.sameDay?.kind).toBe('changed');
    calls.length = 0;
    const unchanged = await agents.prepareTurn(c, { ceremonyId: SECOND });
    expect(calls).toHaveLength(0);
    expect(unchanged.reused).toBeUndefined();
    expect(unchanged.sameDay?.kind).toBe('unchanged');
  });

  it('treats a turn saved before the app kept what the card looked like as the card of that meeting', async () => {
    const c = subject();
    state.saveState(ceremony({ id: FIRST, cards: [c], turns: { [c.ref]: { ref: c.ref, sessionId: null, speech: 'Old.', did: 'did', next: 'Next', blocker: null, question: null } }, spoken: [c.ref] }));
    at('14:10:00');
    expect((await agents.prepareTurn(c, { ceremonyId: SECOND })).sameDay?.kind).toBe('unchanged');
    expect(calls).toHaveLength(0);
    await agents.prepareTurn(subject({ blockers: [] }), { ceremonyId: SECOND });
    expect(calls).toHaveLength(1);
  });
});

describe('the agenda of a later meeting', () => {
  it('marks each card as new, unchanged or changed since an earlier meeting, and puts what moved or is blocked first', async () => {
    const quiet = subject({ ref: 'acme#1', iid: '1', blockers: [], pending: [], spec: null });
    const moving = subject({ ref: 'acme#2', iid: '2', blockers: [], pending: [], spec: null });
    const stuck = subject({ ref: 'acme#3', iid: '3', spec: null });
    const fresh = subject({ ref: 'acme#4', iid: '4', blockers: [], pending: [], spec: null });
    at('09:40:00');
    const turns: Record<string, AgentTurn> = {};
    for (const c of [quiet, moving, stuck]) turns[c.ref] = await agents.prepareTurn(c, { ceremonyId: FIRST });
    state.saveState(ceremony({ id: FIRST, cards: [quiet, moving, stuck], turns, spoken: [quiet.ref, moving.ref, stuck.ref] }));
    at('14:10:00');
    const now = [quiet, { ...moving, stage: 'Code Review' }, stuck, fresh];
    const { cards, marks } = sameDay.agenda(now, SECOND);
    expect(Object.fromEntries(Object.entries(marks).map(([ref, m]) => [ref, m.kind]))).toEqual({ 'acme#1': 'unchanged', 'acme#2': 'changed', 'acme#3': 'unchanged', 'acme#4': 'new' });
    expect(marks['acme#1'].since).toBe(new Date('2026-10-02T09:40:00').toISOString());
    expect(marks['acme#1'].version).toBe(1);
    // Blocked first (the shared order), then what moved and what is new in the order they came; the card nothing happened to goes last.
    expect(cards.map((c) => c.ref)).toEqual(['acme#3', 'acme#2', 'acme#4', 'acme#1']);
  });

  it('leaves the first meeting of the day as it is', () => {
    const cards = [subject({ ref: 'acme#1', iid: '1' }), subject({ ref: 'acme#2', iid: '2' })];
    const { cards: ordered, marks } = sameDay.agenda(cards, FIRST);
    expect(ordered.map((c) => c.ref)).toEqual(['acme#1', 'acme#2']);
    expect(Object.values(marks).every((m) => m.kind === 'new')).toBe(true);
  });
});

describe('the cross-day note of a question the earlier days also left unanswered', () => {
  const PREV = '2026-10-01';
  const prevMeeting = async (stage: string) => {
    state.saveState(ceremony({ id: `${PREV}T094000`, cards: [subject({ stage })], turns: { 'web#101': { ref: 'web#101', sessionId: null, speech: 'Yesterday.', did: 'did', next: 'Next', blocker: null, question: 'Can it be approved today?' } }, spoken: ['web#101'] }));
    (await import('../src/main/minutesStore')).dayView(PREV);
  };

  it('reaches the prompt of a card covered for the first time today', async () => {
    await prevMeeting('Doing');
    at('09:40:00');
    await agents.prepareTurn(subject());
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('Esta decisão já ficou sem resposta nos dias anteriores: 2026-10-01.');
  });

  it('reaches the prompt of the same-day turn as well, said next to what the earlier meeting left', async () => {
    await prevMeeting('Doing');
    const c = subject();
    await firstMeeting(c, { question: 'Can Bruno rebase today?' });
    at('14:10:00');
    const moved = subject({ pending: ['pipeline vermelha', 'needs approval'] });
    await agents.prepareTurn(moved, { ceremonyId: SECOND });
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('Esta decisão já ficou sem resposta nos dias anteriores: 2026-10-01.');
  });
});

describe('prompts of a second meeting, against the files captured when the feature was written', () => {
  function golden(name: string, captured: Record<string, Captured>): void {
    const file = join(import.meta.dirname, 'golden', name);
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, `${JSON.stringify(captured, null, 1)}\n`);
    expect(captured).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  }

  async function secondMeeting(): Promise<Record<string, Captured>> {
    const c = subject();
    await firstMeeting(c, { question: 'Can Bruno rebase today?' });
    at('14:10:00');
    const moved = subject({ stage: 'Code Review', blockers: [], pending: ['pipeline vermelha', 'falta aprovação'], changes: ['stage: Doing → Code Review'] });
    await agents.prepareTurn(moved, { ceremonyId: SECOND });
    await agents.prepareTurn(c, { ceremonyId: SECOND, deepen: true });
    const out = Object.fromEntries(calls.map((x, i) => [i === 0 ? 'turn-changed' : 'turn-deepened', x]));
    return JSON.parse(JSON.stringify(out).split(folder).join('<SPECS>')) as Record<string, Captured>;
  }

  it('voice on', async () => {
    golden('same-day-prompts.json', await secondMeeting());
  });

  it('voice off', async () => {
    config.updateConfig((cfg) => {
      cfg.voice.enabled = false;
      return cfg;
    });
    golden('same-day-prompts-novoice.json', await secondMeeting());
  });
});
