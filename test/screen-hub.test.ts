// The registry of live screens (#157): a viewer's read, the cache that makes two viewers cost one read, what is answered for a screen that did not change, and what
// ends a live screen (the stage, a display that stops answering, a connection that is lost). The display is a fake connection and the clock is ours.
import { describe, expect, it, vi } from 'vitest';
import { type FrameEncoder } from '../src/main/screen/frame';
import { BURST_GAP_MS, FRAME_MIN_MS, type ScreenHub, createScreenHub } from '../src/main/screen/hub';
import { SCREEN_INPUT_MAX, SCREEN_INPUT_PER_SECOND } from '../src/shared/screen';
import { type FakeConn, H, W, fakeConn } from './helpers/screen';

function setup(over: { enabled?: boolean; connectFails?: boolean; encode?: FrameEncoder['encode'] } = {}) {
  const conn = fakeConn();
  const clock = { t: 1_000_000 };
  const encoded: number[] = [];
  const changed: string[] = [];
  const notes: { run: string; stage: string; code: string; params: Record<string, string> }[] = [];
  // The timers of the hub, by hand: the burst of input is closed when the clock says so.
  const timers: { ms: number; fn: () => void; live: boolean }[] = [];
  const connect = vi.fn(async () => {
    if (over.connectFails) throw new Error('refused');
    return conn;
  });
  const hub: ScreenHub = createScreenHub({
    enabled: over.enabled ?? true,
    encoder: {
      encode:
        over.encode ??
        ((frame, width) => {
          encoded.push(width);
          return { jpeg: Uint8Array.from([0xff, 0xd8, frame.data[0], width & 0xff]), width: Math.min(width, frame.width), height: Math.round((Math.min(width, frame.width) * frame.height) / frame.width) };
        }),
    },
    now: () => clock.t,
    connect,
    changed: (run) => changed.push(run),
    note: (run, stage, code, params) => notes.push({ run, stage, code, params }),
    schedule: (ms, fn) => {
      const timer = { ms, fn, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
  });
  const open = () => hub.open({ run: 'r-1', stage: 'qa', agent: 'qa', socket: '/x/X99', kind: 'sandbox' });
  /** Lets the silence after the last input pass: the timers that are still wanted go off. */
  const quiet = () => {
    for (const timer of timers.splice(0)) if (timer.live) timer.fn();
  };
  return { conn, clock, encoded, changed, notes, timers, quiet, connect, hub, open };
}

describe('a live screen', () => {
  it('opens through the display\'s socket and is what the run is handed out with', async () => {
    const s = setup();
    expect(await s.open()).toBe(true);
    expect(s.connect).toHaveBeenCalledWith('/x/X99');
    expect(s.hub.state('r-1')).toEqual({ stage: 'qa', width: W, height: H, since: new Date(1_000_000).toISOString(), control: false });
    expect(s.hub.state('r-2')).toBeNull();
    expect(s.changed).toEqual(['r-1']);
  });

  it('is not made where the platform has no display: nothing is dialled and every answer is none', async () => {
    const s = setup({ enabled: false });
    expect(await s.open()).toBe(false);
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.hub.state('r-1')).toBeNull();
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'none' });
  });

  it('is not made when the display cannot be reached, and the run has none', async () => {
    const s = setup({ connectFails: true });
    expect(await s.open()).toBe(false);
    expect(s.hub.state('r-1')).toBeNull();
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'none' });
    expect(s.changed).toEqual([]);
  });

  it('takes the place of an earlier one of the same run, and closes that connection', async () => {
    const s = setup();
    await s.open();
    const first = s.conn;
    await s.open();
    expect(first.closed).toBe(true);
  });
});

describe('reading for a viewer', () => {
  it('reads nothing while nobody watches', async () => {
    const s = setup();
    await s.open();
    s.clock.t += 60_000;
    s.hub.state('r-1');
    await Promise.resolve();
    expect(s.conn.grabs).toBe(0);
    expect(s.encoded).toEqual([]);
  });

  it('answers the first ask with a picture of the width asked, the display\'s own size and the sequence number', async () => {
    const s = setup();
    await s.open();
    const a = await s.hub.frame('r-1', 0, 640);
    expect(a).toMatchObject({ state: 'frame', seq: 1, screen: { width: W, height: H }, control: false });
    if (a.state === 'frame') {
      expect(a.jpeg[0]).toBe(0xff);
      expect(a.width).toBe(W);
    }
    expect(s.conn.grabs).toBe(1);
  });

  it('reads at most once in 400 ms however many viewers ask, and again after it', async () => {
    const s = setup();
    await s.open();
    await Promise.all([s.hub.frame('r-1', 0, 1280), s.hub.frame('r-1', 0, 640), s.hub.frame('r-1', 0, 640)]);
    expect(s.conn.grabs).toBe(1);
    s.clock.t += FRAME_MIN_MS - 1;
    await s.hub.frame('r-1', 0, 640);
    expect(s.conn.grabs).toBe(1);
    s.clock.t += 1;
    await s.hub.frame('r-1', 0, 640);
    expect(s.conn.grabs).toBe(2);
  });

  it('shares the read that is already under way instead of starting another', async () => {
    const s = setup();
    await s.open();
    s.conn.hold = () => undefined;
    const a = s.hub.frame('r-1', 0, 640);
    const b = s.hub.frame('r-1', 0, 640);
    await vi.waitFor(() => expect(s.conn.grabs).toBe(1));
    s.conn.release();
    expect((await a).state).toBe('frame');
    expect((await b).state).toBe('frame');
    expect(s.conn.grabs).toBe(1);
  });

  it('answers "same" with no bytes while the screen has not changed, and the new picture when it has', async () => {
    const s = setup();
    await s.open();
    const first = await s.hub.frame('r-1', 0, 640);
    expect(first.state).toBe('frame');
    s.clock.t += 1000;
    expect(await s.hub.frame('r-1', 1, 640)).toEqual({ state: 'same', seq: 1, control: false });
    s.clock.t += 1000;
    s.conn.pixels[5] = 77;
    const next = await s.hub.frame('r-1', 1, 640);
    expect(next).toMatchObject({ state: 'frame', seq: 2 });
    expect(s.conn.grabs).toBe(3);
  });

  it('does not take a different pad byte for a change', async () => {
    const s = setup();
    await s.open();
    await s.hub.frame('r-1', 0, 640);
    s.clock.t += 1000;
    for (let i = 3; i < s.conn.pixels.length; i += 4) s.conn.pixels[i] = 9;
    expect(await s.hub.frame('r-1', 1, 640)).toMatchObject({ state: 'same' });
  });

  it('makes one picture per sequence number and width, however many viewers, and none for a viewer that already shows the frame', async () => {
    const s = setup();
    await s.open();
    await s.hub.frame('r-1', 0, 640);
    await s.hub.frame('r-1', 0, 640);
    await s.hub.frame('r-1', 0, 1280);
    await s.hub.frame('r-1', 0, 1280);
    expect(s.encoded).toEqual([640, 1280]);
    await s.hub.frame('r-1', 1, 960);
    expect(s.encoded).toEqual([640, 1280]);
    // A screen that changed drops the pictures of the old one.
    s.clock.t += 1000;
    s.conn.pixels[0] = 99;
    await s.hub.frame('r-1', 0, 640);
    expect(s.encoded).toEqual([640, 1280, 640]);
  });

  it('clamps the width before it picks a picture, so a hand-made width cannot fill the cache', async () => {
    const s = setup();
    await s.open();
    for (const w of [1, 321, 322, 999999, Number.NaN]) await s.hub.frame('r-1', 0, w);
    expect(new Set(s.encoded).size).toBe(s.encoded.length);
    expect(s.encoded.every((w) => w >= 320 && w <= 1280 && w % 80 === 0)).toBe(true);
  });

  it('answers none when the picture cannot be made', async () => {
    const s = setup({ encode: () => null });
    await s.open();
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'none' });
  });
});

describe('the end of a live screen', () => {
  it('stops everything with the stage: the connection closes, the run has no screen, and the reader is never called again', async () => {
    const s = setup();
    await s.open();
    await s.hub.frame('r-1', 0, 640);
    const grabs = s.conn.grabs;
    expect(await s.hub.finish('r-1')).toBeNull();
    expect(s.conn.closed).toBe(true);
    expect(s.hub.state('r-1')).toBeNull();
    s.clock.t += 60_000;
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'none' });
    expect(await s.hub.frame('r-1', 1, 640)).toEqual({ state: 'none' });
    expect(s.conn.grabs).toBe(grabs);
    expect(s.changed).toEqual(['r-1', 'r-1']);
  });

  it('is idempotent, and ending a run that has none changes nothing', async () => {
    const s = setup();
    await s.open();
    s.hub.end('r-1');
    s.hub.end('r-1');
    await s.hub.finish('r-1');
    s.hub.end('r-nobody');
    expect(s.changed).toEqual(['r-1', 'r-1']);
  });

  it('answers none, not a late picture, to a read that was under way when the stage ended', async () => {
    const s = setup();
    await s.open();
    s.conn.hold = () => undefined;
    const pending = s.hub.frame('r-1', 0, 640);
    await vi.waitFor(() => expect(s.conn.grabs).toBe(1));
    s.hub.end('r-1');
    expect(await pending).toEqual({ state: 'none' });
    expect(s.encoded).toEqual([]);
  });

  it('ends every run\'s screen when the app closes', async () => {
    const s = setup();
    await s.open();
    s.hub.endAll();
    expect(s.hub.state('r-1')).toBeNull();
    expect(s.conn.closed).toBe(true);
  });

  it('takes a display that fails to answer twice in a row as gone, and the first failure only as a screen that has not changed', async () => {
    const s = setup();
    await s.open();
    s.conn.failReads = 2;
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'same', seq: 0, control: false });
    expect(s.hub.state('r-1')).not.toBeNull();
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'none' });
    expect(s.hub.state('r-1')).toBeNull();
    expect(s.conn.closed).toBe(true);
  });

  it('forgets a failure once a read works', async () => {
    const s = setup();
    await s.open();
    s.conn.failReads = 1;
    await s.hub.frame('r-1', 0, 640);
    expect((await s.hub.frame('r-1', 0, 640)).state).toBe('frame');
    s.clock.t += 1000;
    s.conn.failReads = 1;
    expect(await s.hub.frame('r-1', 1, 640)).toMatchObject({ state: 'same', seq: 1 });
    expect(s.hub.state('r-1')).not.toBeNull();
  });

  it('ends when the connection is lost, and never dials again', async () => {
    const s = setup();
    await s.open();
    s.conn.close();
    expect(s.hub.state('r-1')).toBeNull();
    expect(await s.hub.frame('r-1', 0, 640)).toEqual({ state: 'none' });
    expect(s.connect).toHaveBeenCalledTimes(1);
    expect(s.changed).toEqual(['r-1', 'r-1']);
  });

  it('is not troubled by a listener that throws', async () => {
    const conn = fakeConn();
    const hub = createScreenHub({ enabled: true, encoder: { encode: () => null }, connect: async () => conn, changed: () => { throw new Error('x'); } });
    await expect(hub.open({ run: 'r-1', stage: 'qa', agent: 'qa', socket: '/x', kind: 'host' })).resolves.toBe(true);
    expect(() => hub.end('r-1')).not.toThrow();
  });
});

const key = (k: string, down: boolean) => ({ t: 'key', key: k, down });
const move = (x: number, y: number) => ({ t: 'move', x, y });
const sentFlat = (s: ReturnType<typeof setup>) => s.conn.sent.flat();
const local = (ms: number) => {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

describe('taking control', () => {
  it('is off until the person turns it on, and says so in the conversation both ways, once each', async () => {
    const s = setup();
    await s.open();
    expect(s.hub.state('r-1')?.control).toBe(false);
    expect(await s.hub.control('r-1', true)).toEqual({ ok: true });
    expect(await s.hub.control('r-1', true)).toEqual({ ok: true });
    expect(s.hub.state('r-1')?.control).toBe(true);
    expect(await s.hub.frame('r-1', 0, 640)).toMatchObject({ state: 'frame', control: true });
    expect(await s.hub.control('r-1', false)).toEqual({ ok: true });
    expect(await s.hub.control('r-1', false)).toEqual({ ok: true });
    expect(s.hub.state('r-1')?.control).toBe(false);
    expect(s.notes).toEqual([
      { run: 'r-1', stage: 'qa', code: 'runner.screen.controlOn', params: { agent: 'qa' } },
      { run: 'r-1', stage: 'qa', code: 'runner.screen.controlOff', params: { agent: 'qa' } },
    ]);
    // The run list refreshes each time, so a phone shows the mark at once.
    expect(s.changed.length).toBe(3);
  });

  it('answers none for a run that has no live screen', async () => {
    const s = setup();
    expect(await s.hub.control('r-1', true)).toEqual({ ok: false, reason: 'none' });
    expect(await s.hub.input('r-1', [move(1, 1)])).toEqual({ ok: false, delivered: 0, rejected: 0, reason: 'none' });
  });

  it('sends nothing while it is off', async () => {
    const s = setup();
    await s.open();
    expect(await s.hub.input('r-1', [move(1, 1), key('a', true)])).toEqual({ ok: false, delivered: 0, rejected: 0, reason: 'off' });
    expect(s.conn.sent).toEqual([]);
    await s.hub.control('r-1', true);
    await s.hub.control('r-1', false);
    expect(await s.hub.input('r-1', [move(1, 1)])).toMatchObject({ reason: 'off' });
    expect(s.conn.sent).toEqual([]);
  });

  it('writes the lines under the stage and in the app\'s name, not as anything the agent did', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    expect(s.notes.every((n) => n.stage === 'qa' && n.params.agent === 'qa')).toBe(true);
  });
});

describe('the person\'s input', () => {
  it('reaches the screen through the connection: pointer, button, wheel and keys, in order', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    const r = await s.hub.input('r-1', [move(5.4, 2), { t: 'button', b: 1, down: true }, { t: 'button', b: 1, down: false }, { t: 'scroll', dy: 1 }, key('a', true), key('a', false)]);
    expect(r).toEqual({ ok: true, delivered: 6, rejected: 0 });
    expect(sentFlat(s)).toEqual([
      { type: 'motion', x: 5, y: 2 },
      { type: 'button', button: 1, down: true },
      { type: 'button', button: 1, down: false },
      { type: 'button', button: 5, down: true },
      { type: 'button', button: 5, down: false },
      { type: 'key', keycode: 8, down: true },
      { type: 'key', keycode: 8, down: false },
    ]);
  });

  it('keeps the pointer on the screen as it is now', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.input('r-1', [move(500, 500)]);
    expect(sentFlat(s)).toEqual([{ type: 'motion', x: W - 1, y: H - 1 }]);
  });

  it('counts what is not an event, a key the layout has no key for and the way out of control, and sends the rest', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    const r = await s.hub.input('r-1', [{ t: 'nope' }, key('é', true), move(1, 1), null, 7]);
    expect(r).toEqual({ ok: true, delivered: 1, rejected: 4 });
    expect(sentFlat(s)).toEqual([{ type: 'motion', x: 1, y: 1 }]);
  });

  it('never sends Control, Alt and Shift with Escape', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    const r = await s.hub.input('r-1', [key('Control', true), key('Alt', true), key('Shift', true), key('Escape', true), key('Escape', false)]);
    expect(r.rejected).toBe(1);
    expect(sentFlat(s).some((e) => e.type === 'key' && e.keycode === 14)).toBe(false);
  });

  it('still moves the pointer when the keymap cannot be read, and rejects the keys', async () => {
    const s = setup();
    s.conn.keymap = async () => null;
    await s.open();
    await s.hub.control('r-1', true);
    expect(await s.hub.input('r-1', [move(2, 2), key('a', true)])).toEqual({ ok: true, delivered: 1, rejected: 1 });
  });

  it('says it was not delivered when the display did not take it', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    s.conn.failInput = true;
    expect(await s.hub.input('r-1', [move(1, 1), move(2, 2)])).toEqual({ ok: false, delivered: 0, rejected: 2 });
    // Nothing was done, so there is no burst to speak of.
    s.quiet();
    expect(s.notes.map((n) => n.code)).toEqual(['runner.screen.controlOn']);
  });

  it(`takes at most ${SCREEN_INPUT_MAX} events in a call and ${SCREEN_INPUT_PER_SECOND} in a second, and rejects the rest`, async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    const many = Array.from({ length: 100 }, (_, i) => move(i % W, 1));
    expect(await s.hub.input('r-1', many)).toEqual({ ok: true, delivered: SCREEN_INPUT_MAX, rejected: 36 });
    await s.hub.input('r-1', many);
    await s.hub.input('r-1', many);
    expect(await s.hub.input('r-1', many)).toEqual({ ok: true, delivered: SCREEN_INPUT_PER_SECOND - 3 * SCREEN_INPUT_MAX, rejected: 100 - (SCREEN_INPUT_PER_SECOND - 3 * SCREEN_INPUT_MAX) });
    s.clock.t += 1000;
    expect(await s.hub.input('r-1', many)).toEqual({ ok: true, delivered: SCREEN_INPUT_MAX, rejected: 36 });
  });

  it('is not the agent\'s: it reads no frame and asks the display for nothing but the input', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.input('r-1', [move(1, 1)]);
    expect(s.conn.grabs).toBe(0);
  });
});

describe('bursts of input', () => {
  it('end 3 s after the last event: one line with when it began and when it ended, in local time', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    const t0 = s.clock.t;
    await s.hub.input('r-1', [move(1, 1)]);
    s.clock.t += 1000;
    await s.hub.input('r-1', [move(2, 2)]);
    s.clock.t += 800;
    await s.hub.input('r-1', [key('a', true), key('a', false)]);
    expect(s.notes.filter((n) => n.code === 'runner.screen.used')).toEqual([]);
    s.quiet();
    expect(s.notes.filter((n) => n.code === 'runner.screen.used')).toEqual([{ run: 'r-1', stage: 'qa', code: 'runner.screen.used', params: { agent: 'qa', from: local(t0), to: local(t0 + 1800) } }]);
    expect(s.timers.every((t) => !t.live || t.ms === BURST_GAP_MS)).toBe(true);
  });

  it('start again after a silence, one line each', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.input('r-1', [move(1, 1)]);
    s.clock.t += BURST_GAP_MS + 1;
    // The timer has not fired yet (the clock jumped): the next event closes the old burst and begins another.
    await s.hub.input('r-1', [move(2, 2)]);
    expect(s.notes.filter((n) => n.code === 'runner.screen.used')).toHaveLength(1);
    s.quiet();
    expect(s.notes.filter((n) => n.code === 'runner.screen.used')).toHaveLength(2);
  });

  it('end when control is given back, with the line before the one that says so, and the keys still held put up', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.input('r-1', [key('A', true), { t: 'button', b: 1, down: true }]);
    s.conn.sent.length = 0;
    await s.hub.control('r-1', false);
    expect(s.notes.map((n) => n.code)).toEqual(['runner.screen.controlOn', 'runner.screen.used', 'runner.screen.controlOff']);
    const up = sentFlat(s);
    expect(up).toEqual(expect.arrayContaining([{ type: 'button', button: 1, down: false }, { type: 'key', keycode: 8, down: false }, { type: 'key', keycode: 12, down: false }]));
    expect(up.every((e) => (e.type === 'motion' ? false : !e.down))).toBe(true);
    // A burst that was closed is not closed twice.
    s.quiet();
    expect(s.notes.filter((n) => n.code === 'runner.screen.used')).toHaveLength(1);
  });

  it('end with the stage, which also gives control back and puts up what is held, before the connection closes', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.input('r-1', [key('Tab', true)]);
    s.conn.sent.length = 0;
    await s.hub.finish('r-1');
    expect(s.notes.map((n) => n.code)).toEqual(['runner.screen.controlOn', 'runner.screen.used', 'runner.screen.controlOff']);
    expect(sentFlat(s)).toEqual([{ type: 'key', keycode: 10, down: false }]);
    expect(s.conn.closed).toBe(true);
    // Nothing goes off after the stage: the timer of the burst was cancelled.
    s.quiet();
    expect(s.notes).toHaveLength(3);
    expect(await s.hub.input('r-1', [move(1, 1)])).toMatchObject({ reason: 'none' });
  });

  it('end without a line when the app drops the screen (the stage never got to finish)', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.input('r-1', [move(1, 1)]);
    s.hub.end('r-1');
    s.quiet();
    expect(s.notes.map((n) => n.code)).toEqual(['runner.screen.controlOn']);
  });

  it('are not a line when control was on and nothing was sent', async () => {
    const s = setup();
    await s.open();
    await s.hub.control('r-1', true);
    await s.hub.control('r-1', false);
    expect(s.notes.map((n) => n.code)).toEqual(['runner.screen.controlOn', 'runner.screen.controlOff']);
  });
});
