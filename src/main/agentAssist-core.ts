import {
  ASSIST_LIMITS,
  clampSettings,
  readAssistDraft,
  readQuestions,
  type AssistAnswer,
  type AssistDraft,
  type AssistMode,
  type AssistOffers,
  type AssistQuestion,
  type AssistReasons,
  type AssistRound,
  type AssistSettings,
} from '../shared/agentAssist';
import type { ForumMessage } from '../shared/forum';
import { ID } from '../shared/config/schema';
import { squadsOf } from '../shared/config/squads';
import { isDraft, newAgent, slugOf, uniqueId, workingTeam } from '../shared/config/team';
import { AGENT_PERMISSIONS, type AgentDef, type AgentToolsConfig, type StageDef, type WorkspaceConfig } from '../shared/config/types';
import { isFlowCycle, isWork } from '../shared/runs/flow';
import { prompt as cp, text as word } from './cyclePrompts';
import { redact } from './errorlog-core';
import { fence, threadText } from './runner/prompt';

// The pure part of the agent assistant in the main process: what the model is told about the workspace, and the prompts of the two questions it is asked (a round of
// questions, and the review of the settings). Nothing here calls a model or touches the disk; the module that does is `agentAssist.ts`.

// ---- what exists --------------------------------------------------------------------------------------------------------------------------------

/** What the model is told exists, and so the only ids it may use: the stages, the squads and the agents of the team that take part in the cycle. */
export interface AssistContext {
  stages: { id: string; label: string }[];
  squads: { id: string; name: string; mission: string }[];
  agents: { id: string; name: string; job: string }[];
  /** A sandbox works on this computer. */
  sandbox: boolean;
  /** The tools every agent has unless it has its own set. */
  tools: AgentToolsConfig;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const shown = (value: string): string => clip(word(value).trim(), ASSIST_LIMITS.contextText);

/**
 * The work stages an agent can be given: those of the workspace's flow and those of the flow of each squad. A cycle that only classifies cards for the ceremonies
 * has no flow, so no stage is offered. A gate and a wait are not work.
 */
function workStages(config: WorkspaceConfig): StageDef[] {
  if (!isFlowCycle(config.devCycle.stages)) return [];
  const squads = new Set(squadsOf(config).map((s) => s.id));
  const own = Object.entries(config.devCycle.flows ?? {}).filter(([key]) => squads.has(key)).flatMap(([, flow]) => flow);
  const seen = new Set<string>();
  return [...config.devCycle.stages, ...own].filter((s) => isWork(s) && !seen.has(s.id) && !!seen.add(s.id));
}

/**
 * The context of the workspace for a question to the model. A draft is not in it: it takes no part in the cycle, and a model must not point at one. When an agent is
 * being adjusted, `selfId` leaves it out of the agents it could turn to.
 */
export function assistContext(config: WorkspaceConfig, sandbox: boolean, selfId: string | null = null): AssistContext {
  return {
    stages: workStages(config).slice(0, ASSIST_LIMITS.contextStages).map((s) => ({ id: s.id, label: shown(s.label) || s.id })),
    squads: squadsOf(config).slice(0, ASSIST_LIMITS.contextSquads).map((s) => ({ id: s.id, name: shown(s.name) || s.id, mission: shown(s.mission) })),
    agents: workingTeam(config.agents.team)
      .filter((a) => a.id !== selfId)
      .slice(0, ASSIST_LIMITS.contextAgents)
      .map((a) => ({ id: a.id, name: shown(a.name) || a.id, job: shown(a.job) })),
    sandbox,
    tools: { ...config.agents.tools },
  };
}

/** The values a model may pick, from the same lists it was told about, so what it was shown and what is accepted cannot drift apart. */
export const offersOf = (c: AssistContext): AssistOffers => ({
  sandbox: c.sandbox,
  permission: [...AGENT_PERMISSIONS],
  stages: c.stages.map((s) => s.id),
  squads: c.squads.map((s) => s.id),
  turnsTo: c.agents.map((a) => a.id),
  workspaceTools: c.tools,
});

// ---- the prompts --------------------------------------------------------------------------------------------------------------------------------

/** What a question to the model is made of. The rounds are the ones already answered; `original` is the agent as it is, when one is being adjusted. */
export interface AssistPromptInput {
  mode: AssistMode;
  request: string;
  rounds: AssistRound[];
  draft: AssistDraft;
  original: { draft: AssistDraft; settings: AssistSettings } | null;
  /** The conversation of the test, already cut to the last messages. */
  test: string;
  /** What the person says about the test. */
  note: string;
}

/** The system text of both questions. */
export const assistSystem = (): string => cp('assist.system');

const hasDraft = (d: AssistDraft): boolean => !!(d.name || d.job || d.instructions);

/** What one question got: the options picked, the text of "Other", the free text; or that the person skipped it. */
function answerText(answer: AssistAnswer | undefined): string {
  if (!answer || (!answer.picked.length && !answer.other.trim() && !answer.text.trim())) return cp('assist.section.skipped');
  return [answer.picked.join('; '), answer.other.trim() ? cp('assist.section.other', { text: answer.other.trim() }) : '', answer.text.trim()].filter(Boolean).join('; ');
}

function roundsText(rounds: AssistRound[]): string {
  return rounds
    .map((round, i) =>
      [
        cp('assist.section.roundTitle', { n: i + 1 }),
        ...round.questions.map((q) => `${q.id} [${q.kind}] ${q.text}\n  ${cp('assist.section.answer', { text: answerText(round.answers.find((a) => a.question === q.id)) })}`),
      ].join('\n'),
    )
    .join('\n');
}

const draftParts = (d: AssistDraft) => ({ name: fence(d.name), job: fence(d.job), instructions: fence(d.instructions) });

const list = (items: string[]): string => (items.length ? items.join('\n') : cp('assist.section.none'));

/** The parts both prompts share. A part with nothing to say is empty, and its line leaves the prompt. */
function common(input: AssistPromptInput, context: AssistContext) {
  return {
    task: input.mode === 'adjust' ? cp('assist.task.adjust') : cp('assist.task.create'),
    request: cp('assist.section.request', { text: fence(input.request) }),
    answers: input.rounds.length ? cp('assist.section.rounds', { text: fence(roundsText(input.rounds)) }) : '',
    draft: hasDraft(input.draft) ? cp('assist.section.draft', draftParts(input.draft)) : '',
    original: input.original ? cp('assist.section.original', { ...draftParts(input.original.draft), settings: JSON.stringify(input.original.settings) }) : '',
    test: [input.test ? cp('assist.section.test', { text: fence(input.test) }) : '', input.note ? cp('assist.section.note', { text: fence(input.note) }) : ''].filter(Boolean).join('\n'),
    context: cp('assist.section.context', {
      stages: list(context.stages.map((s) => `- ${s.id}: ${fence(s.label)}`)),
      squads: list(context.squads.map((s) => `- ${s.id}: ${fence(s.name)}${s.mission ? `, ${fence(s.mission)}` : ''}`)),
      agents: list(context.agents.map((a) => `- ${a.id}: ${fence(a.name)}${a.job ? `, ${fence(a.job)}` : ''}`)),
    }),
  };
}

/** The question that asks for the next round of questions and a refined draft. The round is the one after the rounds already answered. */
export function roundPrompt(input: AssistPromptInput, context: AssistContext): string {
  const round = input.rounds.length + 1;
  return cp('assist.round', {
    ...common(input, context),
    round,
    rounds: ASSIST_LIMITS.rounds,
    left: Math.max(0, ASSIST_LIMITS.rounds - round),
    min: ASSIST_LIMITS.minQuestions,
    max: ASSIST_LIMITS.questions,
    options: ASSIST_LIMITS.options,
  });
}

/** The question that asks for the finished draft and the settings, each above the minimum with its reason. */
export function reviewPrompt(input: AssistPromptInput, context: AssistContext): string {
  const { files, skills, vcsCli, subagents } = context.tools;
  return cp('assist.review', {
    ...common(input, context),
    machine: context.sandbox ? cp('assist.section.machine.sandbox') : cp('assist.section.machine.noSandbox'),
    tools: cp('assist.section.tools', { tools: JSON.stringify({ files, skills, vcsCli, subagents }) }),
  });
}

// ---- what comes in from the screen --------------------------------------------------------------------------------------------------------------
// Read without trust and cut to the limits again: the screen respects them, and a window that does not must not make a question larger than a person could.

export interface AssistInput {
  mode: AssistMode;
  /** The agent being adjusted (an id of the stored team); null when creating. */
  from: string | null;
  request: string;
  /** The rounds answered so far. One more than the limit is kept, so a caller can see that a round was asked for past the last. */
  rounds: AssistRound[];
  draft: AssistDraft;
  /** The agent as the form holds it, when adjusting: its texts and its settings, to be held to the stored agent. */
  form: { draft: AssistDraft; settings: unknown } | null;
  /** The draft agent whose test conversation the model reads. */
  testId: string | null;
  note: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cut = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '');
const ID_RE = new RegExp(ID);
const idOf = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const EMPTY_DRAFT: AssistDraft = { name: '', job: '', instructions: '' };

function readAnswers(raw: unknown): AssistAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, ASSIST_LIMITS.answersPerRound).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.question !== 'string') return [];
    const picked = Array.isArray(entry.picked) ? entry.picked.map((p) => cut(p, ASSIST_LIMITS.option)).filter(Boolean).slice(0, ASSIST_LIMITS.options) : [];
    return [{ question: cut(entry.question, 8), picked, other: cut(entry.other, ASSIST_LIMITS.answer), text: cut(entry.text, ASSIST_LIMITS.answer) }];
  });
}

function readRounds(raw: unknown): AssistRound[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, ASSIST_LIMITS.rounds + 1).flatMap((entry) => (isRecord(entry) ? [{ questions: readQuestions(entry.questions), answers: readAnswers(entry.answers) }] : []));
}

/** The question the screen sent, held to the limits; anything out of shape reads as empty or absent. Never throws. */
export function readAssistInput(raw: unknown): AssistInput {
  const r = isRecord(raw) ? raw : {};
  const form = isRecord(r.base) ? { draft: readAssistDraft(r.base.draft), settings: r.base.settings } : null;
  return {
    mode: r.mode === 'adjust' ? 'adjust' : 'create',
    from: idOf(r.from),
    request: cut(r.request, ASSIST_LIMITS.request),
    rounds: readRounds(r.rounds),
    draft: readAssistDraft(r.draft, EMPTY_DRAFT),
    form,
    testId: idOf(r.testId),
    note: cut(r.note, ASSIST_LIMITS.note),
  };
}

/** The test conversation as the model reads it: the last messages, cut to the characters allowed, oldest first. */
export function testConversation(messages: ForumMessage[]): string {
  const text = threadText(messages.filter((m) => m.kind !== 'system').slice(-ASSIST_LIMITS.testMessages));
  return text.length > ASSIST_LIMITS.testChars ? `…${text.slice(-ASSIST_LIMITS.testChars)}` : text;
}

// ---- the agent being adjusted -------------------------------------------------------------------------------------------------------------------

/** The settings an agent has, in the shape the assistant works with. */
export const settingsOf = (a: AgentDef): AssistSettings => ({ permission: a.permission, tracker: a.tracker, shell: a.shell, tools: a.tools ? { ...a.tools } : null, stages: [...a.stages], squad: a.squad ?? null, turnsTo: a.turnsTo });

/** The texts of an agent as a person reads them (a template agent holds catalog keys for them). */
export const draftOfAgent = (a: AgentDef): AssistDraft => ({ name: word(a.name), job: word(a.job), instructions: word(a.instructions) });

/** The agent of the stored team that can be adjusted: one the person made. A system agent and a draft are not. */
export const adjustable = (config: WorkspaceConfig, id: string | null): AgentDef | null => {
  const found = id ? config.agents.team.find((a) => a.id === id) : undefined;
  return found && !found.system && !isDraft(found) ? found : null;
};

// ---- what the model answers ---------------------------------------------------------------------------------------------------------------------
// What a model says passes through `redact` before it reaches the screen: it may repeat a secret the person pasted into the request.

export interface RoundAnswer {
  questions: AssistQuestion[];
  draft: AssistDraft;
  enough: boolean;
}

/** The round of the answer, or null when the answer is not an object at all (nothing to read). A round with no valid question is a round: the screen says so. */
export function readRoundAnswer(raw: unknown, previous: AssistDraft): RoundAnswer | null {
  if (!isRecord(raw)) return null;
  return { questions: readQuestions(raw.questions, redact), draft: readAssistDraft(raw.draft, previous, redact), enough: raw.enough === true };
}

export interface ReviewAnswer {
  draft: AssistDraft;
  settings: AssistSettings;
  reasons: AssistReasons;
}

/** The review of the answer: the draft and the settings held to what exists, each above the base with its reason. Null when the answer is not an object, or says nothing. */
export function readReviewAnswer(raw: unknown, offers: AssistOffers, base: AssistSettings, previous: AssistDraft): ReviewAnswer | null {
  if (!isRecord(raw)) return null;
  const draft = readAssistDraft(raw.draft, previous, redact);
  if (!draft.name && !draft.job && !draft.instructions) return null;
  return { draft, ...clampSettings(raw, offers, base, { scrub: redact }) };
}

// ---- the draft agent ----------------------------------------------------------------------------------------------------------------------------

/** The id of a draft: the name, or the original with `-draft` when an agent is being adjusted, and free among `taken` (the team, the system ids and every direct conversation). */
export const draftIdFor = (name: string, from: string | null, taken: Iterable<string>): string => uniqueId(from ? `${from.slice(0, 40)}-draft` : slugOf(name) || 'agent', taken);

/**
 * The agent saved to be tried out, and inert by construction: no stage, no squad, not autonomous, turning to the person, marked as a draft. The permissions it is tested
 * with are the ones proposed (the settings, already held to what exists); an agent being adjusted brings its model and its always-allowed commands from the stored original
 * (a model never decides them), so the test has the permissions the agent will have.
 */
export function draftAgent(id: string, name: string, draft: AssistDraft, settings: AssistSettings, original: AgentDef | null): AgentDef {
  return newAgent({
    id,
    name,
    job: draft.job,
    instructions: draft.instructions,
    ...(original ? { model: original.model, allowedCommands: original.allowedCommands } : {}),
    permission: settings.permission,
    tracker: settings.tracker,
    shell: settings.shell,
    ...(settings.tools ? { tools: settings.tools } : {}),
    stages: [],
    autonomous: false,
    turnsTo: null,
    draft: true,
    system: false,
  });
}
