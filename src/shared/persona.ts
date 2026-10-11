import { ASSIST_LIMITS, readAssistDraft, type AssistDraft, type Scrub } from './agentAssist';
import type { AgentDef } from './config/types';

// The persona: the chat and its wizard, shared by the main process and the renderer. The wire of an answer being written, and what the wizard reads and starts from. No Electron, no DOM.
// The text of an answer reaches every device as events of this shape, and a read (`persona:live-read`) gives a device that joined late, or lost an event, the text so far.
// The live text is never a message of its own: the answer is stored once, whole, by the pipeline that answers, and replaces the bubble by arriving.

/** The module event that carries the text of an answer being written, to the window and to every paired browser. */
export const PERSONA_LIVE_EVENT = 'persona:live';

/** The read that gives the text so far of every answer being written in a thread. */
export const PERSONA_LIVE_READ = 'persona:live-read';

/**
 * One step of the text being written. `to` is the `seq` of the message of the person it answers (the pair thread and `to` is one answer). `rev` counts the events of the
 * answer from 1. `offset` is where `text` goes in the text so far: 0 replaces it (the first event, a restart, a rewrite by the masking), anything else appends.
 */
export interface LiveEvent {
  thread: string;
  to: number;
  agent: string;
  rev: number;
  offset: number;
  text: string;
  /** The answer is over (posted, stopped or failed): the bubble goes. */
  end?: true;
}

/** The text of an answer as a device holds it, at a revision. */
export interface LiveAnswer {
  thread: string;
  to: number;
  agent: string;
  rev: number;
  text: string;
}

/**
 * The client's assembly of one answer. `resync`: the event cannot be placed (the device joined in the middle, or missed one), so the caller reads the text so far.
 * The state is the answer of one pair (thread, `to`); the caller picks it by that key.
 */
export function applyLive(state: LiveAnswer | null, e: LiveEvent): { state: LiveAnswer | null; resync: boolean } {
  if (e.end) return { state: null, resync: false };
  // A replacement carries the whole text: it needs nothing before it.
  if (e.offset === 0) {
    if (state && e.rev <= state.rev) return { state, resync: false };
    return { state: { thread: e.thread, to: e.to, agent: e.agent, rev: e.rev, text: e.text }, resync: false };
  }
  if (!state) return { state: null, resync: true };
  if (e.rev <= state.rev) return { state, resync: false };
  if (e.rev !== state.rev + 1 || e.offset !== state.text.length) return { state, resync: true };
  return { state: { ...state, rev: e.rev, text: state.text + e.text }, resync: false };
}

/** The answer a read gave, taken in only if it is newer than what the device holds. */
export function applyRead(state: LiveAnswer | null, read: LiveAnswer): LiveAnswer {
  return state && state.rev >= read.rev ? state : read;
}

// ---- the wizard that makes the persona --------------------------------------------------------------------------------------------------------------

/** The limits of the persona's texts: the editor's and the wizard's are the creator's, so what the wizard writes can always be saved. */
export const PERSONA_LIMITS = ASSIST_LIMITS;

/**
 * What the persona starts with, set by the app and never by the model or the screen: the access of a reading agent. It is out of the cycle (no stage, not autonomous,
 * turning to the person), reads the tracker, runs no command, and has the workspace's tools and no screen, hosts or browser profile.
 */
export function personaAccess(): Pick<AgentDef, 'permission' | 'tracker' | 'shell' | 'autonomous' | 'turnsTo' | 'stages' | 'model'> {
  return { permission: 'read', tracker: 'read', shell: 'none', autonomous: false, turnsTo: null, stages: [], model: { role: 'deep', provider: '', model: '' } };
}

/** The fields a finished persona is made to hold, as a patch: the access above (the model apart), and nothing that gives it a screen, hosts, tools or commands of its own. */
export function personaAccessPatch(): Partial<AgentDef> {
  const { model: _model, ...access } = personaAccess();
  return { ...access, squad: undefined, tools: undefined, allowedCommands: undefined, screen: undefined, allowedHosts: undefined, browserProfile: undefined };
}

/** The four themes the questions cover, in the order the instructions take their headings. */
export const PERSONA_THEMES = ['who', 'decide', 'matters', 'never'] as const;
export type PersonaTheme = (typeof PERSONA_THEMES)[number];

/** The headings of the persona's instructions, in English (the instructions always are): one per theme, in this order. */
export const PERSONA_HEADINGS = ['## Who the person is', '## How they decide', '## What matters to them', '## What they never want done'] as const;

/** The review of the wizard: the three texts and nothing else. A model that proposed a setting has no field to put it in. */
export interface PersonaReview {
  draft: AssistDraft;
}

type Schema = Record<string, unknown>;
const text = { type: 'string' };

/** What the model answers on the review: the finished draft. No setting, no reason. */
export const PERSONA_REVIEW_SCHEMA: Schema = {
  type: 'object',
  properties: { draft: { type: 'object', properties: { name: text, job: text, instructions: text }, required: ['name', 'job', 'instructions'], additionalProperties: false } },
  required: ['draft'],
  additionalProperties: false,
};

/** The review of an answer: the draft held to the limits, or null when the answer is not an object or says nothing. */
export function readPersonaReview(raw: unknown, previous: AssistDraft, scrub?: Scrub): PersonaReview | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const draft = readAssistDraft((raw as Record<string, unknown>).draft, previous, scrub);
  return draft.name || draft.job || draft.instructions ? { draft } : null;
}
