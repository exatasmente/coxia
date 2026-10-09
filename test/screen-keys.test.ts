import { describe, expect, it } from 'vitest';
import { SCREEN_INPUT_MAX, SCREEN_SCROLL_NOTCHES_MAX, type ScreenInput } from '../src/shared/screen';
import { FLUSH_MS, POLL_MS, POLL_SLOW_MS, batchesOf, buttonOf, createHeld, isSentKey, pointerToScreen, pollDelay, takeControl, wheelNotches } from '../src/renderer/src/screens/cycle/screenKeys';

const screen = { width: 1280, height: 800 };

describe('where a pointer lands on the agent screen', () => {
  it('maps the picture to the screen pixel by pixel when the box is the picture', () => {
    const box = { left: 100, top: 50, width: 640, height: 400 };
    expect(pointerToScreen(box, { x: 100, y: 50 }, screen)).toEqual({ x: 0, y: 0 });
    expect(pointerToScreen(box, { x: 420, y: 250 }, screen)).toEqual({ x: 640, y: 400 });
    expect(pointerToScreen(box, { x: 740, y: 450 }, screen)).toEqual({ x: 1279, y: 799 });
  });

  it('accounts for the bars around a contained picture', () => {
    // A box twice as wide as the picture's ratio: the picture is centred, with bars left and right.
    const box = { left: 0, top: 0, width: 1600, height: 400 };
    // The picture is 640x400 at x 480..1120.
    expect(pointerToScreen(box, { x: 800, y: 200 }, screen)).toEqual({ x: 640, y: 400 });
    expect(pointerToScreen(box, { x: 480, y: 0 }, screen)).toEqual({ x: 0, y: 0 });
    // A box taller than the picture's ratio: bars above and below.
    const tall = { left: 0, top: 0, width: 640, height: 800 };
    expect(pointerToScreen(tall, { x: 320, y: 400 }, screen)).toEqual({ x: 640, y: 400 });
  });

  it('puts a point in a bar or outside the box on the nearest edge, never off the screen', () => {
    const box = { left: 0, top: 0, width: 1600, height: 400 };
    expect(pointerToScreen(box, { x: 10, y: 200 }, screen)).toEqual({ x: 0, y: 400 });
    expect(pointerToScreen(box, { x: 1590, y: 999 }, screen)).toEqual({ x: 1279, y: 799 });
    expect(pointerToScreen(box, { x: -50, y: -50 }, screen)).toEqual({ x: 0, y: 0 });
  });

  it('answers the origin for a box or a screen with no size instead of dividing by zero', () => {
    expect(pointerToScreen({ left: 0, top: 0, width: 0, height: 0 }, { x: 5, y: 5 }, screen)).toEqual({ x: 0, y: 0 });
    expect(pointerToScreen({ left: 0, top: 0, width: 10, height: 10 }, { x: 5, y: 5 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('the wheel', () => {
  it('turns pixels into signed notches, at least one for any movement and at most five', () => {
    expect(wheelNotches(0, 0)).toBe(0);
    expect(wheelNotches(4, 0)).toBe(1);
    expect(wheelNotches(-4, 0)).toBe(-1);
    expect(wheelNotches(100, 0)).toBe(1);
    expect(wheelNotches(300, 0)).toBe(3);
    expect(wheelNotches(-300, 0)).toBe(-3);
    expect(wheelNotches(5000, 0)).toBe(SCREEN_SCROLL_NOTCHES_MAX);
    expect(wheelNotches(-5000, 0)).toBe(-SCREEN_SCROLL_NOTCHES_MAX);
  });

  it('reads the browser line and page modes as larger movements', () => {
    expect(wheelNotches(3, 1)).toBe(1);
    expect(wheelNotches(10, 1)).toBe(4);
    expect(wheelNotches(1, 2)).toBe(4);
    expect(wheelNotches(Number.NaN, 0)).toBe(0);
  });
});

describe('buttons and keys', () => {
  it('maps the left, middle and right buttons to 1, 2 and 3 and nothing else', () => {
    expect([0, 1, 2, 3, 4, -1].map(buttonOf)).toEqual([1, 2, 3, null, null, null]);
  });

  it('does not send the keys of the person\'s own system', () => {
    expect(isSentKey('Meta')).toBe(false);
    expect(isSentKey('OS')).toBe(false);
    expect(isSentKey('Enter')).toBe(true);
    expect(isSentKey('a')).toBe(true);
  });

  it('releases a key the way it was pressed, even when Shift changed the character in between', () => {
    const held = createHeld();
    expect(held.keyDown('KeyA', 'A')).toEqual({ t: 'key', key: 'A', down: true });
    expect(held.keyUp('KeyA')).toEqual({ t: 'key', key: 'A', down: false });
    expect(held.keyUp('KeyA')).toBeNull();
    expect(held.size()).toBe(0);
  });

  it('owes a release for every key and button still down, once', () => {
    const held = createHeld();
    held.keyDown('ShiftLeft', 'Shift');
    held.keyDown('KeyB', 'B');
    held.buttonDown(1);
    held.buttonDown(3);
    held.buttonUp(3);
    expect(held.buttonUp(3)).toBeNull();
    expect(held.size()).toBe(3);
    const owed = held.releaseAll();
    expect(owed).toEqual([
      { t: 'key', key: 'Shift', down: false },
      { t: 'key', key: 'B', down: false },
      { t: 'button', b: 1, down: false },
    ]);
    expect(owed.every((e) => !(e as { down: boolean }).down)).toBe(true);
    expect(held.releaseAll()).toEqual([]);
  });
});

describe('batching the input for a call', () => {
  const move = (x: number): ScreenInput => ({ t: 'move', x, y: 0 });
  const key = (k: string, down = true): ScreenInput => ({ t: 'key', key: k, down });

  it('folds consecutive moves into the last one and keeps every other event in order', () => {
    expect(batchesOf([move(1), move(2), move(3), { t: 'button', b: 1, down: true }, move(4), key('a')])).toEqual([[move(3), { t: 'button', b: 1, down: true }, move(4), key('a')]]);
  });

  it('cuts a long run into calls of at most the limit', () => {
    const events = Array.from({ length: SCREEN_INPUT_MAX * 2 + 5 }, (_, i) => key(`k${i}`));
    const batches = batchesOf(events);
    expect(batches.map((b) => b.length)).toEqual([SCREEN_INPUT_MAX, SCREEN_INPUT_MAX, 5]);
    expect(batches.flat()).toEqual(events);
  });

  it('makes no call for no events', () => {
    expect(batchesOf([])).toEqual([]);
  });
});

describe('the polling pace', () => {
  it('asks about twice a second, and slower after a slow answer', () => {
    expect(POLL_MS).toBe(500);
    expect(pollDelay(40)).toBe(POLL_MS);
    expect(pollDelay(800)).toBe(POLL_MS);
    expect(pollDelay(801)).toBe(POLL_SLOW_MS);
    expect(FLUSH_MS).toBeLessThanOrEqual(100);
  });
});

describe('taking control', () => {
  it('is held when the answer is ok and the viewer is still open, and nothing is given back', async () => {
    const asked: boolean[] = [];
    const held = await takeControl(async (on) => (asked.push(on), { ok: true }), () => true);
    expect(held).toBe(true);
    expect(asked).toEqual([true]);
  });

  it('is given back at once when the viewer closed while the answer was on its way', async () => {
    const asked: boolean[] = [];
    let open = true;
    const held = await takeControl(
      async (on) => {
        asked.push(on);
        // The person closes the viewer before the main process answers.
        if (on) open = false;
        return { ok: true };
      },
      () => open,
    );
    expect(held).toBe(false);
    expect(asked).toEqual([true, false]);
  });

  it('is not held, and nothing is given back, when it was refused or the ask failed', async () => {
    const asked: boolean[] = [];
    expect(await takeControl(async (on) => (asked.push(on), { ok: false, reason: 'none' }), () => true)).toBe(false);
    expect(await takeControl(async (on) => { asked.push(on); throw new Error('gone'); }, () => true)).toBe(false);
    expect(asked).toEqual([true, true]);
  });
});
