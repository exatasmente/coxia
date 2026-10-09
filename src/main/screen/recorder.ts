import {
  RECORDING_KEY_MS,
  RECORDING_MARK_MIN_MS,
  RECORDING_MARKS_MAX,
  RECORDING_MAX_BYTES,
  RECORDING_MAX_MS,
  RECORDING_MIN_GAP_MS,
  RECORDING_RESERVE_BYTES,
  type RecordingMeta,
} from '../../shared/screen';
import type { RawFrame } from './frame';
import { type WebmChunk, muxWebm } from './webm';

// The recording of a stage's screen: the logic between the hub (which reads the screen) and the encoder (which turns frames into VP8). It feeds only a frame that
// changed, at most about one a second, gives each frame its time on the stage's own clock (so a still stretch is a gap between two times, not a cut), keeps the person's
// intervals as marks and stops at its limits. It talks to a sink and never to Electron, so all of it is tested with a fake one.

/** Where the frames go: the encoder in the helper window. */
export interface RecorderSink {
  /** Starts an encoder for pictures of this size; false when it cannot (the video is not recorded). */
  open(width: number, height: number): Promise<boolean>;
  /** Hands a frame to the encoder at `ts` ms; false when it was not taken (the encoder is behind, or failed: see `failed`). The frame is copied at once. */
  feed(ts: number, frame: RawFrame, key: boolean): boolean;
  /** The encoded bytes that came back so far. */
  bytes(): number;
  /** The encoder broke: nothing more will be taken. */
  failed(): boolean;
  /** Flushes the encoder and gives every encoded frame, in order; null when it could not. */
  close(): Promise<WebmChunk[] | null>;
  /** Throws everything away without output. */
  abort(): void;
}

/** What a recording ended as: the file and what the player needs to know of it, or why there is none. */
export type RecordingOutcome = { ok: true; bytes: Uint8Array; meta: RecordingMeta } | { ok: false; reason: 'no-frame' | 'encoder' };

/** Why the recording stopped before the stage did. */
export type RecorderStop = 'size' | 'time' | 'encoder' | 'resized';

/** What became of a frame offered: fed; the same picture as the last fed; too soon after the last; the encoder was behind; or the recording is over. */
export type AddResult = 'fed' | 'same' | 'wait' | 'dropped' | 'stopped';

export interface Recorder {
  readonly state: 'on' | 'stopped';
  readonly stoppedBy: RecorderStop | null;
  /** Offers the screen as it was at `at` (ms on the stage's clock); `hash` tells it from the last one fed. */
  add(frame: RawFrame, hash: string, at: number): Promise<AddResult>;
  /** The person used the screen from `fromAt` to `toAt` (the same clock). */
  mark(fromAt: number, toAt: number): void;
  /** Ends the recording at `stopAt` and builds the file. Idempotent. */
  finish(stopAt: number): Promise<RecordingOutcome>;
  /** Drops everything without a file. */
  abort(): void;
}

export interface RecorderLimits {
  bytes: number;
  ms: number;
  reserve: number;
}

export function createRecorder(deps: { sink: RecorderSink; limits?: Partial<RecorderLimits> }): Recorder {
  const sink = deps.sink;
  const limits: RecorderLimits = { bytes: RECORDING_MAX_BYTES, ms: RECORDING_MAX_MS, reserve: RECORDING_RESERVE_BYTES, ...deps.limits };
  let start: number | null = null;
  let size: { width: number; height: number } | null = null;
  let lastTs = -1;
  let lastKeyTs: number | null = null;
  let lastHash: string | null = null;
  let stopped: RecorderStop | null = null;
  let stoppedAt = 0;
  let finished: Promise<RecordingOutcome> | null = null;
  // Set when the end starts being built: the offers queued before it are still taken.
  let ending = false;
  let aborted = false;
  const marks: { from: number; to: number }[] = [];
  // Offers and the end are done one after the other: a stage that ends while a frame is being handed over waits for it.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const stop = (why: RecorderStop, at: number): void => {
    stopped ??= why;
    stoppedAt = at;
  };

  async function offer(frame: RawFrame, hash: string, at: number): Promise<AddResult> {
    if (stopped || ending || aborted) return 'stopped';
    if (start === null) {
      size = { width: frame.width, height: frame.height };
      if (!(await sink.open(frame.width, frame.height))) {
        stop('encoder', at);
        return 'stopped';
      }
      start = at;
    }
    const t = Math.max(0, at - start);
    // The time limit holds also for a screen that never changes.
    if (t > limits.ms) {
      stop('time', at);
      return 'stopped';
    }
    // The encoder is configured for one size; a picture of another (the display was resized) cannot be fed, so the recording ends there, with what came before.
    if (size && (frame.width !== size.width || frame.height !== size.height)) {
      stop('resized', at);
      return 'stopped';
    }
    if (hash === lastHash) return 'same';
    if (lastTs >= 0 && t - lastTs < RECORDING_MIN_GAP_MS) return 'wait';
    if (sink.bytes() >= limits.bytes - limits.reserve) {
      stop('size', at);
      return 'stopped';
    }
    const ts = Math.max(t, lastTs + 1);
    const key = lastKeyTs === null || ts - lastKeyTs >= RECORDING_KEY_MS;
    if (!sink.feed(ts, frame, key)) {
      if (sink.failed()) {
        stop('encoder', at);
        return 'stopped';
      }
      return 'dropped';
    }
    lastTs = ts;
    if (key) lastKeyTs = ts;
    lastHash = hash;
    return 'fed';
  }

  async function build(stopAt: number): Promise<RecordingOutcome> {
    ending = true;
    if (aborted) return { ok: false, reason: 'no-frame' };
    if (start === null || !size) {
      sink.abort();
      return { ok: false, reason: stopped === 'encoder' ? 'encoder' : 'no-frame' };
    }
    const chunks = await sink.close();
    if (!chunks) return { ok: false, reason: 'encoder' };
    if (chunks.length === 0) return { ok: false, reason: 'no-frame' };
    const last = chunks[chunks.length - 1].ts;
    const ended = stopped === 'time' ? limits.ms : stopped ? stoppedAt - start : stopAt - start;
    let kept = chunks;
    let truncated: 'size' | 'time' | undefined = stopped === 'size' || stopped === 'time' ? stopped : undefined;
    let duration = Math.min(limits.ms, Math.max(Math.round(ended), last + 1));
    let bytes = muxWebm(kept, { width: size.width, height: size.height, durationMs: duration });
    // The reserve covers the container and the frames still in the encoder; if it did not, the end of the video goes rather than the file being refused.
    while (bytes.length > limits.bytes && kept.length > 1) {
      kept = kept.slice(0, Math.max(1, Math.floor(kept.length * 0.9)));
      truncated = 'size';
      duration = kept[kept.length - 1].ts + 1000;
      bytes = muxWebm(kept, { width: size.width, height: size.height, durationMs: duration });
    }
    const ranges: { fromMs: number; toMs: number }[] = [];
    for (const m of marks) {
      const fromMs = Math.min(duration, Math.max(0, Math.round(m.from - start)));
      const toMs = Math.min(duration, Math.max(0, Math.round(Math.max(m.to, m.from + RECORDING_MARK_MIN_MS) - start)));
      if (toMs > fromMs) ranges.push({ fromMs, toMs });
    }
    ranges.sort((a, b) => a.fromMs - b.fromMs);
    return { ok: true, bytes, meta: { durationMs: duration, width: size.width, height: size.height, ...(truncated ? { truncated } : {}), marks: ranges.slice(0, RECORDING_MARKS_MAX) } };
  }

  return {
    get state() {
      return stopped ? 'stopped' : 'on';
    },
    get stoppedBy() {
      return stopped;
    },
    add: (frame, hash, at) => serial(() => offer(frame, hash, at)),
    mark(fromAt, toAt) {
      if (finished || aborted || toAt < fromAt) return;
      marks.push({ from: fromAt, to: toAt });
    },
    finish(stopAt) {
      finished ??= serial(() => build(stopAt)).catch((): RecordingOutcome => ({ ok: false, reason: 'encoder' }));
      return finished;
    },
    abort() {
      if (aborted || finished) return;
      aborted = true;
      sink.abort();
    },
  };
}
