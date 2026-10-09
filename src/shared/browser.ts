// What the renderer and the main process both know about an agent's screen and the app's browser: the constants of its sessions and the shapes that cross between the two. Pure
// types and constants; the behaviour is in `src/main/browser/`.

/** A screen with no answer running, no browser step, no pending ask and no input from the person closes after this long. */
export const SCREEN_IDLE_MS = 10 * 60_000;
/** The most screens of conversations open in a workspace at once. */
export const SCREEN_OPEN_MAX = 4;
/** A held step, or a confirmation, that nobody answers in this long counts as declined. */
export const ASK_TIMEOUT_MS = 15 * 60_000;
/** The most characters of page text one result carries; the rest is cut. */
export const RESULT_MAX = 40_000;
/** The most steps a screen session's log keeps; the oldest go first. */
export const STEP_LOG_MAX = 2000;

/**
 * The key of an agent's screen. A stage's agent session is `run:<runId>`; an agent in a conversation, or in a run's thread, is `call:<thread>:<agentId>`. One screen and one key
 * per agent session. Thread and agent ids hold no `:`, so a key splits unambiguously.
 */
export const runKey = (run: string): string => `run:${run}`;
export const callKey = (thread: string, agent: string): string => `call:${thread}:${agent}`;

export type ParsedKey = { kind: 'run'; run: string } | { kind: 'call'; thread: string; agent: string };

const PART = /^[^:\s]+$/;

/** What a key says, or null when it is not one. */
export function parseKey(key: unknown): ParsedKey | null {
  if (typeof key !== 'string') return null;
  const parts = key.split(':');
  if (parts[0] === 'run' && parts.length === 2 && PART.test(parts[1])) return { kind: 'run', run: parts[1] };
  if (parts[0] === 'call' && parts.length === 3 && PART.test(parts[1]) && PART.test(parts[2])) return { kind: 'call', thread: parts[1], agent: parts[2] };
  return null;
}

/** The key a caller means: a key as it is, or a bare run id (the stage's screen, as before keys existed). Null when it is neither. */
export function keyOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (parseKey(value)) return value;
  return PART.test(value) ? runKey(value) : null;
}

/** What the app made of a step: nothing to hold, an irreversible act, or something it could not read. */
export type StepClass = 'free' | 'irreversible' | 'unclassified';
/** Why a step is held, for the card: a submit, a name, a shortcut, a dialog, or a step the app could not read. */
export type HoldWhy = 'submit' | 'name' | 'shortcut' | 'dialog' | 'unclassified';
/** How a held step ended. */
export type HeldAnswer = 'yes' | 'no' | 'site' | 'timeout' | 'closed';
/** What came of a step: it was done, it failed, the person said no, or it was never run (refused by the app before the browser). */
export type StepOutcome = 'ok' | 'error' | 'declined' | 'not-run';

/**
 * One step of the app's browser, as the screen session's log keeps it for the procedure memory (#179). It holds what the app read of the page and nothing a person or an
 * agent typed: `site` is a host, `path` has no query and no fragment, `name` is the control's accessible name cut to 80 characters, `key` is a named key that types nothing
 * (Enter, Tab, Escape) or a shortcut chord, never text, and `reason` is the agent's own one sentence about why it took the step, when the call gave one. No value, no page
 * text beyond a control's name, no cookie.
 */
export interface StepEntry {
  /** 1-based, in the order the calls came, whatever became of them. */
  n: number;
  /** ISO time the call started. */
  at: string;
  tool: string;
  role?: string;
  name?: string;
  key?: string;
  reason?: string;
  site: string;
  path: string;
  class: StepClass;
  /** The step was held for the person, why, and what the answer was. */
  held?: { why: HoldWhy; answer: HeldAnswer };
  /** An unclassifiable step let through by the person's pass for the site. */
  passed?: true;
  outcome: StepOutcome;
  /** How long the call took, waiting for the person included. */
  ms: number;
}

/** The step in a form the card and the audit can word in the app's language, read from the page and never carrying a value the agent typed. */
export interface StepWords {
  action: 'click' | 'type' | 'press' | 'dialog' | 'drag' | 'select' | 'fill' | 'hover' | 'navigate' | 'tabs' | 'read' | 'wait' | 'other';
  role?: string;
  /** The control's accessible name, cut to 80 characters. */
  name?: string;
  /** The key or chord of a key press (a named key only). */
  key?: string;
  /** The control submits its form. */
  submit?: boolean;
  /** The word of the list the name matched. */
  word?: string;
}

/** What the agent says it is about to do, when it asks to confirm a step of its own. */
export const CONFIRM_KINDS = ['send', 'save', 'delete', 'publish', 'pay', 'other'] as const;
export type ConfirmKind = (typeof CONFIRM_KINDS)[number];

/** What the person can answer: yes, no, or "yes for the rest of this screen on this site" (only for a step the app could not read). */
export type AskDecision = 'yes' | 'no' | 'site';
export const ASK_DECISIONS: readonly AskDecision[] = ['yes', 'no', 'site'];

/** A step held for the person, or a confirmation the agent asked for, waiting for an answer. */
export interface PendingAsk {
  id: string;
  /** The screen it belongs to (`run:<id>` or `call:<thread>:<agent>`). */
  key: string;
  agent: string;
  kind: 'hold' | 'confirm';
  /** Why a step is held; `agent` for a confirmation the agent asked for. */
  why: HoldWhy | 'agent';
  /** The step in the app's words; null for a confirmation (the agent's own sentence is `agentWords`). */
  step: StepWords | null;
  /** The host of the page it is about; empty when the agent did not say. */
  site: string;
  /** What the agent wrote about the step, as its own words. */
  agentWords?: string;
  confirmKind?: ConfirmKind;
  /** ISO time it started waiting. */
  since: string;
}

/** A site that holds something in an agent's logged-in browser, as Settings lists it: counts only, never a name of a cookie or a value. */
export interface ProfileSite {
  /** The host, lowercase, without a leading dot. */
  site: string;
  cookies: number;
  /** Entries of the site's local storage and databases. */
  storage: number;
}

/** Why the sites of a profile could not be read or cleared. */
export type SitesRefusal = 'agent' | 'site' | 'open' | 'busy' | 'browser' | 'failed';
export type SitesResult = { ok: true; sites: ProfileSite[] } | { ok: false; why: SitesRefusal; detail?: string };
export type RevokeResult = { ok: true; removed: boolean; sites: ProfileSite[] } | { ok: false; why: SitesRefusal; detail?: string };

/** The event the main process sends when the list of pending questions changes: it carries the questions and no page text. */
export const SCREEN_ASKS_EVENT = 'screen-asks';

/** What a conversation or a stage lists of an open screen: for the strip above the message box, the Watch button and the closing time. */
export interface OpenScreenInfo {
  key: string;
  agent: string;
  thread: string;
  /** A stage's screen, or an agent's in a conversation (or in a run's thread). */
  place: 'stage' | 'conversation';
  /** ISO time it opened. */
  since: string;
  /** ISO time it closes by itself if nothing keeps it; null while something does (an answer, a step, a question). */
  closesAt: string | null;
  /** The size of the display in pixels; 0 while the viewer has none to show. */
  width: number;
  height: number;
  /** Someone is controlling it from the desktop. */
  control: boolean;
  recording: 'on' | 'waiting' | 'stopped';
  /** The agent's logged-in browser, a fresh one because that is in use, or no browser profile at all. */
  profile: 'own' | 'fresh' | 'none';
  pending: PendingAsk[];
}
