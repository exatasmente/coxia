import { keyOf, parseKey } from '../../shared/browser';
import { type LiveScreen, RECORDING_INTERVAL_MS, RECORDING_MAX_BYTES, RECORDING_MAX_MS, SCREEN_INPUT_MAX, SCREEN_INPUT_PER_SECOND, type ScreenControlAnswer, type ScreenFrameAnswer, type ScreenInputAnswer, clampFrameWidth } from '../../shared/screen';
import { type FrameEncoder, type RawFrame, fixPad, hashFrame } from './frame';
import { type Recorder, type RecorderLimits, type RecorderSink, type RecordingOutcome, createRecorder } from './recorder';
import { type X11Connection, connectX11 } from './x11';
import { type TypedCollector, createTypedCollector } from './typedValues';
import { type InputPlanner, createInputPlanner } from './xinput';

// The registry of live screens: one per screen key (`run:<id>` for a working stage's display, `call:<thread>:<agent>` for an agent in a conversation), so a run can have its
// stage's screen and a mentioned agent's at once. Every method takes the key; a bare run id means `run:<id>`, as it did before keys existed.
// The hub holds the connection to that display, the latest frame (read only when a
// viewer asks, and never more than once in `FRAME_MIN_MS` however many viewers there are), the encoded pictures of it and the state the screen is handed out with.
// Frames never go through the app's broadcast: a viewer asks, and is answered alone. Nothing here reads the screen once a live screen has ended.
//
// The person's input (Take control, desktop only) goes through the same connection as the frames: it is not a command of the agent, so it is not queued behind the
// agent's commands, spends none of the stage's budget and is not in its log. The conversation says it in two ways: a line when control is taken and given back, and one
// line for each burst of input ("the person used the screen from ... to ...").
//
// The recording (the one thing that reads without a watcher, spec rule 14): while a screen is open a timer asks the display whether a window is mapped on it (#176) and,
// only if one is, looks at it through the same cache the viewer uses and offers the recorder the picture; it feeds the encoder only when the picture changed. A bare
// screen is not read for the recording, so the video begins when the screen is first used and a stage that never used it keeps none. A burst of the person's input is
// also a mark on the recording. The recording is built by `finish`, at the end of the stage, after one last look; a screen that is lost on the way (the display died) keeps its recorder
// aside until `finish` or `end`.
//
// A hand-off interval (#178) is the stretch in which the person holds the screen because the agent asked them to: it begins with `beginInterval`, before control is on,
// and ends with `endInterval` or with the screen. While it lasts a paired browser is answered `held` instead of a frame, the frame cache is dropped at both ends (and a read
// that crosses an end is not cached), the person's input is collected as typed text for the masker and not as bursts, control writes no line, and the recording keeps being
// fed, with the interval as one mark of kind `handoff`.

/** A frame read less than this long ago is reused: two viewers cost one read. */
export const FRAME_MIN_MS = 400;
/** Input this far apart (ms) is one burst of the person's use of the screen; a longer silence ends it. */
export const BURST_GAP_MS = 3000;
/** Reads that fail one after the other before the display is taken as gone. */
const FAILED_READS_MAX = 2;

export interface ScreenHubDeps {
  /** Linux only: the display, the sandbox and the socket exist nowhere else. Off, every call answers none. */
  enabled: boolean;
  encoder: FrameEncoder;
  now?: () => number;
  /** Opens the connection to a display's socket (tests give a fake). */
  connect?: (socket: string) => Promise<X11Connection>;
  /** A live screen opened or ended, or control was taken or given back: the lists refresh at once. It carries the screen's key and no pixels. */
  changed?: (key: string) => void;
  /** A line the app writes in the screen's conversation (a system line with a catalog code and its parameters); `stage` is empty outside a run's stage. */
  note?: (thread: string, stage: string, code: string, params: Record<string, string>) => void;
  /** The person used the screen (took control, gave it back, sent input): a screen that closes when idle starts its clock over. */
  activity?: (key: string) => void;
  /** A burst of the person's use of the screen ended: from when to when, in ms of the clock. What they did is not reported. */
  used?: (use: { key: string; agent: string; thread: string; from: number; to: number }) => void;
  /** Calls `fn` after `ms`; returns what cancels it. The burst of input and the recording's look at the screen are timed by it. */
  schedule?: (ms: number, fn: () => void) => () => void;
  /** The encoder a recording feeds; one per live screen. Without it nothing is recorded. */
  sink?: () => RecorderSink;
  /** The recording's limits (the tests make them small). */
  recordingLimits?: Partial<RecorderLimits>;
}

/** How a hand-off interval ended, and what the person typed in it (in memory, for the masker only). */
export interface IntervalEnd {
  from: number;
  to: number;
  typed: string[];
  why: 'back' | 'expired' | 'aborted' | 'lost' | 'ended';
}

/** Who hears of an interval: each delivered event of the person (it restarts the idle limit) and its end, once. */
export interface IntervalListener {
  input(): void;
  end(result: IntervalEnd): void;
}

export interface OpenScreen {
  /** `run:<id>` or `call:<thread>:<agent>`. */
  key: string;
  /** The conversation the screen's lines are written in. */
  thread: string;
  /** The stage, when the screen is a stage's; empty in a conversation. */
  stage: string;
  /** The agent that works the stage: the conversation's lines name it. */
  agent: string;
  /** The display's socket on this computer. */
  socket: string;
  kind: 'sandbox' | 'host';
}

export interface ScreenHub {
  /** Connects to the display and registers it; false when it cannot, when the key is not one, or when the key already has a live screen (the work goes on without one). Made before the agent's first command. */
  open(screen: OpenScreen): Promise<boolean>;
  /** What the screen is handed out with; null when the key has no live screen. */
  state(key: string): LiveScreen | null;
  /**
   * The latest frame of a live screen for a viewer that shows `since`, about `width` wide. Never throws. During a hand-off interval a `web` viewer (a paired browser, or the
   * run list) is answered `held` and nothing is read for it; only the `person` viewer, the desktop window of the one who holds the screen, gets pictures.
   */
  frame(key: string, since: number, width: number, viewer?: 'web' | 'person'): Promise<ScreenFrameAnswer>;
  /**
   * The hand-off interval begins: from here the screen is withheld from every `web` reader. It does not await, so the withholding is in place before the control that follows
   * it. False when the key has no live screen or already has an interval.
   */
  beginInterval(key: string, on: IntervalListener): boolean;
  /** The interval ends, whatever the reason: held keys are put up, control goes off without a line, the mark and the one line are written, then `on.end`. Idempotent. */
  endInterval(key: string, why: IntervalEnd['why']): void;
  /** A hand-off interval is open on the key. */
  held(key: string): boolean;
  /** The person takes control of the screen (desktop only) or gives it back; giving it back puts up every key and button still held. */
  control(key: string, on: boolean): Promise<ScreenControlAnswer>;
  /** The person's input: pointer, buttons, wheel and keys. Reaches the screen only while control is on. Never throws. */
  input(key: string, events: readonly unknown[]): Promise<ScreenInputAnswer>;
  /** The screen's end: stops everything, closes the connection and builds the recording. Null when the key had no live screen or nothing is recorded. Idempotent; nothing is read afterwards. */
  finish(key: string): Promise<RecordingOutcome | null>;
  /** Drops a live screen without keeping anything of it (the work failed before it started, the app is closing). Idempotent. */
  end(key: string): void;
  /** `end` for every screen. */
  endAll(): void;
}

interface Grabbed {
  seq: number;
  /** When it was read. */
  at: number;
  hash: string;
  frame: RawFrame;
  /** The hand-off epoch it was read under: a reader that is not the person takes only the current one. */
  epoch: number;
}

interface Live {
  key: string;
  thread: string;
  stage: string;
  agent: string;
  since: string;
  control: boolean;
  planner: Promise<InputPlanner> | null;
  /** The person's input in the last burst: when it began and when the last event came. */
  burst: { from: number; last: number } | null;
  cancelBurst: (() => void) | null;
  /** Events accepted in the current second, for the limit per second. */
  rate: { at: number; n: number };
  conn: X11Connection;
  /** The recording of this screen; null when nothing is recorded (no encoder) or once it was handed to `finish`. */
  rec: Recorder | null;
  cancelTick: (() => void) | null;
  /** The conversation was told that the recording stopped. */
  stopSaid: boolean;
  /** A window was mapped on the screen at some look: tells a screen that was never used from one whose pictures could not be read. */
  sawWindow: boolean;
  /** When the look that began the present stretch of looks with a window mapped was made; null while the screen is bare. A picture read before it may predate the window. */
  usedSince: number | null;
  ended: boolean;
  grabbed: Grabbed | null;
  reading: Promise<Grabbed | null> | null;
  /** When the read under way began. */
  readingFrom: number;
  /** The epoch the read under way began under. */
  readingEpoch: number;
  failed: number;
  /** The pictures made of `grabbed`, by width: one per (frame, width), dropped when the screen changes. */
  pictures: Map<number, { jpeg: Uint8Array; width: number; height: number }>;
  /** The last sequence number handed out: it never goes back when the cache is dropped, so a viewer holding an old one is never told a new picture is the same. */
  seq: number;
  /** Changes at both ends of a hand-off interval: a read that began under another epoch is returned to its caller and never cached. */
  epoch: number;
  interval: Interval | null;
}

interface Interval {
  from: number;
  typed: TypedCollector;
  on: IntervalListener;
  /** Control was on, from Take control, when the interval began: the conversation was told, so it is told it is over. */
  controlBefore: boolean;
  /** The end has begun (held keys are being put up). */
  ending: boolean;
}

/** The local time of day, as the person's clock shows it. */
function clockText(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export function createScreenHub(deps: ScreenHubDeps): ScreenHub {
  const now = deps.now ?? Date.now;
  const connect = deps.connect ?? ((socket: string) => connectX11(socket));
  const schedule = deps.schedule ?? ((ms, fn) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  });
  const lives = new Map<string, Live>();
  /** The recorders of screens that were lost (the display died) and wait for `finish`; dropped by `end`. */
  const lost = new Map<string, { rec: Recorder; sawWindow: boolean }>();
  const say = (live: Live, code: string, params: Record<string, string> = {}): void => {
    try {
      deps.note?.(live.thread, live.stage, code, { agent: live.agent, ...params });
    } catch {
      // A line that cannot be written is not the stage's to know.
    }
  };
  const touched = (key: string): void => {
    try {
      deps.activity?.(key);
    } catch {
      // A listener that fails is not the person's to know.
    }
  };
  const changed = (key: string): void => {
    try {
      deps.changed?.(key);
    } catch {
      // A listener that fails is not the stage's to know.
    }
  };

  /** One line for the burst of input that just ended, in the person's local time. */
  const closeBurst = (live: Live): void => {
    live.cancelBurst?.();
    live.cancelBurst = null;
    const b = live.burst;
    live.burst = null;
    if (!b) return;
    say(live, 'runner.screen.used', { from: clockText(b.from), to: clockText(b.last) });
    try {
      deps.used?.({ key: live.key, agent: live.agent, thread: live.thread, from: b.from, to: b.last });
    } catch {
      // The audit is not the person's to wait for.
    }
    // The same interval is a mark on the recording, so the evidence never credits the agent with what the person did.
    live.rec?.mark(b.from, b.last);
  };

  /**
   * The interval is over: the mark, the one line, the caches dropped, and the listener told last (it takes the typed text and may resolve a promise). Synchronous, so a
   * screen that goes away can close its interval without waiting. Control goes off here without a line of its own.
   */
  const closeInterval = (live: Live, why: IntervalEnd['why']): void => {
    const iv = live.interval;
    if (!iv) return;
    const to = now();
    live.interval = null;
    live.epoch++;
    live.grabbed = null;
    live.pictures.clear();
    live.control = false;
    if (iv.controlBefore) say(live, 'runner.screen.controlOff');
    say(live, 'runner.screen.handoffUsed', { from: clockText(iv.from), to: clockText(to) });
    live.rec?.mark(iv.from, to, 'handoff');
    const typed = iv.typed.values();
    iv.typed.clear();
    changed(live.key);
    try {
      iv.on.end({ from: iv.from, to, typed, why });
    } catch {
      // The listener's failure is not the screen's.
    }
  };

  /** Puts up every key and button the person's input left down. */
  const releaseHeld = async (live: Live): Promise<void> => {
    if (!live.planner) return;
    const planner = await live.planner;
    const up = planner.releaseAll();
    if (up.length) await live.conn.fakeInput(up);
  };

  const plannerOf = (live: Live): Promise<InputPlanner> => {
    live.planner ??= live.conn.keymap().then((map) => createInputPlanner(map ?? { first: 8, width: 1, syms: new Uint32Array(0) }, () => live.conn.size));
    return live.planner;
  };

  /** Ends the live screen of a key. `keep`: the screen was lost, not ended by the stage, so its recording is set aside for `finish`. */
  const drop = (key: string, keep: boolean): void => {
    const live = lives.get(key);
    if (!live) return;
    closeInterval(live, keep ? 'lost' : 'ended');
    if (keep) {
      closeBurst(live);
      // The screen is gone with control on: the conversation said it was taken, so it says it is over.
      if (live.control) {
        live.control = false;
        say(live, 'runner.screen.controlOff');
      }
    }
    live.ended = true;
    lives.delete(key);
    live.cancelBurst?.();
    live.cancelBurst = null;
    live.cancelTick?.();
    live.cancelTick = null;
    live.conn.close();
    const rec = live.rec;
    live.rec = null;
    if (rec) {
      if (keep) {
        lost.get(key)?.rec.abort();
        lost.set(key, { rec, sawWindow: live.sawWindow });
      } else rec.abort();
    }
    changed(key);
  };

  const end = (key: string): void => {
    drop(key, false);
    lost.get(key)?.rec.abort();
    lost.delete(key);
  };

  /** The conversation says once that the recording stopped before the stage did, and why. */
  const sayStopped = (live: Live, rec: Recorder): void => {
    if (live.stopSaid) return;
    live.stopSaid = true;
    if (rec.stoppedBy === 'size') say(live, 'runner.screen.cappedSize', { max: String(RECORDING_MAX_BYTES / (1024 * 1024)) });
    else if (rec.stoppedBy === 'time') say(live, 'runner.screen.cappedTime', { max: String(RECORDING_MAX_MS / 60_000) });
    else if (rec.stoppedBy === 'resized') say(live, 'runner.screen.resized');
    else say(live, 'runner.screen.encoderStopped');
    changed(live.key);
  };

  /**
   * The latest frame, read now or reused: null when the display did not answer (the second time in a row the screen is over). `notBefore` is the earliest time a
   * frame may have been read at: a cached or under-way read that began before it is not taken, and the screen is read afresh. `accept` is the hand-off epoch the caller
   * accepts: a cached or under-way read of another one is not taken either (a phone is not served what was read while the person held the screen).
   */
  const read = async (live: Live, notBefore = 0, accept?: number): Promise<Grabbed | null> => {
    for (;;) {
      if (live.grabbed && now() - live.grabbed.at < FRAME_MIN_MS && live.grabbed.at >= notBefore && (accept === undefined || live.grabbed.epoch === accept)) return live.grabbed;
      if (!live.reading) break;
      if (live.readingFrom >= notBefore && (accept === undefined || live.readingEpoch === accept)) return live.reading;
      // A read that began too early is waited out, not used: the next one is the caller's.
      await live.reading.catch(() => undefined);
      if (live.ended) return null;
    }
    live.readingFrom = now();
    const epoch = live.epoch;
    live.readingEpoch = epoch;
    live.reading = (async (): Promise<Grabbed | null> => {
      const f = await live.conn.grab();
      if (live.ended) return null;
      if (!f) {
        live.failed++;
        if (live.failed >= FAILED_READS_MAX || live.conn.closed) drop(live.key, true);
        return live.ended ? null : live.grabbed;
      }
      live.failed = 0;
      fixPad(f.data);
      const frame: RawFrame = { width: f.width, height: f.height, data: f.data };
      const hash = hashFrame(frame);
      // A hand-off interval began or ended while the display was read: this picture belongs to the other side of it, and the cache is not its to fill.
      if (live.epoch !== epoch) return { seq: ++live.seq, at: now(), hash, frame, epoch };
      const prev = live.grabbed;
      if (prev && prev.hash === hash) prev.at = now();
      else {
        live.grabbed = { seq: ++live.seq, at: now(), hash, frame, epoch };
        live.pictures.clear();
      }
      return live.grabbed;
    })().finally(() => {
      live.reading = null;
    });
    return live.reading;
  };

  /**
   * One look at the screen for the recording: asks whether a window is mapped and, if one is, offers the picture to the recorder. The first look after a bare screen
   * reads afresh: a picture a viewer read within the cache's 400 ms may be from before the window mapped, and it would be the video's first frame.
   */
  const look = async (live: Live, rec: Recorder): Promise<void> => {
    const checkedAt = now();
    // A bare screen (or a display that did not answer) is not read for the recording: it is empty, or the next look finds out.
    const used = await live.conn.inUse();
    if (live.ended) return;
    if (used !== true) {
      // The screen is handed out as waiting for a window again: the list refreshes to say so.
      if (live.usedSince !== null) {
        live.usedSince = null;
        changed(live.key);
      }
      return;
    }
    if (live.usedSince === null) {
      live.usedSince = checkedAt;
      changed(live.key);
    }
    live.sawWindow = true;
    const got = await read(live, live.usedSince);
    if (live.ended || !got) return;
    await rec.add(got.frame, got.hash, got.at);
    if (rec.state === 'stopped') sayStopped(live, rec);
  };

  /** One look at the screen for the recording; the next is timed when this one is done, so two never overlap. */
  const tick = async (live: Live): Promise<void> => {
    live.cancelTick = null;
    const rec = live.rec;
    if (live.ended || !rec) return;
    try {
      await look(live, rec);
    } catch {
      // A look that failed is the next one's to retry; a recording is never the stage's failure.
    }
    if (!live.ended && live.rec === rec && rec.state === 'on') live.cancelTick = schedule(RECORDING_INTERVAL_MS, () => void tick(live));
  };

  return {
    async open(screen) {
      if (!deps.enabled || !parseKey(screen.key)) return false;
      // A key has one live screen: a second display never replaces the one that is recording.
      if (lives.has(screen.key)) return false;
      end(screen.key);
      let conn: X11Connection;
      try {
        conn = await connect(screen.socket);
      } catch {
        return false;
      }
      const live: Live = { key: screen.key, thread: screen.thread, stage: screen.stage, agent: screen.agent, since: new Date(now()).toISOString(), conn, rec: deps.sink ? createRecorder({ sink: deps.sink(), limits: deps.recordingLimits, openedAt: now() }) : null, cancelTick: null, stopSaid: false, sawWindow: false, usedSince: null, ended: false, control: false, planner: null, burst: null, cancelBurst: null, rate: { at: 0, n: 0 }, grabbed: null, reading: null, readingFrom: 0, readingEpoch: 0, failed: 0, pictures: new Map(), seq: 0, epoch: 0, interval: null };
      lives.set(screen.key, live);
      // A connection that is lost ends the screen: it is never dialled again, since what is at the socket's path is not the app's to trust after the agent has run.
      conn.onClose(() => {
        if (lives.get(screen.key) === live) drop(screen.key, true);
      });
      changed(screen.key);
      // The first look is at once (the screen as it opens is the first frame of the video); it is not waited for, so the stage does not wait for the encoder to start.
      if (live.rec) void tick(live);
      return true;
    },
    state(k) {
      const live = lives.get(keyOf(k) ?? '');
      if (!live) return null;
      return { stage: live.stage, width: live.grabbed?.frame.width ?? live.conn.size.width, height: live.grabbed?.frame.height ?? live.conn.size.height, since: live.since, control: live.control, recording: !live.rec || live.rec.state === 'stopped' ? 'stopped' : live.usedSince === null ? 'waiting' : 'on' };
    },
    async frame(k, since, width, viewer = 'web') {
      const live = lives.get(keyOf(k) ?? '');
      if (!live) return { state: 'none' };
      // The hand-off interval: nothing is read for a reader that is not the person who holds the screen, so no picture of it is ever made for one.
      if (live.interval && viewer === 'web') return { state: 'held' };
      // A phone takes only a picture read under the epoch it asks in; the person's own reader takes any.
      let got = await read(live, 0, viewer === 'web' ? live.epoch : undefined);
      // The screen ended while the frame was being read, or the encoder is gone: nothing more to show.
      if (live.ended) return { state: 'none' };
      // The interval began while the display was read: the picture is not for this reader.
      if (live.interval && viewer === 'web') return { state: 'held' };
      // The whole interval passed while the display was read: that picture is the person's, and a phone gets one read afresh.
      if (viewer === 'web' && got && got.epoch !== live.epoch) {
        got = await read(live, 0, live.epoch);
        if (live.ended) return { state: 'none' };
        if (live.interval) return { state: 'held' };
      }
      if (!got) return { state: 'same', seq: 0, control: live.control };
      if (got.seq === since) return { state: 'same', seq: got.seq, control: live.control };
      const w = clampFrameWidth(width);
      let picture = live.pictures.get(w);
      if (!picture) {
        const made = deps.encoder.encode(got.frame, w);
        if (!made) return { state: 'none' };
        picture = made;
        // The frame may have moved on while it was being encoded: the picture is kept only for the one it was made from.
        if (live.grabbed === got) live.pictures.set(w, picture);
      }
      return { state: 'frame', seq: got.seq, width: picture.width, height: picture.height, screen: { width: got.frame.width, height: got.frame.height }, jpeg: picture.jpeg, control: live.control };
    },
    async control(k, on) {
      const key = keyOf(k) ?? '';
      const live = lives.get(key);
      if (!live) return { ok: false, reason: 'none' };
      if (live.control === on) return { ok: true };
      // In a hand-off interval control comes and goes without a line: the interval has its own.
      if (on) {
        live.control = true;
        if (!live.interval) say(live, 'runner.screen.controlOn');
      } else {
        await releaseHeld(live);
        closeBurst(live);
        live.control = false;
        if (!live.interval) say(live, 'runner.screen.controlOff');
      }
      changed(key);
      touched(key);
      return { ok: true };
    },
    async input(k, events) {
      const live = lives.get(keyOf(k) ?? '');
      if (!live) return { ok: false, delivered: 0, rejected: 0, reason: 'none' };
      if (!live.control) return { ok: false, delivered: 0, rejected: 0, reason: 'off' };
      // What is over the limits of a call or of a second is rejected, never queued: a viewer that sends too much is told it was not delivered.
      const t = now();
      if (t - live.rate.at >= 1000) live.rate = { at: t, n: 0 };
      const room = Math.max(0, Math.min(SCREEN_INPUT_MAX, events.length, SCREEN_INPUT_PER_SECOND - live.rate.n));
      live.rate.n += room;
      let rejected = events.length - room;
      // In a hand-off interval the keys are also the text the masker will take out of what the agent reads: collected for every event the call carries within the limits,
      // the ones the screen has no key for included (to over-mask is harmless).
      live.interval?.typed.feed(events.slice(0, room));
      const planner = await plannerOf(live);
      // The stage ended or control was given back while the keymap was being read.
      if (live.ended) return { ok: false, delivered: 0, rejected: events.length, reason: 'none' };
      if (!live.control) return { ok: false, delivered: 0, rejected: events.length, reason: 'off' };
      const plan = planner.plan(events.slice(0, room));
      rejected += plan.rejected;
      if (plan.events.length === 0) return { ok: true, delivered: plan.accepted, rejected };
      const sent = await live.conn.fakeInput(plan.events);
      if (!sent.ok) return { ok: false, delivered: 0, rejected: rejected + plan.accepted };
      const at = now();
      touched(live.key);
      if (live.interval) {
        // The interval is one stretch, not bursts: it writes one line when it ends, and a line per burst would show the rhythm of the typing.
        try {
          live.interval.on.input();
        } catch {
          // The listener's failure is not the person's.
        }
        return { ok: true, delivered: plan.accepted, rejected };
      }
      if (live.burst && at - live.burst.last > BURST_GAP_MS) closeBurst(live);
      live.burst = live.burst ? { from: live.burst.from, last: at } : { from: at, last: at };
      live.cancelBurst?.();
      live.cancelBurst = schedule(BURST_GAP_MS, () => closeBurst(live));
      return { ok: true, delivered: plan.accepted, rejected };
    },
    async finish(k) {
      const key = keyOf(k) ?? '';
      let live = lives.get(key);
      // One last look: a window that mapped less than a second ago (the timer's interval) is on the screen now and is the video's, not an unused screen. The display may
      // die during it, which sets the recording aside as lost, so the screen is looked up again after.
      if (live?.rec && !live.ended) await look(live, live.rec).catch(() => undefined);
      live = lives.get(key);
      let rec: Recorder | null;
      let sawWindow: boolean;
      // The screen this call ends, kept to read what a look still in flight saw before the screen is gone.
      const ending = live;
      if (live) {
        // Taken before anything else is awaited: a display that dies meanwhile sets the recording aside as lost, and it is this call's to build.
        rec = live.rec;
        sawWindow = live.sawWindow;
        // Control is given back with the stage: what the person held down is put up, and the conversation says both.
        await releaseHeld(live).catch(() => undefined);
        closeBurst(live);
        // The interval's mark goes on the recording before it leaves the screen.
        closeInterval(live, 'ended');
        if (live.control) {
          live.control = false;
          say(live, 'runner.screen.controlOff');
        }
        // The recording leaves the screen here, so ending the screen does not throw it away.
        live.rec = null;
        if (rec && lost.get(key)?.rec === rec) lost.delete(key);
        end(key);
      } else {
        const kept = lost.get(key);
        rec = kept?.rec ?? null;
        sawWindow = kept?.sawWindow ?? false;
        lost.delete(key);
      }
      if (!rec) return null;
      try {
        const out = await rec.finish(now());
        // Nothing was fed because nothing was ever on the screen: that is not a failure to read it. What a look in flight saw while the screen was being ended counts.
        sawWindow ||= ending?.sawWindow ?? false;
        return !out.ok && out.reason === 'no-frame' && !sawWindow ? { ok: false, reason: 'unused' } : out;
      } catch {
        return { ok: false, reason: 'encoder' };
      }
    },
    beginInterval(k, on) {
      const live = lives.get(keyOf(k) ?? '');
      if (!live || live.ended || live.interval) return false;
      // What Take control had begun is closed first, so its line comes before the interval's. All of this is synchronous: the withholding is in place before anyone can read.
      closeBurst(live);
      live.interval = { from: now(), typed: createTypedCollector(), on, controlBefore: live.control, ending: false };
      live.epoch++;
      live.grabbed = null;
      live.pictures.clear();
      changed(live.key);
      return true;
    },
    endInterval(k, why) {
      const live = lives.get(keyOf(k) ?? '');
      const iv = live?.interval;
      if (!live || !iv || iv.ending) return;
      iv.ending = true;
      // Held keys go up first, and the screen stays withheld until they have: only then does the interval end.
      void releaseHeld(live)
        .catch(() => undefined)
        .then(() => {
          if (!live.ended) closeInterval(live, why);
        });
    },
    held: (k) => !!lives.get(keyOf(k) ?? '')?.interval,
    end: (k) => end(keyOf(k) ?? ''),
    endAll() {
      for (const key of [...lives.keys(), ...lost.keys()]) end(key);
    },
  };
}
