// From the viewer's events to the display's: key names and characters to keysyms, the keymap's plain and Shift columns, Shift around a shifted character, what is
// rejected and counted, the wheel as buttons 4 and 5, the pointer clamped to the screen and the way out of Take control that is never sent (#157).
import { describe, expect, it } from 'vitest';
import { isExitChord } from '../src/shared/screen';
import type { X11Keymap } from '../src/main/screen/x11';
import { createInputPlanner, keymapIndex, keysymOf } from '../src/main/screen/xinput';
import { defaultSyms } from './helpers/fakeX';

// The fake display's layout: keycode 8 a/A, 9 Return, 10 Tab, 11 Left, 12 Shift_L, 13 8/asterisk, 14 Escape, 15 Control_L, 16 Alt_L.
const A = 8;
const RETURN = 9;
const TAB = 10;
const LEFT = 11;
const SHIFT = 12;
const EIGHT = 13;
const ESC = 14;
const CTRL = 15;
const ALT = 16;

function keymap(rows = defaultSyms()): X11Keymap {
  return { first: 8, width: 2, syms: Uint32Array.from(rows.flat()) };
}
const planner = (rows?: number[][]) => createInputPlanner(keymap(rows), () => ({ width: 1280, height: 800 }));
const key = (k: string, down: boolean) => ({ t: 'key', key: k, down });
const down = (code: number) => ({ type: 'key', keycode: code, down: true });
const up = (code: number) => ({ type: 'key', keycode: code, down: false });

describe('key names and characters', () => {
  it('turn the control keys into their keysyms', () => {
    expect(keysymOf('Enter')).toBe(0xff0d);
    expect(keysymOf('Tab')).toBe(0xff09);
    expect(keysymOf('Escape')).toBe(0xff1b);
    expect(keysymOf('Backspace')).toBe(0xff08);
    expect(keysymOf('Delete')).toBe(0xffff);
    expect([keysymOf('ArrowLeft'), keysymOf('ArrowUp'), keysymOf('ArrowRight'), keysymOf('ArrowDown')]).toEqual([0xff51, 0xff52, 0xff53, 0xff54]);
    expect([keysymOf('Home'), keysymOf('End'), keysymOf('PageUp'), keysymOf('PageDown')]).toEqual([0xff50, 0xff57, 0xff55, 0xff56]);
    expect([keysymOf('Shift'), keysymOf('Control'), keysymOf('Alt')]).toEqual([0xffe1, 0xffe3, 0xffe9]);
  });

  it('turn a character into its Latin-1 keysym, or a Unicode keysym past it', () => {
    expect(keysymOf('a')).toBe(0x61);
    expect(keysymOf(' ')).toBe(0x20);
    expect(keysymOf('~')).toBe(0x7e);
    expect(keysymOf('é')).toBe(0xe9);
    expect(keysymOf('€')).toBe(0x01000000 + 0x20ac);
    expect(keysymOf('\u{1f600}')).toBe(0x01000000 + 0x1f600);
  });

  it('give nothing for what is not a key the screen takes', () => {
    for (const k of ['', 'Dead', 'Unidentified', 'Meta', 'F5', 'ab', '\u0001', '\u007f', '\ud800', 'x'.repeat(33)]) expect(keysymOf(k)).toBeNull();
    expect(keysymOf('toString')).toBeNull();
    expect(keysymOf('__proto__')).toBeNull();
  });
});

describe('the keymap', () => {
  it('finds a keysym in the plain column or the Shift one, the plain one first', () => {
    const idx = keymapIndex(keymap());
    expect(idx.get(0x61)).toEqual({ keycode: A, shift: false });
    expect(idx.get(0x41)).toEqual({ keycode: A, shift: true });
    expect(idx.get(0x2a)).toEqual({ keycode: EIGHT, shift: true });
    expect(idx.get(0xe9)).toBeUndefined();
    // A keysym on two keycodes: the lowest keycode wins, and a plain column beats a shifted one.
    const twice = keymapIndex(keymap([[0x61, 0x41], [0x41, 0]]));
    expect(twice.get(0x41)).toEqual({ keycode: 9, shift: false });
  });

  it('reads a mapping with a single column', () => {
    const idx = keymapIndex({ first: 10, width: 1, syms: Uint32Array.from([0x61, 0xff0d]) });
    expect(idx.get(0xff0d)).toEqual({ keycode: 11, shift: false });
  });
});

describe('planning keys', () => {
  it('sends a plain key as a press and a release', () => {
    const p = planner();
    expect(p.plan([key('a', true), key('a', false)])).toEqual({ events: [down(A), up(A)], accepted: 2, rejected: 0 });
    expect(p.plan([key('Enter', true), key('Enter', false), key('Tab', true), key('Tab', false), key('ArrowLeft', true), key('ArrowLeft', false)]).events).toEqual([down(RETURN), up(RETURN), down(TAB), up(TAB), down(LEFT), up(LEFT)]);
  });

  it('brackets a shifted character with Shift, press and release', () => {
    const p = planner();
    expect(p.plan([key('A', true), key('A', false)]).events).toEqual([down(SHIFT), down(A), up(A), up(SHIFT)]);
    expect(p.plan([key('*', true), key('*', false)]).events).toEqual([down(SHIFT), down(EIGHT), up(EIGHT), up(SHIFT)]);
    expect(p.holding()).toBe(false);
  });

  it('does not press Shift again while the person holds it', () => {
    const p = planner();
    const events = p.plan([key('Shift', true), key('A', true), key('A', false), key('Shift', false)]).events;
    expect(events).toEqual([down(SHIFT), down(A), up(A), up(SHIFT)]);
  });

  it('repeats a held key without bracketing it twice, and lets Shift go with the last shifted key', () => {
    const p = planner();
    const events = p.plan([key('A', true), key('A', true), key('*', true), key('A', false), key('*', false)]).events;
    expect(events).toEqual([down(SHIFT), down(A), down(A), down(EIGHT), up(A), up(EIGHT), up(SHIFT)]);
  });

  it('ignores the release of a key it did not press', () => {
    const p = planner();
    expect(p.plan([key('a', false)])).toEqual({ events: [], accepted: 1, rejected: 0 });
  });

  it('rejects and counts a key the layout has no keycode for, and one that is not a key', () => {
    const p = planner();
    const r = p.plan([key('é', true), key('€', true), key('F5', true), key('a', true)]);
    expect(r.rejected).toBe(3);
    expect(r.accepted).toBe(1);
    expect(r.events).toEqual([down(A)]);
  });

  it('rejects a shifted character when the layout has no Shift', () => {
    const p = planner([[0x61, 0x41]]);
    expect(p.plan([key('A', true)])).toEqual({ events: [], accepted: 0, rejected: 1 });
    expect(p.plan([key('a', true)]).events).toEqual([down(A)]);
  });

  it('never sends Control, Alt and Shift with Escape: the chord that leaves Take control', () => {
    const p = planner();
    const r = p.plan([key('Control', true), key('Alt', true), key('Shift', true), key('Escape', true), key('Escape', false)]);
    expect(r.rejected).toBe(1);
    expect(r.events).toEqual([down(CTRL), down(ALT), down(SHIFT)]);
    // With the three held, Escape on its own and Escape with two of them go through.
    const q = planner();
    expect(q.plan([key('Control', true), key('Escape', true), key('Escape', false)]).events).toEqual([down(CTRL), down(ESC), up(ESC)]);
    expect(isExitChord('Escape', { ctrl: true, alt: true, shift: true })).toBe(true);
    expect(isExitChord('Escape', { ctrl: true, alt: true, shift: false })).toBe(false);
    expect(isExitChord('a', { ctrl: true, alt: true, shift: true })).toBe(false);
  });

  it('puts back up whatever it pressed, Shift included', () => {
    const p = planner();
    p.plan([{ t: 'button', b: 1, down: true }, key('A', true), key('Tab', true)]);
    expect(p.holding()).toBe(true);
    const released = p.releaseAll();
    expect(released).toEqual(expect.arrayContaining([{ type: 'button', button: 1, down: false }, up(A), up(TAB), up(SHIFT)]));
    expect(released).toHaveLength(4);
    expect(p.holding()).toBe(false);
    expect(p.releaseAll()).toEqual([]);
  });
});

describe('planning the pointer', () => {
  it('moves to a position in the screen pixels, rounded and kept on the screen', () => {
    const p = planner();
    const r = p.plan([
      { t: 'move', x: 321.6, y: 456.2 },
      { t: 'move', x: -50, y: 9000 },
      { t: 'move', x: 5000, y: -1 },
    ]);
    expect(r.events).toEqual([
      { type: 'motion', x: 322, y: 456 },
      { type: 'motion', x: 0, y: 799 },
      { type: 'motion', x: 1279, y: 0 },
    ]);
  });

  it('follows the size of the screen as it is now', () => {
    const size = { width: 100, height: 50 };
    const p = createInputPlanner(keymap(), () => size);
    expect(p.plan([{ t: 'move', x: 500, y: 500 }]).events).toEqual([{ type: 'motion', x: 99, y: 49 }]);
    size.width = 10;
    expect(p.plan([{ t: 'move', x: 500, y: 5 }]).events).toEqual([{ type: 'motion', x: 9, y: 5 }]);
  });

  it('presses and releases the left, middle and right buttons', () => {
    const p = planner();
    const r = p.plan([
      { t: 'button', b: 1, down: true },
      { t: 'button', b: 1, down: false },
      { t: 'button', b: 2, down: true },
      { t: 'button', b: 3, down: true },
    ]);
    expect(r.events).toEqual([
      { type: 'button', button: 1, down: true },
      { type: 'button', button: 1, down: false },
      { type: 'button', button: 2, down: true },
      { type: 'button', button: 3, down: true },
    ]);
  });

  it('turns the wheel into buttons 4 (up) and 5 (down), a press and a release per notch, at most five', () => {
    const p = planner();
    expect(p.plan([{ t: 'scroll', dy: 1 }]).events).toEqual([
      { type: 'button', button: 5, down: true },
      { type: 'button', button: 5, down: false },
    ]);
    expect(p.plan([{ t: 'scroll', dy: -2 }]).events).toHaveLength(4);
    expect(p.plan([{ t: 'scroll', dy: -2 }]).events[0]).toEqual({ type: 'button', button: 4, down: true });
    expect(p.plan([{ t: 'scroll', dy: 50 }]).events).toHaveLength(10);
    expect(p.plan([{ t: 'scroll', dy: 0.2 }]).events).toHaveLength(2);
  });
});

describe('what is not an event', () => {
  it('is rejected and counted, never thrown', () => {
    const p = planner();
    const bad: unknown[] = [null, 7, 'move', [], {}, { t: 'teleport' }, { t: 'move', x: '1', y: 2 }, { t: 'move', x: NaN, y: 2 }, { t: 'move', x: 1 }, { t: 'button', b: 4, down: true }, { t: 'button', b: 1 }, { t: 'scroll', dy: 0 }, { t: 'scroll', dy: Infinity }, { t: 'key', key: 7, down: true }, { t: 'key', key: 'a', down: 'yes' }];
    const r = p.plan(bad);
    expect(r).toEqual({ events: [], accepted: 0, rejected: bad.length });
  });

  it('counts the good among the bad', () => {
    const p = planner();
    const r = p.plan([{ t: 'move', x: 1, y: 1 }, { t: 'nope' }, key('a', true)]);
    expect([r.accepted, r.rejected, r.events.length]).toEqual([2, 1, 2]);
  });
});
