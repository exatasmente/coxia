import {
  RECORDING_CUTS_MAX,
  RECORDING_IDLE_GAP_MS,
  RECORDING_IDLE_PAUSE_MS,
  RECORDING_KEY_MS,
  RECORDING_MARK_MIN_MS,
  RECORDING_MARKS_MAX,
  RECORDING_MAX_BYTES,
  RECORDING_MAX_MS,
  RECORDING_MIN_GAP_MS,
  RECORDING_RESERVE_BYTES,
  type RecordingCut,
  type RecordingMeta,
  mediaAtReal,
  realAtMedia,
} from '../../shared/screen';
import type { RawFrame } from './frame';
import { type WebmChunk, muxWebm } from './webm';

// The recording of a stage's screen: the logic between the hub (which reads the screen) and the encoder (which turns frames into VP8). It feeds only a frame that
// changed, at most about one a second, and keeps two clocks: the stage's (real) and the video's (media). They run together, except that a gap between two fed frames
// longer than `RECORDING_IDLE_GAP_MS` plays as a pause of `RECORDING_IDLE_PAUSE_MS` and is written down as a cut, so the video is about what happened and the cuts say
// when (#176, which overrides the still stretch of #157). It keeps the person's intervals as marks, converted to the video's clock, and stops at its limits. It talks
// to a sink and never to Electron, so all of it is tested with a fake one.

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

/** What a recording ended as: the file and what the player needs to know of it, or why there is none (`unused`: no window was ever on the screen; the hub tells it). */
export type RecordingOutcome = { ok: true; bytes: Uint8Array; meta: RecordingMeta } | { ok: false; reason: 'no-frame' | 'unused' | 'encoder' };

/** Why the recording stopped before the stage did. */
export type RecorderStop = 'size' | 'time' | 'encoder' | 'resized';

/** What became of a frame offered: fed; the same picture as the last fed; too soon after the last; the encoder was behind; or the recording is over. */
export type AddResult = 'fed' | 'same' | 'wait' | 'dropped' | 'stopped';

export interface Recorder {
  readonly state: 'on' | 'stopped';
  readonly stoppedBy: RecorderStop | null;
  /** Offers the screen as it was at `at` (ms on the stage's clock); `hash` tells it from the last one fed. */
  add(frame: RawFrame, hash: string, at: number): Promise<AddResult>;
  /** The person used the screen from `fromAt` to `toAt` (the same clock); `handoff`: the interval of a hand-off (#178), kept apart in the file. */
  mark(fromAt: number, toAt: number, kind?: 'handoff'): void;
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

/** `openedAt` is when the screen opened (the same clock as the offers): the meta says how long after it the first frame came. */
export function createRecorder(deps: { sink: RecorderSink; limits?: Partial<RecorderLimits>; openedAt?: number }): Recorder {
  const sink = deps.sink;
  const limits: RecorderLimits = { bytes: RECORDING_MAX_BYTES, ms: RECORDING_MAX_MS, reserve: RECORDING_RESERVE_BYTES, ...deps.limits };
  // The stage's time of the first frame that was fed: set only when the encoder took one, so a dropped first frame does not leave the video starting late.
  let start: number | null = null;
  let opened = false;
  let size: { width: number; height: number } | null = null;
  let lastTs = -1;
  // The stage's time of the last frame fed (from the start), what has been cut out so far and where.
  let lastReal: number | null = null;
  let skippedTotal = 0;
  const cuts: RecordingCut[] = [];
  let lastKeyTs: number | null = null;
  let lastHash: string | null = null;
  let stopped: RecorderStop | null = null;
  let stoppedAt = 0;
  let finished: Promise<RecordingOutcome> | null = null;
  // Set when the end starts being built: the offers queued before it are still taken.
  let ending = false;
  let aborted = false;
  const marks: { from: number; to: number; kind?: 'handoff' }[] = [];
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
    if (!opened) {
      size = { width: frame.width, height: frame.height };
      if (!(await sink.open(frame.width, frame.height))) {
        stop('encoder', at);
        return 'stopped';
      }
      opened = true;
    }
    const origin = start ?? at;
    const real = Math.max(0, at - origin);
    // The encoder is configured for one size; a picture of another (the display was resized) cannot be fed, so the recording ends there, with what came before.
    if (size && (frame.width !== size.width || frame.height !== size.height)) {
      stop('resized', at);
      return 'stopped';
    }
    if (hash === lastHash) return 'same';
    // Only a frame that is fed moves the video's clock: a picture that stays the same for an hour costs nothing, and the next change closes the gap.
    const gap = lastReal === null ? 0 : real - lastReal;
    const cut = gap > RECORDING_IDLE_GAP_MS && cuts.length < RECORDING_CUTS_MAX ? gap - RECORDING_IDLE_PAUSE_MS : 0;
    const t = real - skippedTotal - cut;
    if (lastTs >= 0 && t - lastTs < RECORDING_MIN_GAP_MS) return 'wait';
    // The time limit is on the video's length.
    if (t > limits.ms) {
      stop('time', at);
      return 'stopped';
    }
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
    start ??= at;
    lastTs = ts;
    lastReal = real;
    if (cut > 0) {
      skippedTotal += cut;
      cuts.push({ atMs: ts, skippedMs: cut });
    }
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
    const kept0 = [...cuts];
    let kept = chunks;
    let truncated: 'size' | 'time' | undefined = stopped === 'size' || stopped === 'time' ? stopped : undefined;
    // The video ends where the recording did: a limit stops it there, and the stage's time after the last frame is shortened like any other idle stretch.
    let duration: number;
    if (stopped === 'time') duration = limits.ms;
    else {
      const endReal = Math.max(lastReal ?? 0, (stopped ? stoppedAt : stopAt) - start);
      const tail = endReal - (lastReal ?? 0);
      if (tail > RECORDING_IDLE_GAP_MS && kept0.length < RECORDING_CUTS_MAX) {
        duration = lastTs + RECORDING_IDLE_PAUSE_MS;
        kept0.push({ atMs: duration, skippedMs: tail - RECORDING_IDLE_PAUSE_MS });
      } else duration = lastTs + tail;
    }
    duration = Math.min(limits.ms, Math.max(Math.round(duration), last + 1));
    let bytes = muxWebm(kept, { width: size.width, height: size.height, durationMs: duration });
    // The reserve covers the container and the frames still in the encoder; if it did not, the end of the video goes rather than the file being refused.
    while (bytes.length > limits.bytes && kept.length > 1) {
      kept = kept.slice(0, Math.max(1, Math.floor(kept.length * 0.9)));
      truncated = 'size';
      duration = kept[kept.length - 1].ts + 1000;
      bytes = muxWebm(kept, { width: size.width, height: size.height, durationMs: duration });
    }
    const finalCuts = kept0.filter((c) => c.atMs <= duration);
    const realMs = realAtMedia(finalCuts, duration);
    // The marks are the stage's times; the strip is the video's.
    const ranges: { fromMs: number; toMs: number; kind?: 'handoff' }[] = [];
    for (const m of marks) {
      const realFrom = m.from - start;
      const realTo = Math.max(m.to, m.from + RECORDING_MARK_MIN_MS) - start;
      // Before the first frame there is no video to point to; after the end there is none either.
      if (realTo <= 0 || realFrom > realMs) continue;
      let fromMs = Math.min(duration, Math.max(0, Math.round(mediaAtReal(finalCuts, realFrom))));
      let toMs = Math.min(duration, Math.max(0, Math.round(mediaAtReal(finalCuts, realTo))));
      // A mark that fell wholly into a stretch that was cut is kept, at the cut: the evidence never loses what the person did.
      if (toMs <= fromMs && duration > 0) {
        toMs = Math.min(duration, fromMs + RECORDING_MARK_MIN_MS);
        if (toMs <= fromMs) fromMs = Math.max(0, toMs - RECORDING_MARK_MIN_MS);
      }
      if (toMs > fromMs) ranges.push({ fromMs, toMs, ...(m.kind ? { kind: m.kind } : {}) });
    }
    // A hand-off interval is never the one a crowd of marks pushes out: the cap drops the others first.
    const handoffs = ranges.filter((r) => r.kind === 'handoff');
    const keptMarks = ranges.length > RECORDING_MARKS_MAX ? [...handoffs, ...ranges.filter((r) => r.kind !== 'handoff').slice(0, Math.max(0, RECORDING_MARKS_MAX - handoffs.length))] : ranges;
    keptMarks.sort((a, b) => a.fromMs - b.fromMs);
    return {
      ok: true,
      bytes,
      meta: { durationMs: duration, width: size.width, height: size.height, ...(truncated ? { truncated } : {}), ...(deps.openedAt !== undefined ? { startedAfterMs: Math.max(0, Math.round(start - deps.openedAt)) } : {}), marks: keptMarks.slice(0, RECORDING_MARKS_MAX), ...(handoffs.length ? { handoff: true as const } : {}), ...(finalCuts.length ? { realMs, cuts: finalCuts } : {}) },
    };
  }

  return {
    get state() {
      return stopped ? 'stopped' : 'on';
    },
    get stoppedBy() {
      return stopped;
    },
    add: (frame, hash, at) => serial(() => offer(frame, hash, at)),
    mark(fromAt, toAt, kind) {
      if (finished || aborted || toAt < fromAt) return;
      marks.push({ from: fromAt, to: toAt, ...(kind ? { kind } : {}) });
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
