import { describe, expect, it } from 'vitest';
import { type EncoderCommand, type EncoderEnv, type EncoderEvent, createEncoderHost, parseEncoderEvent } from '../src/main/screen/encoderHost';
import { RECORDING_BITRATE } from '../src/shared/screen';
import { frameOf } from './helpers/recorderSink';

// The main process's side of the encoder window, against a window that is only an object: what it is told to do, what it accepts back and from whom, what it does when the
// page is slow, refuses or dies, and when the window is closed. No Electron.

interface Timer {
  ms: number;
  fn: () => void;
  live: boolean;
}

function world(over: { autoReady?: boolean; page?: (cmd: EncoderCommand, say: (e: unknown, from?: number) => void) => void } = {}) {
  const sent: EncoderCommand[] = [];
  const timers: Timer[] = [];
  const created: { id: number; destroyed: boolean; gone: () => void }[] = [];
  let handler: ((senderId: number, raw: unknown) => void) | null = null;
  let listening = 0;
  let nextId = 7;
  /** What the page says: from the window that was made last, unless another sender is given. */
  const say = (e: unknown, from?: number): void => handler?.(from ?? created[created.length - 1]?.id ?? -1, e);
  const env: EncoderEnv = {
    create(gone) {
      const w = { id: nextId++, destroyed: false, gone };
      created.push(w);
      if (over.autoReady !== false) queueMicrotask(() => say({ ev: 'ready' }, w.id));
      return {
        id: w.id,
        send: (cmd) => {
          sent.push(cmd);
          if (over.page) over.page(cmd, say);
          else if (cmd.op === 'open') queueMicrotask(() => say({ ev: 'opened', rec: cmd.rec, ok: true }));
          else if (cmd.op === 'flush') queueMicrotask(() => say({ ev: 'flushed', rec: cmd.rec, ok: true }));
        },
        destroy: () => void (w.destroyed = true),
      };
    },
    listen(h) {
      handler = h;
      listening++;
      return () => {
        listening--;
        handler = null;
      };
    },
    schedule(ms, fn) {
      const t: Timer = { ms, fn, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
  };
  const fire = (ms: number): void => {
    for (const t of timers) if (t.live && t.ms === ms) {
      t.live = false;
      t.fn();
    }
  };
  return { env, sent, timers, created, say, fire, listening: () => listening };
}

const chunkOf = (rec: number, ts: number, key: boolean, n = 10): EncoderEvent => ({ ev: 'chunk', rec, ts, key, data: new Uint8Array(n).fill(key ? 1 : 2) });

describe('an event from the page', () => {
  it('is read only when it has the shape of one', () => {
    expect(parseEncoderEvent({ ev: 'ready' })).toEqual({ ev: 'ready' });
    expect(parseEncoderEvent({ ev: 'opened', rec: 1, ok: true })).toEqual({ ev: 'opened', rec: 1, ok: true });
    expect(parseEncoderEvent({ ev: 'chunk', rec: 1, ts: 5, key: true, data: new Uint8Array(3) })).toMatchObject({ ev: 'chunk', ts: 5 });
    for (const bad of [null, 'x', 5, {}, { ev: 'opened', rec: 'a', ok: true }, { ev: 'opened', rec: 1, ok: 'yes' }, { ev: 'chunk', rec: 1, ts: -1, key: true, data: new Uint8Array(3) }, { ev: 'chunk', rec: 1, ts: 5, key: true, data: [1, 2] }, { ev: 'chunk', rec: 1, ts: 5, key: true, data: new Uint8Array(0) }, { ev: 'flushed', rec: 1 }, { ev: 'nothing', rec: 1 }]) {
      expect(parseEncoderEvent(bad)).toBeNull();
    }
    expect(parseEncoderEvent({ ev: 'error', rec: 2, message: 'x'.repeat(1000) })).toMatchObject({ message: 'x'.repeat(300) });
  });
});

describe('one recording on the shared window', () => {
  it('makes the window at the first recording, waits for the page, opens an encoder of the picture\'s size and shares the window with the next one', async () => {
    const w = world();
    const host = createEncoderHost(w.env);
    expect(host.windowOpen()).toBe(false);
    const a = host.sink();
    const b = host.sink();
    expect(await a.open(1280, 800)).toBe(true);
    expect(await b.open(640, 400)).toBe(true);
    expect(w.created).toHaveLength(1);
    expect(w.sent.filter((c) => c.op === 'open')).toEqual([
      { op: 'open', rec: 1, width: 1280, height: 800, bitrate: RECORDING_BITRATE, framerate: 1 },
      { op: 'open', rec: 2, width: 640, height: 400, bitrate: RECORDING_BITRATE, framerate: 1 },
    ]);
  });

  it('sends a frame with its time, its key flag and its pixels, and counts the bytes that come back', async () => {
    const w = world();
    const sink = createEncoderHost(w.env).sink();
    await sink.open(8, 4);
    const frame = frameOf(5);
    expect(sink.feed(0, frame, true)).toBe(true);
    const cmd = w.sent.find((c) => c.op === 'frame');
    expect(cmd).toMatchObject({ op: 'frame', rec: 1, ts: 0, key: true, width: 8, height: 4 });
    expect(cmd && cmd.op === 'frame' && Buffer.from(cmd.data).equals(frame.data)).toBe(true);
    w.say(chunkOf(1, 0, true, 40));
    w.say(chunkOf(1, 1000, false, 25));
    expect(sink.bytes()).toBe(65);
  });

  it('does not take a frame while four are still in the encoder, and takes one again as they come back or the page drops them', async () => {
    const w = world();
    const sink = createEncoderHost(w.env).sink();
    await sink.open(8, 4);
    for (let i = 0; i < 4; i++) expect(sink.feed(i * 1000, frameOf(i), i === 0)).toBe(true);
    expect(sink.feed(5000, frameOf(9), false)).toBe(false);
    expect(sink.failed()).toBe(false);
    w.say(chunkOf(1, 0, true));
    expect(sink.feed(5000, frameOf(9), false)).toBe(true);
    expect(sink.feed(6000, frameOf(8), false)).toBe(false);
    w.say({ ev: 'dropped', rec: 1 });
    expect(sink.feed(6000, frameOf(8), false)).toBe(true);
  });

  it('flushes at the end and gives every frame in order, then closes the encoder and the window after a while without a recording', async () => {
    const w = world();
    const host = createEncoderHost(w.env);
    const sink = host.sink();
    await sink.open(8, 4);
    sink.feed(0, frameOf(1), true);
    sink.feed(2000, frameOf(2), false);
    w.say(chunkOf(1, 0, true));
    w.say(chunkOf(1, 2000, false));
    const chunks = await sink.close();
    expect(chunks?.map((c) => [c.ts, c.key])).toEqual([[0, true], [2000, false]]);
    expect(w.sent.map((c) => c.op)).toEqual(['open', 'frame', 'frame', 'flush', 'close']);
    expect(host.windowOpen()).toBe(true);
    expect(w.created[0].destroyed).toBe(false);
    w.fire(30_000);
    expect(w.created[0].destroyed).toBe(true);
    expect(host.windowOpen()).toBe(false);
    expect(w.listening()).toBe(0);
  });

  it('keeps the window when another recording starts during the wait to close it', async () => {
    const w = world();
    const host = createEncoderHost(w.env);
    const a = host.sink();
    await a.open(8, 4);
    a.feed(0, frameOf(1), true);
    w.say(chunkOf(1, 0, true));
    await a.close();
    const b = host.sink();
    await b.open(8, 4);
    w.fire(30_000);
    expect(w.created[0].destroyed).toBe(false);
    expect(w.created).toHaveLength(1);
  });

  it('is gone from the window when aborted, and the window waits for the next recording like after an end', async () => {
    const w = world();
    const host = createEncoderHost(w.env);
    const sink = host.sink();
    await sink.open(8, 4);
    sink.abort();
    expect(w.sent.at(-1)).toEqual({ op: 'close', rec: 1 });
    expect(sink.feed(0, frameOf(1), true)).toBe(false);
    expect(await sink.close()).toBeNull();
    w.fire(30_000);
    expect(host.windowOpen()).toBe(false);
  });
});

describe('what comes from anywhere but the window', () => {
  it('is ignored: a "ready" from another sender is not believed, so a page that only the others speak for never opens', async () => {
    const w = world({ autoReady: false });
    const host = createEncoderHost(w.env);
    const sink = host.sink();
    const opening = sink.open(8, 4);
    await Promise.resolve();
    w.say({ ev: 'ready' }, 1);
    w.say({ ev: 'ready' }, 2);
    w.fire(10_000);
    expect(await opening).toBe(false);
    expect(w.sent).toEqual([]);
  });

  it('is ignored: a chunk or an error from another sender changes nothing', async () => {
    const w = world();
    const sink = createEncoderHost(w.env).sink();
    await sink.open(8, 4);
    sink.feed(0, frameOf(1), true);
    w.say(chunkOf(1, 0, true, 999), 1);
    w.say({ ev: 'error', rec: 1, message: 'x' }, 2);
    expect(sink.bytes()).toBe(0);
    expect(sink.failed()).toBe(false);
  });

  it('is ignored when it is about a recording that does not exist', async () => {
    const w = world();
    const sink = createEncoderHost(w.env).sink();
    await sink.open(8, 4);
    w.say(chunkOf(99, 0, true, 500));
    w.say('garbage');
    expect(sink.bytes()).toBe(0);
  });
});

describe('when the page is slow, refuses or dies', () => {
  it('gives up on a page that never says it is ready, closes the window and says the recording cannot start', async () => {
    const w = world({ autoReady: false });
    const host = createEncoderHost(w.env);
    const sink = host.sink();
    const opening = sink.open(8, 4);
    await Promise.resolve();
    w.fire(10_000);
    expect(await opening).toBe(false);
    expect(sink.failed()).toBe(true);
    expect(w.created[0].destroyed).toBe(true);
    expect(host.windowOpen()).toBe(false);
  });

  it('says so when the page cannot make an encoder for the size, and when it does not answer', async () => {
    const refusing = world({ page: (cmd, say) => cmd.op === 'open' && queueMicrotask(() => say({ ev: 'opened', rec: cmd.rec, ok: false })) });
    const a = createEncoderHost(refusing.env).sink();
    expect(await a.open(8, 4)).toBe(false);
    expect(a.failed()).toBe(true);

    const silent = world({ page: () => undefined });
    const b = createEncoderHost(silent.env).sink();
    const opening = b.open(8, 4);
    await new Promise((r) => setTimeout(r, 0));
    silent.fire(5000);
    expect(await opening).toBe(false);
  });

  it('keeps what was encoded when the encoder breaks halfway, and takes nothing more', async () => {
    const w = world();
    const sink = createEncoderHost(w.env).sink();
    await sink.open(8, 4);
    sink.feed(0, frameOf(1), true);
    w.say(chunkOf(1, 0, true));
    w.say({ ev: 'error', rec: 1, message: 'encoder error' });
    expect(sink.failed()).toBe(true);
    expect(sink.feed(1000, frameOf(2), false)).toBe(false);
    const chunks = await sink.close();
    expect(chunks).toHaveLength(1);
    // A flush is not even asked of an encoder that failed.
    expect(w.sent.some((c) => c.op === 'flush')).toBe(false);
  });

  it('gives the frames that came out when the flush does not finish in time, and nothing when none did', async () => {
    const w = world({ page: (cmd, say) => cmd.op === 'open' && queueMicrotask(() => say({ ev: 'opened', rec: cmd.rec, ok: true })) });
    const host = createEncoderHost(w.env);
    const a = host.sink();
    await a.open(8, 4);
    a.feed(0, frameOf(1), true);
    w.say(chunkOf(1, 0, true));
    const closing = a.close();
    await new Promise((r) => setTimeout(r, 0));
    w.fire(10_000);
    expect(await closing).toHaveLength(1);

    const b = host.sink();
    await b.open(8, 4);
    const empty = b.close();
    await new Promise((r) => setTimeout(r, 0));
    w.fire(10_000);
    expect(await empty).toBeNull();
  });

  it('fails every recording when the window dies, and the next one makes a new window that a late word from the old one cannot close', async () => {
    const w = world();
    const host = createEncoderHost(w.env);
    const sink = host.sink();
    await sink.open(8, 4);
    const old = w.created[0];
    old.gone();
    expect(sink.failed()).toBe(true);
    expect(old.destroyed).toBe(true);
    expect(host.windowOpen()).toBe(false);

    const next = host.sink();
    expect(await next.open(8, 4)).toBe(true);
    expect(w.created).toHaveLength(2);
    // The first window's last words arrive after the second one is up.
    old.gone();
    expect(host.windowOpen()).toBe(true);
    expect(w.created[1].destroyed).toBe(false);
    expect(next.failed()).toBe(false);
  });

  it('closes the window and fails what runs when the app shuts down', async () => {
    const w = world();
    const host = createEncoderHost(w.env);
    const sink = host.sink();
    await sink.open(8, 4);
    host.shutdown();
    expect(sink.failed()).toBe(true);
    expect(w.created[0].destroyed).toBe(true);
    expect(w.listening()).toBe(0);
  });
});
