import { SCREEN_INPUT_MAX, SCREEN_SCROLL_NOTCHES_MAX, type ScreenControlAnswer, type ScreenInput } from '../../../../shared/screen';

// What the live screen's viewer does with the person's input, without a DOM: where a pointer lands on the agent's screen, how the wheel becomes notches, which keys
// and buttons are held (so none is left down when control ends) and how events are batched for one call. The component only wires the browser's events to these.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/**
 * The agent's screen pixel under a pointer. The picture is drawn `contain`ed in its box, so a box wider or taller than the picture has bars around it: a point in a bar
 * lands on the nearest edge, never outside the screen.
 */
export function pointerToScreen(box: Box, client: { x: number; y: number }, screen: Size): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0 || screen.width <= 0 || screen.height <= 0) return { x: 0, y: 0 };
  const scale = Math.min(box.width / screen.width, box.height / screen.height);
  const drawnW = screen.width * scale;
  const drawnH = screen.height * scale;
  const x = (client.x - box.left - (box.width - drawnW) / 2) / scale;
  const y = (client.y - box.top - (box.height - drawnH) / 2) / scale;
  return { x: clamp(Math.round(x), 0, screen.width - 1), y: clamp(Math.round(y), 0, screen.height - 1) };
}

/** A pixel of wheel travel that makes one notch. */
const PIXELS_PER_NOTCH = 100;
/** A line of travel counts as this many notches' worth of pixels in the browser's line mode. */
const LINE_PIXELS = 40;
const PAGE_PIXELS = 400;

/** The wheel as signed notches (positive scrolls down), at most `SCREEN_SCROLL_NOTCHES_MAX` for one event; 0 only for no movement at all, so a small trackpad nudge still scrolls one. */
export function wheelNotches(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const pixels = Math.abs(deltaY) * (deltaMode === 1 ? LINE_PIXELS : deltaMode === 2 ? PAGE_PIXELS : 1);
  return Math.sign(deltaY) * clamp(Math.round(pixels / PIXELS_PER_NOTCH), 1, SCREEN_SCROLL_NOTCHES_MAX);
}

/** The screen's button for a pointer event's `button` (0 left, 1 middle, 2 right); the browser's back and forward buttons have none. */
export function buttonOf(button: number): 1 | 2 | 3 | null {
  return button === 0 ? 1 : button === 1 ? 2 : button === 2 ? 3 : null;
}

/** Keys the person's own system uses and the agent's screen has no use for: not sent, and not counted as rejected. */
const NOT_SENT = new Set(['Meta', 'OS', 'Unidentified']); // i18n-ignore: KeyboardEvent.key values

export const isSentKey = (key: string): boolean => !NOT_SENT.has(key);

export interface Held {
  /** Presses a key (by its physical `code`, so the release matches even when Shift changed the character) and remembers what was sent. */
  keyDown(code: string, key: string): ScreenInput;
  /** The release of what was pressed under that `code`; null when nothing was. */
  keyUp(code: string): ScreenInput | null;
  buttonDown(b: 1 | 2 | 3): ScreenInput;
  buttonUp(b: 1 | 2 | 3): ScreenInput | null;
  /** Every release still owed: called when control ends, the window loses focus or the viewer closes. Empties the set. */
  releaseAll(): ScreenInput[];
  size(): number;
}

export function createHeld(): Held {
  const keys = new Map<string, string>();
  const buttons = new Set<1 | 2 | 3>();
  return {
    keyDown(code, key) {
      keys.set(code, key);
      return { t: 'key', key, down: true };
    },
    keyUp(code) {
      const key = keys.get(code);
      if (key === undefined) return null;
      keys.delete(code);
      return { t: 'key', key, down: false };
    },
    buttonDown(b) {
      buttons.add(b);
      return { t: 'button', b, down: true };
    },
    buttonUp(b) {
      if (!buttons.delete(b)) return null;
      return { t: 'button', b, down: false };
    },
    releaseAll() {
      const out: ScreenInput[] = [...[...keys.values()].map((key): ScreenInput => ({ t: 'key', key, down: false })), ...[...buttons].map((b): ScreenInput => ({ t: 'button', b, down: false }))];
      keys.clear();
      buttons.clear();
      return out;
    },
    size: () => keys.size + buttons.size,
  };
}

/** Folds a run of events for one call: a pointer move followed by another is one move (only where it ended matters), then cuts at most `SCREEN_INPUT_MAX` events per call. */
export function batchesOf(events: readonly ScreenInput[]): ScreenInput[][] {
  const folded: ScreenInput[] = [];
  for (const e of events) {
    if (e.t === 'move' && folded.length > 0 && folded[folded.length - 1].t === 'move') folded[folded.length - 1] = e;
    else folded.push(e);
  }
  const out: ScreenInput[][] = [];
  for (let i = 0; i < folded.length; i += SCREEN_INPUT_MAX) out.push(folded.slice(i, i + SCREEN_INPUT_MAX));
  return out;
}

/** How long to wait before asking again: the usual interval, or a longer one after a slow answer (a slow connection). */
export const POLL_MS = 500;
export const POLL_SLOW_MS = 1000;
export const SLOW_ANSWER_MS = 800;
export const pollDelay = (tookMs: number): number => (tookMs > SLOW_ANSWER_MS ? POLL_SLOW_MS : POLL_MS);

/** The input is sent in batches this often while it is flowing. */
export const FLUSH_MS = 50;

/**
 * Asks for control and reports whether the viewer holds it. The answer comes later than the click: a viewer that closed meanwhile never held it, and the main
 * process, which already turned control on, is told to turn it off again.
 */
export async function takeControl(ask: (on: boolean) => Promise<ScreenControlAnswer>, stillOpen: () => boolean): Promise<boolean> {
  const answer = await ask(true).catch(() => null);
  if (!answer?.ok) return false;
  if (stillOpen()) return true;
  await ask(false).catch(() => undefined);
  return false;
}
