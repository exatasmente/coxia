import { type LiveScreen, type ScreenFrameAnswer, clampFrameWidth } from '../../shared/screen';
import { type FrameEncoder, type RawFrame, fixPad, hashFrame } from './frame';
import { type X11Connection, connectX11 } from './x11';

// The registry of live screens: one per working stage that has a virtual display. The hub holds the connection to that display, the latest frame (read only when a
// viewer asks, and never more than once in `FRAME_MIN_MS` however many viewers there are), the encoded pictures of it and the state the run is handed out with.
// Frames never go through the app's broadcast: a viewer asks, and is answered alone. Nothing here reads the screen once a live screen has ended.

/** A frame read less than this long ago is reused: two viewers cost one read. */
export const FRAME_MIN_MS = 400;
/** Reads that fail one after the other before the display is taken as gone. */
const FAILED_READS_MAX = 2;

export interface ScreenHubDeps {
  /** Linux only: the display, the sandbox and the socket exist nowhere else. Off, every call answers none. */
  enabled: boolean;
  encoder: FrameEncoder;
  now?: () => number;
  /** Opens the connection to a display's socket (tests give a fake). */
  connect?: (socket: string) => Promise<X11Connection>;
  /** A live screen opened or ended: the run list refreshes at once. It carries the run's id and no pixels. */
  changed?: (run: string) => void;
}

export interface OpenScreen {
  run: string;
  stage: string;
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
  since: string;
  conn: X11Connection;
  ended: boolean;
  grabbed: Grabbed | null;
  reading: Promise<Grabbed | null> | null;
  failed: number;
  /** The pictures made of `grabbed`, by width: one per (frame, width), dropped when the screen changes. */
  pictures: Map<number, { jpeg: Uint8Array; width: number; height: number }>;
}

export function createScreenHub(deps: ScreenHubDeps): ScreenHub {
  const now = deps.now ?? Date.now;
  const connect = deps.connect ?? ((socket: string) => connectX11(socket));
  const lives = new Map<string, Live>();

  const end = (run: string): void => {
    const live = lives.get(run);
    if (!live) return;
    live.ended = true;
    lives.delete(run);
    live.conn.close();
    try {
      deps.changed?.(run);
    } catch {
      // A listener that fails is not the stage's to know.
    }
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
      const live: Live = { run: screen.run, stage: screen.stage, since: new Date(now()).toISOString(), conn, ended: false, grabbed: null, reading: null, failed: 0, pictures: new Map() };
      lives.set(screen.run, live);
      // A connection that is lost ends the screen: it is never dialled again, since what is at the socket's path is not the app's to trust after the agent has run.
      conn.onClose(() => {
        if (lives.get(screen.run) === live) end(screen.run);
      });
      try {
        deps.changed?.(screen.run);
      } catch {
        // See `end`.
      }
      return true;
    },
    state(run) {
      const live = lives.get(run);
      if (!live) return null;
      return { stage: live.stage, width: live.grabbed?.frame.width ?? live.conn.size.width, height: live.grabbed?.frame.height ?? live.conn.size.height, since: live.since, control: false };
    },
    async frame(run, since, width) {
      const live = lives.get(run);
      if (!live) return { state: 'none' };
      const got = await read(live);
      // The screen ended while the frame was being read, or the encoder is gone: nothing more to show.
      if (live.ended) return { state: 'none' };
      if (!got) return { state: 'same', seq: 0, control: false };
      if (got.seq === since) return { state: 'same', seq: got.seq, control: false };
      const w = clampFrameWidth(width);
      let picture = live.pictures.get(w);
      if (!picture) {
        const made = deps.encoder.encode(got.frame, w);
        if (!made) return { state: 'none' };
        picture = made;
        // The frame may have moved on while it was being encoded: the picture is kept only for the one it was made from.
        if (live.grabbed === got) live.pictures.set(w, picture);
      }
      return { state: 'frame', seq: got.seq, width: picture.width, height: picture.height, screen: { width: got.frame.width, height: got.frame.height }, jpeg: picture.jpeg, control: false };
    },
    async finish(run) {
      end(run);
      return null;
    },
    end,
    endAll() {
      for (const run of [...lives.keys()]) end(run);
    },
  };
}
