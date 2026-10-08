import { ASSIST_LIMITS, type AssistAnswer, type AssistDraft, type AssistMode, type AssistOffers, type AssistRound, type AssistSettings } from '../shared/agentAssist';
import { squadsOf } from '../shared/config/squads';
import { workingTeam } from '../shared/config/team';
import { AGENT_PERMISSIONS, type AgentToolsConfig, type StageDef, type WorkspaceConfig } from '../shared/config/types';
import { isFlowCycle, isWork } from '../shared/runs/flow';
import { prompt as cp, text as word } from './cyclePrompts';
import { fence } from './runner/prompt';

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
