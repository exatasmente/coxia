import { SCREEN_KEY_MAX, SCREEN_SCROLL_NOTCHES_MAX, isExitChord } from '../../shared/screen';
import type { X11Input, X11Keymap } from './x11';

// From what the viewer sends (a pointer position, buttons, wheel notches, `KeyboardEvent.key`) to what the display takes: absolute pointer moves, buttons and
// keycodes. A key the layout has no keycode for is rejected and counted, so the viewer can say it was not delivered, never dropped without a word. Pure: the
// keymap and the screen's size come in.

const KEYSYM: Record<string, number> = {
  Enter: 0xff0d,
  Tab: 0xff09,
  Escape: 0xff1b,
  Backspace: 0xff08,
  Delete: 0xffff,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  Shift: 0xffe1,
  Control: 0xffe3,
  Alt: 0xffe9,
};
const SHIFT = 0xffe1;
const CONTROL = 0xffe3;
const ALT = 0xffe9;

/** The keysym a `KeyboardEvent.key` stands for: a name from the table, or one printable character (Latin-1 as it is, any other as a Unicode keysym). */
export function keysymOf(key: string): number | null {
  if (key.length === 0 || key.length > SCREEN_KEY_MAX) return null;
  if (Object.prototype.hasOwnProperty.call(KEYSYM, key)) return KEYSYM[key];
  const chars = [...key];
  if (chars.length !== 1) return null;
  const cp = chars[0].codePointAt(0) as number;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  if (cp >= 0x100 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) return 0x01000000 + cp;
  return null;
}

export interface Keycap {
  keycode: number;
  /** The keysym is the second column: it needs Shift. */
  shift: boolean;
}

/** keysym -> keycode, from the first two columns of the mapping (plain and Shift); the lowest keycode wins and a plain column beats a shifted one. */
export function keymapIndex(map: X11Keymap): Map<number, Keycap> {
  const out = new Map<number, Keycap>();
  const rows = map.syms.length / map.width;
  for (const column of [0, 1]) {
    if (column >= map.width) break;
    for (let i = 0; i < rows; i++) {
      const sym = map.syms[i * map.width + column];
      if (sym !== 0 && !out.has(sym)) out.set(sym, { keycode: map.first + i, shift: column === 1 });
    }
  }
  return out;
}

export interface InputPlan {
  events: X11Input[];
  /** Events of the viewer that were understood (an event that does nothing, such as the release of a key not held, still counts). */
  accepted: number;
  /** Events of the viewer that were not: a wrong shape, a key with no keycode, the exit chord. */
  rejected: number;
}

export interface InputPlanner {
  plan(events: readonly unknown[]): InputPlan;
  /** What puts every key and button the planner pressed back up. */
  releaseAll(): X11Input[];
  /** Something is held down. */
  holding(): boolean;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function createInputPlanner(keymap: X11Keymap, size: () => { width: number; height: number }): InputPlanner {
  const index = keymapIndex(keymap);
  const shiftKey = index.get(SHIFT)?.keycode ?? null;
  // Keycodes held down; the value says Shift was pressed for it by the planner, not by the person.
  const held = new Map<number, boolean>();
  const heldButtons = new Set<number>();
  let bracketed = 0;
  const modifier = (sym: number): boolean => {
    const k = index.get(sym)?.keycode;
    return k !== undefined && held.has(k);
  };

  function key(out: X11Input[], name: unknown, down: unknown): boolean {
    if (typeof name !== 'string' || typeof down !== 'boolean') return false;
    const sym = keysymOf(name);
    if (sym === null) return false;
    const cap = index.get(sym);
    if (!cap) return false;
    // The way back out of Take control is never sent to the screen.
    if (down && isExitChord(name, { ctrl: modifier(CONTROL), alt: modifier(ALT), shift: modifier(SHIFT) })) return false;
    if (down) {
      if (held.has(cap.keycode)) {
        out.push({ type: 'key', keycode: cap.keycode, down: true });
        return true;
      }
      let bracket = false;
      if (cap.shift && shiftKey !== null && !held.has(shiftKey)) {
        if (bracketed === 0) out.push({ type: 'key', keycode: shiftKey, down: true });
        bracketed++;
        bracket = true;
      } else if (cap.shift && shiftKey === null) return false;
      out.push({ type: 'key', keycode: cap.keycode, down: true });
      held.set(cap.keycode, bracket);
      return true;
    }
    if (!held.has(cap.keycode)) return true;
    out.push({ type: 'key', keycode: cap.keycode, down: false });
    const bracket = held.get(cap.keycode);
    held.delete(cap.keycode);
    if (bracket && shiftKey !== null) {
      bracketed--;
      if (bracketed === 0) out.push({ type: 'key', keycode: shiftKey, down: false });
    }
    return true;
  }

  return {
    plan(events) {
      const out: X11Input[] = [];
      let accepted = 0;
      let rejected = 0;
      for (const raw of events) {
        const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        let ok = false;
        if (e.t === 'move' && isNum(e.x) && isNum(e.y)) {
          const { width, height } = size();
          out.push({ type: 'motion', x: Math.max(0, Math.min(width - 1, Math.round(e.x))), y: Math.max(0, Math.min(height - 1, Math.round(e.y))) });
          ok = true;
        } else if (e.t === 'button' && (e.b === 1 || e.b === 2 || e.b === 3) && typeof e.down === 'boolean') {
          out.push({ type: 'button', button: e.b, down: e.down });
          if (e.down) heldButtons.add(e.b);
          else heldButtons.delete(e.b);
          ok = true;
        } else if (e.t === 'scroll' && isNum(e.dy) && e.dy !== 0) {
          // Buttons 4 and 5 are the wheel, a press and a release per notch.
          const notches = Math.max(1, Math.min(SCREEN_SCROLL_NOTCHES_MAX, Math.round(Math.abs(e.dy))));
          const button = e.dy > 0 ? 5 : 4;
          for (let i = 0; i < notches; i++) out.push({ type: 'button', button, down: true }, { type: 'button', button, down: false });
          ok = true;
        } else if (e.t === 'key') ok = key(out, e.key, e.down);
        if (ok) accepted++;
        else rejected++;
      }
      return { events: out, accepted, rejected };
    },
    releaseAll() {
      const out: X11Input[] = [];
      for (const b of heldButtons) out.push({ type: 'button', button: b, down: false });
      heldButtons.clear();
      for (const code of held.keys()) out.push({ type: 'key', keycode: code, down: false });
      if (bracketed > 0 && shiftKey !== null && !out.some((e) => e.type === 'key' && e.keycode === shiftKey)) out.push({ type: 'key', keycode: shiftKey, down: false });
      held.clear();
      bracketed = 0;
      return out;
    },
    holding: () => held.size > 0 || heldButtons.size > 0,
  };
}
