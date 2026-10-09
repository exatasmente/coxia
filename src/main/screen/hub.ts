import { type LiveScreen, SCREEN_INPUT_MAX, SCREEN_INPUT_PER_SECOND, type ScreenControlAnswer, type ScreenFrameAnswer, type ScreenInputAnswer, clampFrameWidth } from '../../shared/screen';
import { type FrameEncoder, type RawFrame, fixPad, hashFrame } from './frame';
import { type X11Connection, connectX11 } from './x11';
import { type InputPlanner, createInputPlanner } from './xinput';

// The registry of live screens: one per working stage that has a virtual display. The hub holds the connection to that display, the latest frame (read only when a
// viewer asks, and never more than once in `FRAME_MIN_MS` however many viewers there are), the encoded pictures of it and the state the run is handed out with.
// Frames never go through the app's broadcast: a viewer asks, and is answered alone. Nothing here reads the screen once a live screen has ended.
//
// The person's input (Take control, desktop only) goes through the same connection as the frames: it is not a command of the agent, so it is not queued behind the
// agent's commands, spends none of the stage's budget and is not in its log. The conversation says it in two ways: a line when control is taken and given back, and one
// line for each burst of input ("the person used the screen from ... to ...").

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
  /** A live screen opened or ended, or control was taken or given back: the run list refreshes at once. It carries the run's id and no pixels. */
  changed?: (run: string) => void;
  /** A line the app writes in the run's conversation (a system line with a catalog code and its parameters). */
  note?: (run: string, stage: string, code: string, params: Record<string, string>) => void;
  /** Calls `fn` after `ms`; returns what cancels it. The burst of input is closed by it. */
  schedule?: (ms: number, fn: () => void) => () => void;
}

export interface OpenScreen {
  run: string;
  stage: string;
  /** The agent that works the stage: the conversation's lines name it. */
  agent: string;
  /** The display's socket on this computer. */
  socket: string;
  kind: 'sandbox' | 'host';
}

export interface ScreenHub {
  /** Connects to the stage's display and registers it; false when it cannot (the stage goes on without a live screen). Made before the agent's first command. */
  open(screen: OpenScreen): Promise<boolean>;
  /** What the run is handed out with; null when its stage has no live screen. */
  state(run: string): LiveScreen | null;
  /** The latest frame of a run's live screen for a viewer that shows `since`, about `width` wide. Never throws. */
  frame(run: string, since: number, width: number): Promise<ScreenFrameAnswer>;
  /** The person takes control of the screen (desktop only) or gives it back; giving it back puts up every key and button still held. */
  control(run: string, on: boolean): Promise<ScreenControlAnswer>;
  /** The person's input: pointer, buttons, wheel and keys. Reaches the screen only while control is on. Never throws. */
  input(run: string, events: readonly unknown[]): Promise<ScreenInputAnswer>;
  /** The stage's end: stops everything and closes the connection. Idempotent; nothing is read afterwards. */
  finish(run: string): Promise<null>;
  /** Drops the live screen of a run without keeping anything of it (the stage failed before it started, the app is closing). Idempotent. */
  end(run: string): void;
  /** `end` for every run. */
  endAll(): void;
}

interface Grabbed {
  seq: number;
  /** When it was read. */
  at: number;
  hash: string;
  frame: RawFrame;
}

interface Live {
  run: string;
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
  ended: boolean;
  grabbed: Grabbed | null;
  reading: Promise<Grabbed | null> | null;
  failed: number;
  /** The pictures made of `grabbed`, by width: one per (frame, width), dropped when the screen changes. */
  pictures: Map<number, { jpeg: Uint8Array; width: number; height: number }>;
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
  const say = (live: Live, code: string, params: Record<string, string> = {}): void => {
    try {
      deps.note?.(live.run, live.stage, code, { agent: live.agent, ...params });
    } catch {
      // A line that cannot be written is not the stage's to know.
    }
  };
  const changed = (run: string): void => {
    try {
      deps.changed?.(run);
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
    if (b) say(live, 'runner.screen.used', { from: clockText(b.from), to: clockText(b.last) });
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

  const end = (run: string): void => {
    const live = lives.get(run);
    if (!live) return;
    live.ended = true;
    lives.delete(run);
    live.cancelBurst?.();
    live.cancelBurst = null;
    live.conn.close();
    changed(run);
  };

  /** The latest frame, read now or reused: null when the display did not answer (the second time in a row the screen is over). */
  const read = (live: Live): Promise<Grabbed | null> => {
    if (live.grabbed && now() - live.grabbed.at < FRAME_MIN_MS) return Promise.resolve(live.grabbed);
    if (live.reading) return live.reading;
    live.reading = (async (): Promise<Grabbed | null> => {
      const f = await live.conn.grab();
      if (live.ended) return null;
      if (!f) {
        live.failed++;
        if (live.failed >= FAILED_READS_MAX || live.conn.closed) end(live.run);
        return live.ended ? null : live.grabbed;
      }
      live.failed = 0;
      fixPad(f.data);
      const frame: RawFrame = { width: f.width, height: f.height, data: f.data };
      const hash = hashFrame(frame);
      const prev = live.grabbed;
      if (prev && prev.hash === hash) prev.at = now();
      else {
        live.grabbed = { seq: (prev?.seq ?? 0) + 1, at: now(), hash, frame };
        live.pictures.clear();
      }
      return live.grabbed;
    })().finally(() => {
      live.reading = null;
    });
    return live.reading;
  };

  return {
    async open(screen) {
      if (!deps.enabled) return false;
      end(screen.run);
      let conn: X11Connection;
      try {
        conn = await connect(screen.socket);
      } catch {
        return false;
      }
      const live: Live = { run: screen.run, stage: screen.stage, agent: screen.agent, since: new Date(now()).toISOString(), conn, ended: false, control: false, planner: null, burst: null, cancelBurst: null, rate: { at: 0, n: 0 }, grabbed: null, reading: null, failed: 0, pictures: new Map() };
      lives.set(screen.run, live);
      // A connection that is lost ends the screen: it is never dialled again, since what is at the socket's path is not the app's to trust after the agent has run.
      conn.onClose(() => {
        if (lives.get(screen.run) === live) end(screen.run);
      });
      changed(screen.run);
      return true;
    },
    state(run) {
      const live = lives.get(run);
      if (!live) return null;
      return { stage: live.stage, width: live.grabbed?.frame.width ?? live.conn.size.width, height: live.grabbed?.frame.height ?? live.conn.size.height, since: live.since, control: live.control };
    },
    async frame(run, since, width) {
      const live = lives.get(run);
      if (!live) return { state: 'none' };
      const got = await read(live);
      // The screen ended while the frame was being read, or the encoder is gone: nothing more to show.
      if (live.ended) return { state: 'none' };
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
    async control(run, on) {
      const live = lives.get(run);
      if (!live) return { ok: false, reason: 'none' };
      if (live.control === on) return { ok: true };
      if (on) {
        live.control = true;
        say(live, 'runner.screen.controlOn');
      } else {
        await releaseHeld(live);
        closeBurst(live);
        live.control = false;
        say(live, 'runner.screen.controlOff');
      }
      changed(run);
      return { ok: true };
    },
    async input(run, events) {
      const live = lives.get(run);
      if (!live) return { ok: false, delivered: 0, rejected: 0, reason: 'none' };
      if (!live.control) return { ok: false, delivered: 0, rejected: 0, reason: 'off' };
      // What is over the limits of a call or of a second is rejected, never queued: a viewer that sends too much is told it was not delivered.
      const t = now();
      if (t - live.rate.at >= 1000) live.rate = { at: t, n: 0 };
      const room = Math.max(0, Math.min(SCREEN_INPUT_MAX, events.length, SCREEN_INPUT_PER_SECOND - live.rate.n));
      live.rate.n += room;
      let rejected = events.length - room;
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
      if (live.burst && at - live.burst.last > BURST_GAP_MS) closeBurst(live);
      live.burst = live.burst ? { from: live.burst.from, last: at } : { from: at, last: at };
      live.cancelBurst?.();
      live.cancelBurst = schedule(BURST_GAP_MS, () => closeBurst(live));
      return { ok: true, delivered: plan.accepted, rejected };
    },
    async finish(run) {
      const live = lives.get(run);
      if (live) {
        // Control is given back with the stage: what the person held down is put up, and the conversation says both.
        await releaseHeld(live).catch(() => undefined);
        closeBurst(live);
        if (live.control) {
          live.control = false;
          say(live, 'runner.screen.controlOff');
        }
      }
      end(run);
      return null;
    },
    end,
    endAll() {
      for (const run of [...lives.keys()]) end(run);
    },
  };
}
