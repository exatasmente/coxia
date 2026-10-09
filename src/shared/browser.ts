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
