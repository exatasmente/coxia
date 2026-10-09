// The registry of live screens (#157): a viewer's read, the cache that makes two viewers cost one read, what is answered for a screen that did not change, and what
// ends a live screen (the stage, a display that stops answering, a connection that is lost). The display is a fake connection and the clock is ours.
import { describe, expect, it, vi } from 'vitest';
import { type FrameEncoder } from '../src/main/screen/frame';
import { FRAME_MIN_MS, type ScreenHub, createScreenHub } from '../src/main/screen/hub';
import { type FakeConn, H, W, fakeConn } from './helpers/screen';

function setup(over: { enabled?: boolean; connectFails?: boolean; encode?: FrameEncoder['encode'] } = {}) {
  const conn = fakeConn();
  const clock = { t: 1_000_000 };
  const encoded: number[] = [];
  const changed: string[] = [];
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
  });
  const open = () => hub.open({ run: 'r-1', stage: 'qa', socket: '/x/X99', kind: 'sandbox' });
  return { conn, clock, encoded, changed, connect, hub, open };
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
    await expect(hub.open({ run: 'r-1', stage: 'qa', socket: '/x', kind: 'host' })).resolves.toBe(true);
    expect(() => hub.end('r-1')).not.toThrow();
  });
});
