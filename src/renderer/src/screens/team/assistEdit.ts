import { ASSIST_FIELDS, ASSIST_LIMITS, MINIMUM_SETTINGS, isAboveMinimum, isSkipped, type AssistAnswer, type AssistDraft, type AssistField, type AssistMode, type AssistQuestion, type AssistReasons, type AssistRound, type AssistSettings } from '../../../../shared/agentAssist';
import { slugOf, uniqueId } from '../../../../shared/config/team';
import type { AgentToolsConfig } from '../../../../shared/config/types';
import { blankAgent, shellAfterPermission, type AgentDraft } from './agentEdit';
import { shown } from './text';

// The agent assistant, as pure functions: what its screen holds between two answers of the model, and how that becomes what the channels are sent and the form the
// editor opens. Nothing here calls a model or the main process; the screen (AgentAssist.tsx) does, and keeps this state above the panels so closing the editor it
// opens does not lose it.

export type AssistStep = 'request' | 'questions' | 'review' | 'test';

export interface AssistState {
  /** Told apart from an assistant opened later: the answer of a model is applied only to the assistant that asked. */
  session: number;
  mode: AssistMode;
  /** The agent being adjusted, as the form held it when the assistant opened; null when creating. */
  base: AgentDraft | null;
  step: AssistStep;
  request: string;
  /** The rounds the person answered, in order. */
  rounds: AssistRound[];
  /** The round on screen, not answered yet. */
  open: AssistRound | null;
  draft: AssistDraft;
  settings: AssistSettings;
  /** Why the model proposed each value above the minimum. */
  reasons: AssistReasons;
  /** The model says it has nothing important left to ask. */
  enough: boolean;
  /** The id of the draft agent saved to be tried out; null until the person tests. */
  testId: string | null;
  /** What the person saw wrong in the test, carried to the round that comes from it. */
  note: string;
}

let sessions = 0;

const copyTools = (t: AgentToolsConfig | null): AgentToolsConfig | null => (t ? { ...t } : null);

/** The settings a form holds, in the shape the assistant works with. */
export const settingsOfDraft = (d: AgentDraft): AssistSettings => ({ permission: d.permission, tracker: d.tracker, shell: d.shell, tools: copyTools(d.tools), stages: [...d.stages], squad: d.squad, turnsTo: d.turnsTo });

/** The three texts of a form as the person reads them (a template agent holds catalog keys for them). */
export const textsOfDraft = (d: AgentDraft): AssistDraft => ({ name: shown(d.name), job: shown(d.job), instructions: shown(d.instructions) });

const copySettings = (s: AssistSettings): AssistSettings => ({ ...s, tools: copyTools(s.tools), stages: [...s.stages] });

/** A new assistant: to create an agent, or (with the form of one) to adjust it. */
export function startAssist(base: AgentDraft | null = null): AssistState {
  return {
    session: ++sessions,
    mode: base ? 'adjust' : 'create',
    base: base ? { ...base, model: { ...base.model }, allowedCommands: [...base.allowedCommands], tools: copyTools(base.tools), stages: [...base.stages] } : null,
    step: 'request',
    request: '',
    rounds: [],
    open: null,
    draft: base ? textsOfDraft(base) : { name: '', job: '', instructions: '' },
    settings: base ? settingsOfDraft(base) : copySettings(MINIMUM_SETTINGS),
    reasons: {},
    enough: false,
    testId: null,
    note: '',
  };
}

/** Where a setting starts and goes back to: the minimum of a new agent, or the agent as it was when it is being adjusted. */
export const floorOf = (state: Pick<AssistState, 'base'>): AssistSettings => (state.base ? settingsOfDraft(state.base) : copySettings(MINIMUM_SETTINGS));

// ---- the answers --------------------------------------------------------------------------------------------------------------------------------

/** The answer given to a question; a question with no answer in the round is one the person skipped, and an empty answer stands for it. */
export const answerOf = (round: AssistRound, question: string): AssistAnswer => round.answers.find((a) => a.question === question) ?? { question, picked: [], other: '', text: '' };

/** The round with this answer in it. An answer left empty is a skipped question and is not kept, so the model is told it was skipped rather than given nothing. */
export function withAnswer(round: AssistRound, answer: AssistAnswer): AssistRound {
  const kept: AssistAnswer = {
    question: answer.question,
    picked: answer.picked.slice(0, ASSIST_LIMITS.options),
    other: answer.other.slice(0, ASSIST_LIMITS.answer),
    text: answer.text.slice(0, ASSIST_LIMITS.answer),
  };
  const others = round.answers.filter((a) => a.question !== answer.question);
  if (isSkipped(kept)) return { ...round, answers: others };
  // Kept in the order of the questions, whatever order the person answered in.
  const order = new Map(round.questions.map((q, i) => [q.id, i]));
  return { ...round, answers: [...others, kept].sort((a, b) => (order.get(a.question) ?? 99) - (order.get(b.question) ?? 99)) };
}

/** The answer after the person picks an option: a single choice holds one (and drops the text of "Other"), a multiple choice toggles it, in the order the options were offered. */
export function pickOption(answer: AssistAnswer, question: AssistQuestion, option: string): AssistAnswer {
  if (question.kind === 'single') return { ...answer, picked: [option], other: '' };
  const on = answer.picked.includes(option);
  const picked = question.options.filter((o) => (o === option ? !on : answer.picked.includes(o)));
  return { ...answer, picked };
}

/** The answer after the text of "Other" changes. A single choice then holds nothing else: "Other" is the choice. */
export const withOther = (answer: AssistAnswer, question: AssistQuestion, other: string): AssistAnswer => ({ ...answer, other, picked: question.kind === 'single' ? [] : answer.picked });

export const withText = (answer: AssistAnswer, text: string): AssistAnswer => ({ ...answer, text });

/** How many of the round's questions the person answered. */
export const answeredCount = (round: AssistRound): number => round.answers.filter((a) => !isSkipped(a)).length;

// ---- the rounds ---------------------------------------------------------------------------------------------------------------------------------

/** The number of the round on screen (or of the next one, with none open). */
export const roundNumber = (state: Pick<AssistState, 'rounds' | 'open'>): number => state.rounds.length + 1;

/** The rounds that can still be asked after the one on screen. The fifth does not exist; the round that comes from a test is one of the four like any other. */
export const roundsLeft = (state: Pick<AssistState, 'rounds' | 'open'>): number => Math.max(0, ASSIST_LIMITS.rounds - state.rounds.length - (state.open ? 1 : 0));

/** Whether "next round" is offered: there is one left to ask and the model has not said it has nothing more to ask. */
export const canAskAnotherRound = (state: Pick<AssistState, 'rounds' | 'open' | 'enough'>): boolean => !state.enough && roundsLeft(state) > 0;

/** The round on screen moves to the answered ones. A round with no question (nothing usable came) is not a round the person answered and is not kept. */
export function closeRound(state: AssistState): AssistState {
  if (!state.open) return state;
  return { ...state, rounds: state.open.questions.length ? [...state.rounds, state.open] : state.rounds, open: null };
}

/** Whether closing the assistant would lose something: an answered round, an answer on the round on screen, or a draft agent saved for the test. */
export const hasProgress = (state: AssistState): boolean => state.rounds.length > 0 || (state.open !== null && answeredCount(state.open) > 0) || state.testId !== null;

export interface RoundResult {
  questions: AssistQuestion[];
  draft: AssistDraft;
  enough: boolean;
}

/** The state after a round came back: its questions are on screen, unanswered, and the preview is the draft it wrote. */
export const withRound = (state: AssistState, result: RoundResult): AssistState => ({ ...state, step: 'questions', open: { questions: result.questions, answers: [] }, draft: result.draft, enough: result.enough, note: '' });

export interface ReviewResult {
  draft: AssistDraft;
  settings: AssistSettings;
  reasons: AssistReasons;
}

/** The state after the review came back. */
export const withReview = (state: AssistState, result: ReviewResult): AssistState => ({ ...state, step: 'review', open: null, draft: result.draft, settings: copySettings(result.settings), reasons: { ...result.reasons } });

// ---- what the channels are sent -----------------------------------------------------------------------------------------------------------------

/** The question to `agentAssist:round` and `agentAssist:review`; the main process reads it without trust and cuts it to the same limits. */
export interface AssistChannelInput {
  mode: AssistMode;
  from?: string;
  request: string;
  rounds: AssistRound[];
  draft: AssistDraft;
  /** The agent as the form holds it, when adjusting. */
  base?: { draft: AssistDraft; settings: AssistSettings };
  testId?: string;
  note?: string;
}

const cut = (text: string, max: number): string => text.trim().slice(0, max).trim();

export const cutDraft = (d: AssistDraft): AssistDraft => ({ name: cut(d.name, ASSIST_LIMITS.name), job: cut(d.job, ASSIST_LIMITS.job), instructions: cut(d.instructions, ASSIST_LIMITS.instructions) });

function cutRound(round: AssistRound): AssistRound {
  return {
    questions: round.questions,
    answers: round.answers
      .filter((a) => !isSkipped(a))
      .slice(0, ASSIST_LIMITS.answersPerRound)
      .map((a) => ({ question: a.question, picked: a.picked.slice(0, ASSIST_LIMITS.options), other: cut(a.other, ASSIST_LIMITS.answer), text: cut(a.text, ASSIST_LIMITS.answer) })),
  };
}

/**
 * What a question to the model carries: the request, the rounds answered, the draft as it is and, when adjusting, the agent as the form held it. The round on screen is
 * not in it (`closeRound` first). With `fromTest` it also carries the draft agent whose conversation the model should read, and the person's remark about it.
 */
export function toInput(state: AssistState, fromTest = false): AssistChannelInput {
  return {
    mode: state.mode,
    ...(state.base ? { from: state.base.id, base: { draft: cutDraft(textsOfDraft(state.base)), settings: settingsOfDraft(state.base) } } : {}),
    request: cut(state.request, ASSIST_LIMITS.request),
    rounds: state.rounds.slice(0, ASSIST_LIMITS.rounds).map(cutRound),
    draft: cutDraft(state.draft),
    ...(fromTest && state.testId ? { testId: state.testId, note: cut(state.note, ASSIST_LIMITS.note) } : {}),
  };
}

/** What `agentAssist:saveDraft` is sent: the texts and the values of the settings, without the reasons. The main process builds the draft agent from them and holds them to what exists. */
export function toDraftInput(state: AssistState): { id?: string; from?: string; draft: AssistDraft; settings: AssistSettings } {
  return {
    ...(state.testId ? { id: state.testId } : {}),
    ...(state.base ? { from: state.base.id } : {}),
    draft: cutDraft(state.draft),
    settings: copySettings(state.settings),
  };
}

// ---- the review ---------------------------------------------------------------------------------------------------------------------------------

/** A setting that moved from where it started: the minimum, or (adjusting) the agent as it was. */
export type SettingChange = { [K in AssistField]: { field: K; before: AssistSettings[K]; value: AssistSettings[K]; reason: string } }[AssistField];

/** The settings that pass the minimum, each with the reason the model gave; adjusting, "above the minimum" is "different from the agent as it was". */
export function reviewRows(state: Pick<AssistState, 'base' | 'settings' | 'reasons'>): SettingChange[] {
  const floor = floorOf(state);
  return ASSIST_FIELDS.filter((field) => isAboveMinimum(field, state.settings, floor)).map((field) => ({ field, before: floor[field], value: state.settings[field], reason: state.reasons[field] ?? '' }) as SettingChange);
}

/** The setting back where it started: at the minimum of a new agent, or at the value the agent had when it is being adjusted. The reason goes with the value. */
export function resetField(state: AssistState, field: AssistField): AssistState {
  const floor = floorOf(state);
  const settings: AssistSettings = { ...state.settings, [field]: field === 'tools' ? copyTools(floor.tools) : field === 'stages' ? [...floor.stages] : floor[field] };
  // The editor drops `allowlist` when the permission stops writing; the same here, so a reset never leaves a combination it refuses.
  settings.shell = shellAfterPermission(settings.shell, settings.permission);
  const reasons: AssistReasons = { ...state.reasons };
  for (const f of ASSIST_FIELDS) if (!isAboveMinimum(f, settings, floor)) delete reasons[f];
  return { ...state, settings, reasons };
}

export interface TextChange {
  field: keyof AssistDraft;
  before: string;
  after: string;
}

/** What adjusting changed, before → after: the three texts and the settings. Nothing when creating (there is no "before"). */
export function diffAgent(state: AssistState): { texts: TextChange[]; settings: SettingChange[] } {
  if (!state.base) return { texts: [], settings: [] };
  const before = textsOfDraft(state.base);
  const texts = (['name', 'job', 'instructions'] as const).filter((field) => before[field].trim() !== state.draft[field].trim()).map((field) => ({ field, before: before[field], after: state.draft[field] }));
  return { texts, settings: reviewRows(state) };
}

/**
 * The form the editor opens on: the draft and the settings of the assistant over a blank agent, or (adjusting) over the form the person had, so what the assistant
 * did not touch stays as it was. The id of a new agent is the one of the draft agent saved for the test, which the editor then promotes; with none, it comes from the
 * name, free among `taken`.
 */
export function toAgentDraft(state: AssistState, taken: readonly string[] = []): AgentDraft {
  const own = state.base ?? blankAgent();
  return {
    ...own,
    id: state.base ? state.base.id : (state.testId ?? uniqueId(slugOf(state.draft.name), taken)),
    name: state.draft.name,
    job: state.draft.job,
    instructions: state.draft.instructions,
    model: { ...own.model },
    allowedCommands: [...own.allowedCommands],
    permission: state.settings.permission,
    tracker: state.settings.tracker,
    shell: state.settings.shell,
    tools: copyTools(state.settings.tools),
    stages: [...state.settings.stages],
    squad: state.settings.squad,
    turnsTo: state.settings.turnsTo,
  };
}
