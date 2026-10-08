import { describe, expect, it } from 'vitest';
import { ASSIST_LIMITS, MINIMUM_SETTINGS, type AssistQuestion, type AssistRound, type AssistSettings } from '../src/shared/agentAssist';
import { blankAgent, type AgentDraft } from '../src/renderer/src/screens/team/agentEdit';
import {
  answerOf,
  answeredCount,
  canAskAnotherRound,
  closeRound,
  diffAgent,
  floorOf,
  hasProgress,
  pickOption,
  resetField,
  reviewRows,
  roundNumber,
  roundsLeft,
  settingsOfDraft,
  startAssist,
  toAgentDraft,
  toDraftInput,
  toInput,
  withAnswer,
  withOther,
  withReview,
  withRound,
  withText,
  type AssistState,
} from '../src/renderer/src/screens/team/assistEdit';

// What the agent assistant's screen holds between two answers of the model, as pure functions: the rounds and their limit, the answers, the review and its "back to
// the minimum", and the form the editor opens. Nothing here reaches a model.

const open = (id: string, text = 'What should it read?'): AssistQuestion => ({ id, text, kind: 'open', options: [], why: 'It sets what the agent knows.' });
const single = (id: string): AssistQuestion => ({ id, text: 'Which repository?', kind: 'single', options: ['api', 'web', 'docs'], why: 'It sets the code the agent reads.' });
const multi = (id: string): AssistQuestion => ({ id, text: 'Which labels?', kind: 'multi', options: ['bug', 'feature', 'chore'], why: 'It sets what it triages.' });
const round = (...questions: AssistQuestion[]): AssistRound => ({ questions, answers: [] });

/** An assistant that has answered `n` rounds and has a new one on screen (when `n` is under four). */
function afterRounds(n: number, extra: Partial<AssistState> = {}): AssistState {
  let s = startAssist();
  for (let i = 0; i < n; i++) s = closeRound(withRound(s, { questions: [open('q1')], draft: { name: 'A', job: 'J', instructions: 'I' }, enough: false }));
  return { ...s, ...extra };
}

const textsOf = (d: AgentDraft) => ({ name: d.name, job: d.job, instructions: d.instructions });

const original = (): AgentDraft => ({
  ...blankAgent(),
  id: 'triager',
  name: 'Triager',
  job: 'Triage new issues',
  instructions: 'Read the issue and say what is missing.',
  tracker: 'read',
  shell: 'sandbox',
  allowedCommands: ['npm test:*'],
  autonomous: true,
  squad: 'payments',
  turnsTo: 'qa',
  stages: ['refine'],
  tools: { files: true, skills: false, trackerMcp: false, trackerMcpServer: '', vcsCli: true, subagents: false },
});

describe('starting the assistant', () => {
  it('creates from the minimum of a new agent, as a copy, and adjusts from the form it is given', () => {
    const a = startAssist();
    expect(a).toMatchObject({ mode: 'create', base: null, step: 'request', rounds: [], open: null, testId: null, enough: false });
    expect(a.settings).toEqual(MINIMUM_SETTINGS);
    a.settings.stages.push('x');
    expect(MINIMUM_SETTINGS.stages).toEqual([]);

    const form = original();
    const b = startAssist(form);
    expect(b).toMatchObject({ mode: 'adjust', step: 'request' });
    expect(b.base).toEqual(form);
    expect(b.settings).toEqual(settingsOfDraft(form));
    expect(b.draft).toEqual({ name: 'Triager', job: 'Triage new issues', instructions: 'Read the issue and say what is missing.' });
    // the assistant keeps the form as it was: the editor may change it afterwards without moving the base
    form.stages.push('later');
    form.allowedCommands.push('later');
    expect(b.base?.stages).toEqual(['refine']);
    expect(b.base?.allowedCommands).toEqual(['npm test:*']);
  });

  it('tells two assistants apart, so the answer of one is not applied to the other', () => {
    expect(startAssist().session).not.toBe(startAssist().session);
  });
});

describe('the answers', () => {
  it('treats a question with no answer as skipped, and an answer left empty as no answer at all', () => {
    const r = round(open('q1'), single('q2'), multi('q3'));
    expect(answerOf(r, 'q2')).toEqual({ question: 'q2', picked: [], other: '', text: '' });
    const answered = withAnswer(r, { question: 'q1', picked: [], other: '', text: 'Only the open issues' });
    expect(answered.answers).toEqual([{ question: 'q1', picked: [], other: '', text: 'Only the open issues' }]);
    expect(answeredCount(answered)).toBe(1);
    // clearing the text puts the question back among the skipped
    const cleared = withAnswer(answered, { question: 'q1', picked: [], other: '', text: '   ' });
    expect(cleared.answers).toEqual([]);
    expect(answeredCount(cleared)).toBe(0);
  });

  it('keeps the answers in the order of the questions and replaces the one a question already had', () => {
    let r = round(open('q1'), single('q2'), multi('q3'));
    r = withAnswer(r, { question: 'q3', picked: ['bug'], other: '', text: '' });
    r = withAnswer(r, { question: 'q1', picked: [], other: '', text: 'a' });
    r = withAnswer(r, { question: 'q3', picked: ['feature'], other: '', text: '' });
    expect(r.answers.map((a) => [a.question, a.picked])).toEqual([['q1', []], ['q3', ['feature']]]);
  });

  it('holds one option for a single choice, toggles them for a multiple choice, and lets "Other" carry text', () => {
    const s = single('q1');
    const m = multi('q2');
    let a = pickOption(answerOf(round(s), 'q1'), s, 'web');
    expect(a.picked).toEqual(['web']);
    a = pickOption(a, s, 'api');
    expect(a.picked).toEqual(['api']);
    // "Other" is the choice of a single question: nothing else stays picked, and picking an option takes the text away
    a = withOther(a, s, 'the mobile app');
    expect(a).toMatchObject({ picked: [], other: 'the mobile app' });
    expect(pickOption(a, s, 'docs')).toMatchObject({ picked: ['docs'], other: '' });

    let b = pickOption(answerOf(round(m), 'q2'), m, 'chore');
    b = pickOption(b, m, 'bug');
    expect(b.picked).toEqual(['bug', 'chore']);
    b = withOther(b, m, 'security');
    expect(b).toMatchObject({ picked: ['bug', 'chore'], other: 'security' });
    expect(pickOption(b, m, 'bug').picked).toEqual(['chore']);

    expect(withText(answerOf(round(open('q1')), 'q1'), 'hello').text).toBe('hello');
  });

  it('cuts what a person typed to the limits when it is stored', () => {
    const r = withAnswer(round(open('q1')), { question: 'q1', picked: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], other: 'x'.repeat(900), text: 'y'.repeat(900) });
    expect(r.answers[0].picked).toHaveLength(ASSIST_LIMITS.options);
    expect(r.answers[0].other).toHaveLength(ASSIST_LIMITS.answer);
    expect(r.answers[0].text).toHaveLength(ASSIST_LIMITS.answer);
  });
});

describe('the rounds', () => {
  it('numbers the round on screen and counts the ones that can still be asked: the fifth does not exist', () => {
    const first = withRound(startAssist(), { questions: [open('q1')], draft: { name: 'A', job: '', instructions: '' }, enough: false });
    expect(roundNumber(first)).toBe(1);
    expect(roundsLeft(first)).toBe(3);
    expect(canAskAnotherRound(first)).toBe(true);

    const fourth = afterRounds(3, {});
    const onScreenFourth = withRound(fourth, { questions: [open('q1')], draft: fourth.draft, enough: false });
    expect(roundNumber(onScreenFourth)).toBe(4);
    expect(roundsLeft(onScreenFourth)).toBe(0);
    expect(canAskAnotherRound(onScreenFourth)).toBe(false);

    // four answered and none on screen: nothing is left to ask
    expect(roundsLeft(afterRounds(4))).toBe(0);
    expect(roundsLeft(afterRounds(5))).toBe(0);
  });

  it('stops offering the next round when the model says it has nothing more to ask', () => {
    const s = withRound(startAssist(), { questions: [open('q1')], draft: { name: 'A', job: '', instructions: '' }, enough: true });
    expect(roundsLeft(s)).toBe(3);
    expect(canAskAnotherRound(s)).toBe(false);
  });

  it('counts the round that comes from a test like any other', () => {
    const tested = afterRounds(3, { step: 'test', testId: 'trial' });
    expect(roundsLeft(tested)).toBe(1);
    const fromTest = withRound(tested, { questions: [open('q1')], draft: tested.draft, enough: false });
    expect(roundNumber(fromTest)).toBe(4);
    expect(roundsLeft(fromTest)).toBe(0);
    // with the four used, the test can no longer start a round
    expect(roundsLeft(afterRounds(4, { step: 'test', testId: 'trial' }))).toBe(0);
  });

  it('moves the round on screen to the answered ones, and does not keep one with no question in it', () => {
    const s = withRound(startAssist(), { questions: [open('q1'), single('q2')], draft: { name: 'A', job: '', instructions: '' }, enough: false });
    const closed = closeRound(s);
    expect(closed.open).toBeNull();
    expect(closed.rounds).toHaveLength(1);
    expect(closed.rounds[0].questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(closeRound(closed)).toBe(closed);

    const nothing = closeRound(withRound(startAssist(), { questions: [], draft: { name: 'A', job: '', instructions: '' }, enough: false }));
    expect(nothing.rounds).toEqual([]);
    expect(nothing.open).toBeNull();
  });

  it('knows when closing would lose something: an answered round, an answer on screen or a draft agent', () => {
    const fresh = startAssist();
    expect(hasProgress(fresh)).toBe(false);
    const shown = withRound(fresh, { questions: [open('q1')], draft: { name: 'A', job: '', instructions: '' }, enough: false });
    expect(hasProgress(shown)).toBe(false);
    expect(hasProgress({ ...shown, open: withAnswer(shown.open as AssistRound, { question: 'q1', picked: [], other: '', text: 'x' }) })).toBe(true);
    expect(hasProgress(closeRound(shown))).toBe(true);
    expect(hasProgress({ ...fresh, testId: 'trial' })).toBe(true);
  });

  it('leaves the request and the earlier rounds alone when a new round comes, and clears the note that led to it', () => {
    const s = { ...afterRounds(1), request: 'triage issues', note: 'it answered in the wrong language', step: 'test' as const };
    const next = withRound(s, { questions: [open('q1')], draft: { name: 'B', job: 'K', instructions: 'L' }, enough: false });
    expect(next).toMatchObject({ step: 'questions', request: 'triage issues', note: '', draft: { name: 'B' } });
    expect(next.rounds).toHaveLength(1);
  });
});

describe('what the channels are sent', () => {
  it('sends the request, the answered rounds and the draft, cut to the limits, with the skipped answers left out', () => {
    let s = startAssist();
    s = withRound({ ...s, request: 'r'.repeat(ASSIST_LIMITS.request + 500) }, { questions: [open('q1'), single('q2'), multi('q3')], draft: { name: 'n'.repeat(120), job: 'j'.repeat(1500), instructions: 'i'.repeat(5000) }, enough: false });
    let r = s.open as AssistRound;
    r = withAnswer(r, { question: 'q1', picked: [], other: '', text: 'x'.repeat(2000) });
    r = withAnswer(r, { question: 'q3', picked: ['bug'], other: ' security ', text: '' });
    s = closeRound({ ...s, open: r });

    const input = toInput(s);
    expect(input.mode).toBe('create');
    expect(input.request).toHaveLength(ASSIST_LIMITS.request);
    expect(input.draft.name).toHaveLength(ASSIST_LIMITS.name);
    expect(input.draft.job).toHaveLength(ASSIST_LIMITS.job);
    expect(input.draft.instructions).toHaveLength(ASSIST_LIMITS.instructions);
    expect(input.rounds).toHaveLength(1);
    expect(input.rounds[0].answers.map((a) => a.question)).toEqual(['q1', 'q3']);
    expect(input.rounds[0].answers[0].text).toHaveLength(600);
    expect(input.rounds[0].answers[1]).toEqual({ question: 'q3', picked: ['bug'], other: 'security', text: '' });
    expect(input).not.toHaveProperty('from');
    expect(input).not.toHaveProperty('base');
    expect(input).not.toHaveProperty('testId');
  });

  it('never sends more than four rounds nor more than six answers in one', () => {
    const q = Array.from({ length: 6 }, (_, i) => open(`q${i + 1}`));
    const full: AssistRound = { questions: q, answers: q.map((x) => ({ question: x.id, picked: [], other: '', text: 'a' })).concat([{ question: 'q7', picked: [], other: '', text: 'b' }]) };
    const input = toInput({ ...startAssist(), rounds: [full, full, full, full, full] });
    expect(input.rounds).toHaveLength(ASSIST_LIMITS.rounds);
    expect(input.rounds[0].answers).toHaveLength(ASSIST_LIMITS.answersPerRound);
  });

  it('carries the agent as the form held it when adjusting, and the draft agent and the note only when the round comes from a test', () => {
    const s = { ...startAssist(original()), request: 'be shorter', testId: 'triager-draft', note: '  it ignored the labels  ' };
    const plain = toInput(s);
    expect(plain).toMatchObject({ mode: 'adjust', from: 'triager', base: { draft: { name: 'Triager' }, settings: { tracker: 'read', shell: 'sandbox', squad: 'payments', turnsTo: 'qa', stages: ['refine'] } } });
    expect(plain).not.toHaveProperty('testId');
    expect(plain).not.toHaveProperty('note');
    expect(toInput(s, true)).toMatchObject({ testId: 'triager-draft', note: 'it ignored the labels' });
    // a test that was never saved has nothing to read
    expect(toInput({ ...s, testId: null }, true)).not.toHaveProperty('testId');
  });

  it('sends the draft agent the values and not the reasons, and names the one it updates and the one it is a copy of', () => {
    const s = withReview(startAssist(original()), { draft: { name: 'Triager 2', job: 'J', instructions: 'I' }, settings: { ...settingsOfDraft(original()), tracker: 'none' }, reasons: { tracker: 'not needed' } });
    expect(toDraftInput(s)).toEqual({ from: 'triager', draft: { name: 'Triager 2', job: 'J', instructions: 'I' }, settings: { ...settingsOfDraft(original()), tracker: 'none' } });
    expect(toDraftInput({ ...s, testId: 'triager-draft' })).toMatchObject({ id: 'triager-draft', from: 'triager' });
    expect(toDraftInput(startAssist())).not.toHaveProperty('from');
  });
});

describe('the review', () => {
  const proposed: AssistSettings = { ...MINIMUM_SETTINGS, permission: 'worktree', tracker: 'read', shell: 'allowlist', stages: ['implement'], turnsTo: 'tech-lead' };
  const reasons = { permission: 'It edits files.', tracker: 'It reads the issue.', shell: 'It runs the tests.', stages: 'It implements.', turnsTo: 'It asks the lead.' };

  it('lists only the values above the minimum of a new agent, each with its reason', () => {
    const s = withReview(startAssist(), { draft: { name: 'A', job: 'J', instructions: 'I' }, settings: { ...MINIMUM_SETTINGS, tracker: 'read' }, reasons: { tracker: 'It reads the issue.' } });
    expect(reviewRows(s)).toEqual([{ field: 'tracker', before: 'none', value: 'read', reason: 'It reads the issue.' }]);
    expect(reviewRows(withReview(startAssist(), { draft: s.draft, settings: MINIMUM_SETTINGS, reasons: {} }))).toEqual([]);
  });

  it('lists, when adjusting, what differs from the agent as it was, with the value it had', () => {
    const form = original();
    const s = withReview(startAssist(form), { draft: textsOf(form), settings: { ...settingsOfDraft(form), tracker: 'none', stages: ['refine', 'plan'] }, reasons: { tracker: 'Not needed.', stages: 'Also plans.' } });
    expect(reviewRows(s)).toEqual([
      { field: 'tracker', before: 'read', value: 'none', reason: 'Not needed.' },
      { field: 'stages', before: ['refine'], value: ['refine', 'plan'], reason: 'Also plans.' },
    ]);
    // the minimum is not the measure here: the agent already reads the tracker, and that is not a change
    expect(reviewRows(startAssist(form))).toEqual([]);
  });

  it('puts a value back at the minimum, with its reason, and keeps the others', () => {
    const s = withReview(startAssist(), { draft: { name: 'A', job: '', instructions: '' }, settings: proposed, reasons });
    const back = resetField(s, 'tracker');
    expect(back.settings.tracker).toBe('none');
    expect(back.reasons.tracker).toBeUndefined();
    expect(back.settings.permission).toBe('worktree');
    expect(reviewRows(back).map((r) => r.field)).toEqual(['permission', 'shell', 'stages', 'turnsTo']);
    expect(resetField(s, 'stages').settings.stages).toEqual([]);
    expect(proposed.stages).toEqual(['implement']);
  });

  it('does not leave commands from the list on an agent that no longer writes', () => {
    const s = withReview(startAssist(), { draft: { name: 'A', job: '', instructions: '' }, settings: proposed, reasons });
    const back = resetField(s, 'permission');
    expect(back.settings).toMatchObject({ permission: 'read', shell: 'none' });
    expect(back.reasons.shell).toBeUndefined();
    expect(reviewRows(back).map((r) => r.field)).toEqual(['tracker', 'stages', 'turnsTo']);
  });

  it('puts the tools back at the workspace\'s own with no copy shared', () => {
    const tools = { files: false, skills: true, trackerMcp: false, trackerMcpServer: '', vcsCli: true, subagents: false };
    const s = withReview(startAssist(), { draft: { name: 'A', job: '', instructions: '' }, settings: { ...MINIMUM_SETTINGS, tools }, reasons: { tools: 'No file reading.' } });
    expect(reviewRows(s).map((r) => r.field)).toEqual(['tools']);
    expect(resetField(s, 'tools').settings.tools).toBeNull();
  });

  it('goes back, when adjusting, to the value the agent had and not to the minimum', () => {
    const form = original();
    const s = withReview(startAssist(form), { draft: textsOf(form), settings: { ...settingsOfDraft(form), tracker: 'none', squad: null, turnsTo: null, stages: [] }, reasons: { tracker: 'a', squad: 'b', turnsTo: 'c', stages: 'd' } });
    const back = resetField(resetField(resetField(resetField(s, 'tracker'), 'squad'), 'turnsTo'), 'stages');
    expect(back.settings).toMatchObject({ tracker: 'read', squad: 'payments', turnsTo: 'qa', stages: ['refine'] });
    expect(reviewRows(back)).toEqual([]);
    expect(back.reasons).toEqual({});
    // and the floor is the form, not the minimum
    expect(floorOf(s)).toMatchObject({ tracker: 'read', shell: 'sandbox' });
  });

  it('shows what adjusting changed, before and after, and nothing when creating', () => {
    const form = original();
    const s = withReview(startAssist(form), { draft: { name: 'Triager', job: 'Triage and label new issues', instructions: form.instructions }, settings: { ...settingsOfDraft(form), turnsTo: null }, reasons: { turnsTo: 'Asks you.' } });
    expect(diffAgent(s)).toEqual({
      texts: [{ field: 'job', before: 'Triage new issues', after: 'Triage and label new issues' }],
      settings: [{ field: 'turnsTo', before: 'qa', value: null, reason: 'Asks you.' }],
    });
    expect(diffAgent(withReview(startAssist(), { draft: s.draft, settings: proposed, reasons }))).toEqual({ texts: [], settings: [] });
  });
});

describe('the form the editor opens', () => {
  it('makes a new agent from the draft and the settings over a blank one, with an id from the name that is free', () => {
    const s = withReview(startAssist(), { draft: { name: 'Líder Técnico', job: 'Leads', instructions: 'Lead the team.' }, settings: { ...MINIMUM_SETTINGS, tracker: 'read', stages: ['plan'], squad: 'payments', turnsTo: 'qa' }, reasons: {} });
    const form = toAgentDraft(s, ['developer', 'lider-tecnico']);
    expect(form).toMatchObject({ id: 'lider-tecnico-2', name: 'Líder Técnico', job: 'Leads', instructions: 'Lead the team.', tracker: 'read', stages: ['plan'], squad: 'payments', turnsTo: 'qa' });
    // what the assistant never decides is what a blank agent has
    expect(form).toMatchObject({ model: { role: 'deep', provider: '', model: '' }, autonomous: false, allowedCommands: [], permission: 'read', shell: 'none', tools: null });
  });

  it('keeps the id of the draft agent saved for the test, so the editor promotes that one', () => {
    const s = withReview({ ...startAssist(), testId: 'lider-tecnico' }, { draft: { name: 'Another name', job: '', instructions: '' }, settings: MINIMUM_SETTINGS, reasons: {} });
    expect(toAgentDraft(s, ['lider-tecnico']).id).toBe('lider-tecnico');
  });

  it('opens an agent being adjusted on its own form, with what the assistant proposed over it and the rest as the person had it', () => {
    const form = original();
    const s = withReview(startAssist(form), { draft: { name: 'Triager 2', job: 'New job', instructions: 'New instructions' }, settings: { ...settingsOfDraft(form), tracker: 'none', turnsTo: null }, reasons: {} });
    const out = toAgentDraft(s, ['triager']);
    expect(out).toMatchObject({ id: 'triager', name: 'Triager 2', job: 'New job', instructions: 'New instructions', tracker: 'none', turnsTo: null, shell: 'sandbox', squad: 'payments', stages: ['refine'] });
    // the model, the commands always allowed and the autonomy are the agent's own
    expect(out).toMatchObject({ autonomous: true, allowedCommands: ['npm test:*'], model: form.model });
    out.allowedCommands.push('x');
    expect(s.base?.allowedCommands).toEqual(['npm test:*']);
  });
});
