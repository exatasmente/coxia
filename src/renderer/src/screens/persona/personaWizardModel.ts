import { ASSIST_LIMITS, type AssistDraft, type AssistMode, type AssistRound } from '../../../../shared/agentAssist';
import type { AgentDef } from '../../../../shared/config/types';
import { cut, cutRound } from '../team/assistEdit';
import { shown } from '../team/text';

// The persona's wizard, as pure functions: what its screen holds between two answers of the model, and what the channels are sent. The rounds, the answers and the limits are
// the agent assistant's own (assistEdit.ts); what is the persona's is that nothing here is a setting: the wizard carries three texts and the answers, and the main process
// gives the persona the access it starts with. Nothing here calls the model or the main process.

export type PersonaStep = 'request' | 'questions' | 'review' | 'test';

/** The persona being adjusted, as the wizard opens on it: its id and its three texts as a person reads them. */
export interface PersonaForm {
  id: string;
  draft: AssistDraft;
}

export interface PersonaState {
  /** Told apart from a wizard opened later: the answer of a model is applied only to the wizard that asked. */
  session: number;
  mode: AssistMode;
  /** The persona being adjusted; null when making the first. */
  base: PersonaForm | null;
  step: PersonaStep;
  request: string;
  /** The rounds the person answered, in order. */
  rounds: AssistRound[];
  /** The round on screen, not answered yet. */
  open: AssistRound | null;
  draft: AssistDraft;
  /** The model says it has nothing important left to ask. */
  enough: boolean;
  /** The id of the draft persona saved to be tried out; null until the person tests. */
  testId: string | null;
  /** What the person saw wrong in the test, carried to the round that comes from it. */
  note: string;
}

let sessions = 0;

/** The three texts of the persona as a person reads them (a literal, or a catalog key of a template the person kept). */
export const personaFormOf = (persona: Pick<AgentDef, 'id' | 'name' | 'job' | 'instructions'>): PersonaForm => ({
  id: persona.id,
  draft: { name: shown(persona.name), job: shown(persona.job), instructions: shown(persona.instructions) },
});

/** A new wizard: to make the first persona, or (with the form of the one there is) to adjust it. */
export function startPersona(base: PersonaForm | null = null): PersonaState {
  return {
    session: ++sessions,
    mode: base ? 'adjust' : 'create',
    base: base ? { id: base.id, draft: { ...base.draft } } : null,
    step: 'request',
    request: '',
    rounds: [],
    open: null,
    draft: base ? { ...base.draft } : { name: '', job: '', instructions: '' },
    enough: false,
    testId: null,
    note: '',
  };
}

export const cutDraft = (d: AssistDraft): AssistDraft => ({ name: cut(d.name, ASSIST_LIMITS.name), job: cut(d.job, ASSIST_LIMITS.job), instructions: cut(d.instructions, ASSIST_LIMITS.instructions) });

/** What the review came back with: the three texts and nothing else. */
export interface PersonaReviewResult {
  draft: AssistDraft;
}

/** The state after the review came back. */
export const withPersonaReview = (state: PersonaState, result: PersonaReviewResult): PersonaState => ({ ...state, step: 'review', open: null, draft: result.draft });

/** The question to `persona:round` and `persona:review`; the main process reads it without trust and cuts it to the same limits. */
export interface PersonaChannelInput {
  mode: AssistMode;
  from?: string;
  request: string;
  rounds: AssistRound[];
  draft: AssistDraft;
  /** The persona as it is, when adjusting. */
  base?: { draft: AssistDraft };
  testId?: string;
  note?: string;
}

/**
 * What a question to the model carries: the request, the rounds answered, the draft as it is and, when adjusting, the persona as it is. The round on screen is not in it
 * (`closeRound` first). With `fromTest` it also carries the draft persona whose conversation the model should read, and the person's remark about it.
 */
export function toPersonaInput(state: PersonaState, fromTest = false): PersonaChannelInput {
  return {
    mode: state.mode,
    ...(state.base ? { from: state.base.id, base: { draft: cutDraft(state.base.draft) } } : {}),
    request: cut(state.request, ASSIST_LIMITS.request),
    rounds: state.rounds.slice(0, ASSIST_LIMITS.rounds).map(cutRound),
    draft: cutDraft(state.draft),
    ...(fromTest && state.testId ? { testId: state.testId, note: cut(state.note, ASSIST_LIMITS.note) } : {}),
  };
}

/** What `persona:saveDraft` is sent: the texts and which persona this is a copy of, when adjusting. No setting: the main process gives the persona its access. */
export interface PersonaDraftInput {
  /** The draft persona saved before, to be updated. */
  id?: string;
  from?: string;
  draft: AssistDraft;
}

export const toPersonaDraftInput = (state: PersonaState): PersonaDraftInput => ({
  ...(state.testId ? { id: state.testId } : {}),
  ...(state.base ? { from: state.base.id } : {}),
  draft: cutDraft(state.draft),
});

/** What `persona:finish` is sent: the draft to finish, and the persona it adjusts when it is a copy. */
export const toFinishInput = (state: PersonaState, id: string): { id: string; from?: string } => ({ id, ...(state.base ? { from: state.base.id } : {}) });

/** Whether the person changed any of the three texts from what the persona had: nothing to say about a wizard that made nothing yet. */
export const draftChanged = (state: Pick<PersonaState, 'base' | 'draft'>): boolean => !!state.base && (['name', 'job', 'instructions'] as const).some((f) => state.base?.draft[f].trim() !== state.draft[f].trim());
