// The live screen of an agent's virtual display (#157): what the person's input looks like on the wire and the limits both sides hold to. Pure, so the renderer
// and the main process read the same constants.

/** One input event from the viewer: pointer position in the screen's own pixels, buttons, wheel notches and keys. */
export type ScreenInput =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; b: 1 | 2 | 3; down: boolean }
  /** Wheel notches, signed: positive scrolls down. */
  | { t: 'scroll'; dy: number }
  /** A `KeyboardEvent.key`: a name such as `Enter`, or one character. */
  | { t: 'key'; key: string; down: boolean };

/** Most events one call carries. */
export const SCREEN_INPUT_MAX = 64;
/** Most events accepted for a run in one second. */
export const SCREEN_INPUT_PER_SECOND = 200;
/** Longest `key` a call may carry. */
export const SCREEN_KEY_MAX = 32;
/** Most wheel notches one scroll event turns into. */
export const SCREEN_SCROLL_NOTCHES_MAX = 5;

/**
 * The chord that leaves Take control from the keyboard: Control, Alt and Shift held with Escape. The viewer acts on it and the main process never sends it to the
 * screen either, so a person is never stuck inside the agent's screen.
 */
export function isExitChord(key: string, held: { ctrl: boolean; alt: boolean; shift: boolean }): boolean {
  return key === 'Escape' && held.ctrl && held.alt && held.shift;
}
