// The hand-off of an agent's screen to the person (#178): what the renderer and the main process both know. Pure types and constants; the behaviour is in
// `src/main/screen/handoff.ts`.

/** How long a request waits for the person to take the screen. */
export const HANDOFF_ASK_MS = 15 * 60_000;
/** Once the screen is taken, how long without any input of the person before the hand-off ends as expired. */
export const HANDOFF_IDLE_MS = 30 * 60_000;
/** The most characters of `what` and `why`, the agent's words. */
export const HANDOFF_TEXT_MAX = 300;

/** What the tool answers the agent. The four are fixed sentences and carry nothing else. */
export type HandoffResult = 'done' | 'declined' | 'expired' | 'unavailable';

/** What the agent's call is answered with, in the app's browser and in its shell, while the person has the screen. */
export const HANDOFF_HELD_TEXT = 'The person has the screen; wait for the hand-off result.';

/** Which ways to the screen this agent has, to word the warning truthfully: the app's browser, and where its shell runs. */
export interface HandoffPaths {
  browser: boolean;
  shell: 'sandbox' | 'host' | 'none';
}

/** The card's part of a pending ask of kind `handoff`. */
export interface HandoffCard {
  /** The agent's second sentence; absent when it gave none. */
  why?: string;
  /** The person has the screen now: the card offers Give back instead of Take the screen. */
  taken: boolean;
  paths: HandoffPaths;
}

/** The answer to the person taking the screen or giving it back. */
export type HandoffAnswer = { ok: true } | { ok: false; reason: 'gone' | 'taken' | 'none' };

const WARNING = 'ui.screen.handoff.warning.';

/**
 * The lines of the warning shown before the person types, as catalog keys in the order they are read. What is said depends on what this agent has: the line about the app's
 * browser only with it, the lines about programs only with a shell (with the extra sentence on the computer), and a line that says no program runs beside the screen
 * for an agent with no shell at all.
 */
export function composeWarning(paths: HandoffPaths): string[] {
  const ids = ['always', 'recorded'];
  if (paths.browser) ids.push('browser');
  if (paths.shell !== 'none') ids.push('programs');
  if (paths.shell === 'host') ids.push('programsHost');
  if (paths.shell === 'none') ids.push('noPrograms');
  ids.push('last');
  return ids.map((id) => `${WARNING}${id}`);
}
