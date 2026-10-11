// What the persona's wizard holds between two answers of the model, as pure functions: its steps, the rounds and their limit, what is sent to the channels (the texts and the
// answers, never a setting), adjusting a persona that exists, and closing. The rounds are the agent assistant's own, shared through the structural state. Nothing here reaches
// a model or the main process.
import { describe, expect, it } from 'vitest';
import { ASSIST_LIMITS, type AssistQuestion, type AssistRound } from '../src/shared/agentAssist';
import { answerOf, canAskAnotherRound, closeRound, hasProgress, roundNumber, roundsLeft, withAnswer, withRound } from '../src/renderer/src/screens/team/assistEdit';
import { draftChanged, personaFormOf, startPersona, toFinishInput, toPersonaDraftInput, toPersonaInput, withPersonaReview, type PersonaState } from '../src/renderer/src/screens/persona/personaWizardModel';

const open = (id: string): AssistQuestion => ({ id, text: 'How do you decide?', kind: 'open', options: [], why: 'It sets the pace.' });
const single = (id: string): AssistQuestion => ({ id, text: 'What matters most?', kind: 'single', options: ['quality', 'speed'], why: 'A priority.' });
const draft = { name: 'Ana', job: 'Represents Ana.', instructions: 'You represent Ana.' };

/** A wizard that has answered `n` rounds, with a new one on screen. */
function afterRounds(n: number, extra: Partial<PersonaState> = {}): PersonaState {
  let s = startPersona();
  for (let i = 0; i < n; i++) s = closeRound(withRound(s, { questions: [open('q1'), single('q2')], draft, enough: false }));
  return { ...s, ...extra };
}

describe('starting', () => {
  it('begins creating, at the request, with nothing', () => {
    const s = startPersona();
    expect(s).toMatchObject({ mode: 'create', base: null, step: 'request', request: '', rounds: [], open: null, enough: false, testId: null, note: '', draft: { name: '', job: '', instructions: '' } });
  });

  it('begins adjusting from the persona as a person reads it, and every wizard is a session of its own', () => {
    const form = personaFormOf({ id: 'me', name: 'Me', job: 'A job.', instructions: 'About me.' });
    const s = startPersona(form);
    expect(s).toMatchObject({ mode: 'adjust', base: { id: 'me', draft: { name: 'Me', job: 'A job.', instructions: 'About me.' } }, draft: { name: 'Me', job: 'A job.', instructions: 'About me.' } });
    // the base is a copy: editing the draft never changes what the persona was
    s.draft.name = 'Changed';
    expect(s.base?.draft.name).toBe('Me');
    expect(startPersona().session).toBeGreaterThan(s.session);
  });
});

describe('the rounds, which are the agent assistant\'s own', () => {
  it('count up to four, and the fifth does not exist', () => {
    const onScreen = (n: number) => withRound(afterRounds(n), { questions: [open('q1')], draft, enough: false });
    expect(roundNumber(afterRounds(0))).toBe(1);
    expect(roundNumber(afterRounds(2))).toBe(3);
    // the round on screen is one of the four
    expect(roundsLeft(onScreen(0))).toBe(3);
    expect(roundsLeft(onScreen(1))).toBe(2);
    expect(canAskAnotherRound(onScreen(2))).toBe(true);
    expect(canAskAnotherRound(onScreen(3))).toBe(false);
    expect(roundsLeft(onScreen(3))).toBe(0);
    expect(ASSIST_LIMITS.rounds).toBe(4);
  });

  it('puts the questions on screen unanswered, with the draft the model wrote and the step they belong to', () => {
    const s = withRound(startPersona(), { questions: [open('q1')], draft, enough: true });
    expect(s).toMatchObject({ step: 'questions', draft, enough: true, note: '' });
    expect(s.open?.questions).toHaveLength(1);
    expect(s.open?.answers).toEqual([]);
    expect(canAskAnotherRound(s)).toBe(false);
  });

  it('keeps an answer, and a question left empty is a skipped one that is not kept', () => {
    const s = afterRounds(0, { open: { questions: [open('q1'), single('q2')], answers: [] } });
    const answered = withAnswer(s.open as AssistRound, { question: 'q2', picked: ['speed'], other: '', text: '' });
    expect(answerOf(answered, 'q2').picked).toEqual(['speed']);
    const skipped = withAnswer(answered, { question: 'q2', picked: [], other: '', text: '' });
    expect(skipped.answers).toEqual([]);
    expect(answerOf(skipped, 'q2')).toEqual({ question: 'q2', picked: [], other: '', text: '' });
  });

  it('moves the round on screen to the answered ones, and does not keep a round with no question', () => {
    const closed = closeRound(withRound(startPersona(), { questions: [open('q1')], draft, enough: false }));
    expect(closed.rounds).toHaveLength(1);
    expect(closed.open).toBeNull();
    const empty = closeRound(withRound(startPersona(), { questions: [], draft, enough: false }));
    expect(empty.rounds).toEqual([]);
  });
});

describe('the review', () => {
  it('carries the three texts and nothing else', () => {
    const s = withPersonaReview(afterRounds(1), { draft: { name: 'Ana', job: 'A tech lead.', instructions: '## Who the person is\nA tech lead.' } });
    expect(s).toMatchObject({ step: 'review', open: null, draft: { name: 'Ana', job: 'A tech lead.' } });
    expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['settings', 'reasons']));
  });
});

describe('what the channels are sent', () => {
  it('sends the request, the answered rounds and the draft, cut to the limits, and no setting', () => {
    const s = afterRounds(1, { request: `  ${'r'.repeat(5000)}  `, draft: { name: 'N'.repeat(200), job: 'J'.repeat(3000), instructions: 'I'.repeat(9000) } });
    const input = toPersonaInput(s);
    expect(input).toMatchObject({ mode: 'create' });
    expect(input.request).toHaveLength(ASSIST_LIMITS.request);
    expect(input.draft.name).toHaveLength(ASSIST_LIMITS.name);
    expect(input.draft.job).toHaveLength(ASSIST_LIMITS.job);
    expect(input.draft.instructions).toHaveLength(ASSIST_LIMITS.instructions);
    expect(input.rounds).toHaveLength(1);
    expect(Object.keys(input).sort()).toEqual(['draft', 'mode', 'request', 'rounds']);
    expect(JSON.stringify(input)).not.toMatch(/permission|tracker|shell|settings/);
  });

  it('leaves out the answers a person skipped, and carries the test conversation and the remark only when asked from the test', () => {
    const s = afterRounds(1, { testId: 'persona', note: '  too polite  ' });
    s.rounds[0].answers = [{ question: 'q1', picked: [], other: '', text: '' }, { question: 'q2', picked: ['speed'], other: '', text: '' }];
    expect(toPersonaInput(s).rounds[0].answers.map((a) => a.question)).toEqual(['q2']);
    expect(toPersonaInput(s)).not.toHaveProperty('testId');
    expect(toPersonaInput(s, true)).toMatchObject({ testId: 'persona', note: 'too polite' });
    expect(toPersonaInput({ ...s, testId: null }, true)).not.toHaveProperty('testId');
  });

  it('says which persona is being adjusted, and what it is as it stands', () => {
    const s = startPersona(personaFormOf({ id: 'me', name: 'Me', job: 'J.', instructions: 'I.' }));
    expect(toPersonaInput({ ...s, request: 'blunter' })).toMatchObject({ mode: 'adjust', from: 'me', base: { draft: { name: 'Me', job: 'J.', instructions: 'I.' } } });
  });

  it('saves the draft as three texts, updating the one saved before, and as a copy of the persona when adjusting', () => {
    expect(toPersonaDraftInput({ ...startPersona(), draft })).toEqual({ draft });
    expect(toPersonaDraftInput({ ...startPersona(), draft, testId: 'persona' })).toEqual({ id: 'persona', draft });
    const adjusting = startPersona(personaFormOf({ id: 'me', name: 'Me', job: 'J.', instructions: 'I.' }));
    expect(toPersonaDraftInput({ ...adjusting, testId: 'me-draft' })).toMatchObject({ id: 'me-draft', from: 'me' });
    expect(JSON.stringify(toPersonaDraftInput({ ...startPersona(), draft }))).not.toMatch(/permission|tracker|shell|settings|stages/);
  });

  it('finishes the draft it names, as a copy of the persona when adjusting', () => {
    expect(toFinishInput(startPersona(), 'persona')).toEqual({ id: 'persona' });
    expect(toFinishInput(startPersona(personaFormOf({ id: 'me', name: 'Me', job: '', instructions: '' })), 'me-draft')).toEqual({ id: 'me-draft', from: 'me' });
  });
});

describe('closing', () => {
  it('loses nothing when nothing was done, and something once a round is answered or a draft is saved for the test', () => {
    expect(hasProgress(startPersona())).toBe(false);
    expect(hasProgress(afterRounds(1))).toBe(true);
    expect(hasProgress(afterRounds(0, { testId: 'persona' }))).toBe(true);
    const unanswered = withRound(startPersona(), { questions: [open('q1')], draft, enough: false });
    expect(hasProgress(unanswered)).toBe(false);
    const answered = { ...unanswered, open: withAnswer(unanswered.open as AssistRound, { question: 'q1', picked: [], other: '', text: 'fast' }) };
    expect(hasProgress(answered)).toBe(true);
  });

  it('counts edits of the texts of a persona being adjusted as something to lose, and nothing for one being made', () => {
    const s = startPersona(personaFormOf({ id: 'me', name: 'Me', job: 'J.', instructions: 'I.' }));
    expect(draftChanged(s)).toBe(false);
    expect(draftChanged({ ...s, draft: { ...s.draft, instructions: ' I. ' } })).toBe(false);
    expect(draftChanged({ ...s, draft: { ...s.draft, instructions: 'Newer.' } })).toBe(true);
    expect(draftChanged({ ...startPersona(), draft })).toBe(false);
  });
});
