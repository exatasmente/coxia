import type { AssistDraft, AssistMode, AssistRound } from '../../shared/agentAssist';
import { ASSIST_LIMITS } from '../../shared/agentAssist';
import { newAgent } from '../../shared/config/team';
import type { AgentDef } from '../../shared/config/types';
import { PERSONA_HEADINGS, personaAccess } from '../../shared/persona';
import { draftParts, roundsText } from '../agentAssist-core';
import { prompt as cp } from '../cyclePrompts';
import { fence } from '../runner/prompt';

// The pure part of the persona's wizard in the main process: the prompts of its two questions and the agent it saves. It reuses the creator's readers, limits and call; what
// is its own is what the model is told (the person, never a setting) and what it may answer (the three texts and nothing else). Nothing here calls a model or touches the disk.

/** What a question to the model is made of. `original` is the persona as it is, when one is being adjusted. */
export interface PersonaPromptInput {
  mode: AssistMode;
  request: string;
  rounds: AssistRound[];
  draft: AssistDraft;
  original: AssistDraft | null;
  /** The conversation of the test, already cut to the last messages. */
  test: string;
  /** What the person says about the test. */
  note: string;
}

/** The system text of both questions. */
export const personaSystem = (): string => cp('persona.system');

const hasDraft = (d: AssistDraft): boolean => !!(d.name || d.job || d.instructions);

/** The parts both prompts share. A part with nothing to say is empty, and its line leaves the prompt. */
function common(input: PersonaPromptInput) {
  return {
    task: input.mode === 'adjust' ? cp('persona.task.adjust') : cp('persona.task.create'),
    request: cp('persona.section.request', { text: fence(input.request) }),
    answers: input.rounds.length ? cp('assist.section.rounds', { text: fence(roundsText(input.rounds)) }) : '',
    draft: hasDraft(input.draft) ? cp('assist.section.draft', draftParts(input.draft)) : '',
    original: input.original ? cp('persona.section.original', draftParts(input.original)) : '',
    test: [input.test ? cp('assist.section.test', { text: fence(input.test) }) : '', input.note ? cp('assist.section.note', { text: fence(input.note) }) : ''].filter(Boolean).join('\n'),
  };
}

/** The four themes as words, in the workspace's language and in the order of the headings of the instructions. */
const themes = (): string => [cp('persona.theme.who'), cp('persona.theme.decide'), cp('persona.theme.matters'), cp('persona.theme.never')].join('; ');

/** The question that asks for the next round of questions and a refined draft. The round is the one after the rounds already answered. */
export function personaRoundPrompt(input: PersonaPromptInput): string {
  const round = input.rounds.length + 1;
  return cp('persona.round', {
    ...common(input),
    round,
    rounds: ASSIST_LIMITS.rounds,
    left: Math.max(0, ASSIST_LIMITS.rounds - round),
    min: ASSIST_LIMITS.minQuestions,
    max: ASSIST_LIMITS.questions,
    options: ASSIST_LIMITS.options,
    themes: themes(),
  });
}

/** The question that asks for the finished draft, whose instructions end with a heading per theme. */
export const personaReviewPrompt = (input: PersonaPromptInput): string => cp('persona.review', { ...common(input), headings: PERSONA_HEADINGS.join('\n') });

/**
 * The persona being tried out: a persona that is also a draft, inert by construction (no stage, no squad, not autonomous, turning to the person) and with the starting access
 * the app sets. A persona being adjusted keeps its model, read from the stored entry and never from the call.
 */
export function personaDraftAgent(id: string, name: string, draft: AssistDraft, original: AgentDef | null): AgentDef {
  const access = personaAccess();
  return newAgent({ ...access, ...(original ? { model: original.model } : {}), id, name, job: draft.job, instructions: draft.instructions, kind: 'persona', draft: true, system: false });
}
