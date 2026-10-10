import { RECORDING_BITRATE } from '../../shared/screen';
import type { RecorderSink } from './recorder';
import type { WebmChunk } from './webm';

// The encoder of the screen recording: one shared hidden window runs WebCodecs' `VideoEncoder` (VP8) for every recording, and this is the main process's side of the
// talk with it. It owns no Electron object: the window, the channel and the timers come in as `EncoderEnv`, and the tests give fakes. Commands go to the page as
// messages; what comes back is checked here, and only from the window this host made (the sender's id).

export type EncoderCommand =
  | { op: 'open'; rec: number; width: number; height: number; bitrate: number; framerate: number }
  | { op: 'frame'; rec: number; ts: number; key: boolean; width: number; height: number; data: Uint8Array }
  | { op: 'flush'; rec: number }
  | { op: 'close'; rec: number };

export type EncoderEvent =
  | { ev: 'ready' }
  | { ev: 'opened'; rec: number; ok: boolean }
  | { ev: 'chunk'; rec: number; ts: number; key: boolean; data: Uint8Array }
  | { ev: 'dropped'; rec: number }
  | { ev: 'flushed'; rec: number; ok: boolean }
  | { ev: 'error'; rec: number; message: string };

export interface EncoderWindow {
  /** The id the window's messages come from. */
  readonly id: number;
  send(command: EncoderCommand): void;
  destroy(): void;
}

export interface EncoderEnv {
  /** Makes the hidden window and loads the page; `gone` is told when its process dies. */
  create(gone: () => void): EncoderWindow;
  /** Listens to what the page sends; `senderId` is the window it came from. Returns what stops listening. */
  listen(handler: (senderId: number, raw: unknown) => void): () => void;
  /** Calls `fn` after `ms`; returns what cancels it. */
  schedule(ms: number, fn: () => void): () => void;
}

export interface EncoderHostOptions {
  /** How long the window lives after the last recording ended. */
  idleMs?: number;
  /** Waits for the page to say it is ready, for an encoder to start and for it to flush. */
  readyMs?: number;
  openMs?: number;
  flushMs?: number;
  /** Frames handed to the page and not yet encoded: past it a frame is not taken. */
  inflightMax?: number;
}

export interface EncoderHost {
  /** A sink for one recording on the shared window. */
  sink(): RecorderSink;
  /** The window is open (for the tests and the idle rule). */
  windowOpen(): boolean;
  /** Closes the window and fails every recording that was running. */
  shutdown(): void;
}

const isUint8 = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0x7fffffff;

/** Reads what the page sent into an event, or null when it is not one (a message that is not ours, or malformed). */
export function parseEncoderEvent(raw: unknown): EncoderEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.ev === 'ready') return { ev: 'ready' };
  if (!isInt(m.rec)) return null;
  if (m.ev === 'opened' && typeof m.ok === 'boolean') return { ev: 'opened', rec: m.rec, ok: m.ok };
  if (m.ev === 'flushed' && typeof m.ok === 'boolean') return { ev: 'flushed', rec: m.rec, ok: m.ok };
  if (m.ev === 'dropped') return { ev: 'dropped', rec: m.rec };
  if (m.ev === 'error') return { ev: 'error', rec: m.rec, message: typeof m.message === 'string' ? m.message.slice(0, 300) : '' };
  if (m.ev === 'chunk' && isInt(m.ts) && typeof m.key === 'boolean' && isUint8(m.data) && m.data.length > 0 && m.data.length <= 64 * 1024 * 1024) return { ev: 'chunk', rec: m.rec, ts: m.ts, key: m.key, data: m.data };
  return null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface Rec {
  id: number;
  opened: boolean;
  failed: boolean;
  closed: boolean;
  chunks: WebmChunk[];
  bytes: number;
  inflight: number;
  opening: Deferred<boolean> | null;
  flushing: Deferred<boolean> | null;
}

export function createEncoderHost(env: EncoderEnv, options: EncoderHostOptions = {}): EncoderHost {
  const idleMs = options.idleMs ?? 30_000;
  const readyMs = options.readyMs ?? 10_000;
  const openMs = options.openMs ?? 5_000;
  const flushMs = options.flushMs ?? 10_000;
  const inflightMax = options.inflightMax ?? 4;
  let win: EncoderWindow | null = null;
  let ready: Deferred<boolean> | null = null;
  let unlisten: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;
  let next = 1;
  // A window that dies late must not take a newer one with it.
  let epoch = 0;
  const recs = new Map<number, Rec>();

  const failAll = (): void => {
    for (const r of recs.values()) {
      r.failed = true;
      r.opening?.resolve(false);
      r.flushing?.resolve(false);
    }
  };

  const destroyWindow = (): void => {
    cancelIdle?.();
    cancelIdle = null;
    unlisten?.();
    unlisten = null;
    const w = win;
    win = null;
    epoch++;
    const waiting = ready;
    ready = null;
    waiting?.resolve(false);
    try {
      w?.destroy();
    } catch {
      // A window already gone.
    }
  };

  const onEvent = (senderId: number, raw: unknown): void => {
    // Only the window this host made may speak: the channel is not served to the main window or to a paired browser, and the id is checked anyway.
    if (!win || senderId !== win.id) return;
    const e = parseEncoderEvent(raw);
    if (!e) return;
    if (e.ev === 'ready') {
      ready?.resolve(true);
      return;
    }
    const r = recs.get(e.rec);
    if (!r) return;
    if (e.ev === 'opened') {
      r.opened = e.ok;
      if (!e.ok) r.failed = true;
      r.opening?.resolve(e.ok);
    } else if (e.ev === 'chunk') {
      r.inflight = Math.max(0, r.inflight - 1);
      r.chunks.push({ ts: e.ts, key: e.key, data: e.data });
      r.bytes += e.data.length;
    } else if (e.ev === 'dropped') {
      r.inflight = Math.max(0, r.inflight - 1);
    } else if (e.ev === 'flushed') {
      if (!e.ok) r.failed = true;
      r.flushing?.resolve(e.ok);
    } else if (e.ev === 'error') {
      r.failed = true;
      r.opening?.resolve(false);
      r.flushing?.resolve(false);
    }
  };

  async function ensureWindow(): Promise<EncoderWindow | null> {
    cancelIdle?.();
    cancelIdle = null;
    if (!win) {
      ready = deferred<boolean>();
      unlisten = env.listen(onEvent);
      const mine = ++epoch;
      try {
        win = env.create(() => {
          if (epoch !== mine) return;
          // The page's process died: the recordings that were running cannot go on; a new one makes a new window.
          failAll();
          destroyWindow();
        });
      } catch {
        destroyWindow();
        return null;
      }
    }
    const made = win;
    const waiting = ready;
    if (!waiting) return null;
    const cancel = env.schedule(readyMs, () => waiting.resolve(false));
    const ok = await waiting.promise;
    cancel();
    if (!ok || win !== made) {
      if (win === made) {
        failAll();
        destroyWindow();
      }
      return null;
    }
    return made;
  }

  const idleIfDone = (): void => {
    if (recs.size > 0 || !win || cancelIdle) return;
    cancelIdle = env.schedule(idleMs, () => {
      cancelIdle = null;
      if (recs.size === 0) destroyWindow();
    });
  };

  const release = (r: Rec): void => {
    r.closed = true;
    recs.delete(r.id);
    try {
      win?.send({ op: 'close', rec: r.id });
    } catch {
      // The window is gone.
    }
    idleIfDone();
  };

  return {
    windowOpen: () => win !== null,
    shutdown() {
      failAll();
      recs.clear();
      destroyWindow();
    },
    sink() {
      const r: Rec = { id: next++, opened: false, failed: false, closed: false, chunks: [], bytes: 0, inflight: 0, opening: null, flushing: null };
      return {
        async open(width, height) {
          if (r.closed || r.failed) return false;
          recs.set(r.id, r);
          const w = await ensureWindow();
          if (!w || r.closed) {
            r.failed = true;
            release(r);
            return false;
          }
          r.opening = deferred<boolean>();
          const waiting = r.opening;
          const cancel = env.schedule(openMs, () => waiting.resolve(false));
          try {
            w.send({ op: 'open', rec: r.id, width, height, bitrate: RECORDING_BITRATE, framerate: 1 });
          } catch {
            r.failed = true;
            waiting.resolve(false);
          }
          const ok = await waiting.promise;
          cancel();
          r.opening = null;
          if (!ok) {
            r.failed = true;
            release(r);
          }
          return ok;
        },
        feed(ts, frame, key) {
          if (!win || r.closed || r.failed || !r.opened) return false;
          if (r.inflight >= inflightMax) return false;
          try {
            win.send({ op: 'frame', rec: r.id, ts, key, width: frame.width, height: frame.height, data: new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength) });
          } catch {
            r.failed = true;
            return false;
          }
          r.inflight++;
          return true;
        },
        bytes: () => r.bytes,
        failed: () => r.failed,
        async close() {
          if (r.closed) return null;
          let flushed = false;
          if (win && r.opened && !r.failed) {
            r.flushing = deferred<boolean>();
            const waiting = r.flushing;
            const cancel = env.schedule(flushMs, () => waiting.resolve(false));
            try {
              win.send({ op: 'flush', rec: r.id });
              flushed = await waiting.promise;
            } catch {
              flushed = false;
            }
            cancel();
            r.flushing = null;
          }
          const chunks = r.chunks;
          release(r);
          // A flush that did not finish still gives the frames that did come out: a video of what was encoded beats none.
          if (!flushed && chunks.length === 0) return null;
          return chunks;
        },
        abort() {
          if (!r.closed) release(r);
        },
      };
    },
  };
}
