// The live screen of an agent's virtual display (#157): what a run carries while its working stage has one, what the viewer asks and is answered, what the person's
// input looks like on the wire and the limits both sides hold to. Pure, so the renderer and the main process read the same constants.

/** The event the main process sends when a live screen opens or ends, so the run list refreshes at once. It carries the run's id and no pixels. */
export const SCREEN_EVENT = 'runs-screen';

/** The channels between the main process and the hidden window that encodes the recording. They are not served to the main window or to a paired browser. */
export const SCREEN_ENCODER_COMMAND = 'screen-encoder:command';
export const SCREEN_ENCODER_EVENT = 'screen-encoder:event';

/** What the app's own recording of a screen says about itself: kept on the evidence record, so the player knows the length and where the person took over. */
export interface RecordingMeta {
  /**
   * The length of the video: its media time, which is what the player's timeline and the file's own duration say. Idle stretches are shortened (see `cuts`), so it is
   * shorter than the time the stage spent on the screen; a recording made before the cuts existed has none and the two are the same.
   */
  durationMs: number;
  width: number;
  height: number;
  /** The recording stopped at a limit and holds only what came before it. */
  truncated?: 'size' | 'time';
  /**
   * The intervals in which the person used the screen, in ms of the video from its start (media time), so they sit right on the player's strip. `kind: 'handoff'` is the one
   * interval of a hand-off (#178): the agent gave the screen to the person, and the video keeps what they did.
   */
  marks: { fromMs: number; toMs: number; kind?: 'handoff' }[];
  /** The video holds a hand-off interval (#178): what the person typed while they held the screen can be seen in it. */
  handoff?: true;
  /** The time from the stage's screen opening to the first frame of the video: the recording starts when the screen is first used, not when it opens (#176). Absent in a recording made before it was kept. */
  startedAfterMs?: number;
  /** The stage's own time between the first frame and the end of the video: `durationMs` plus every `skippedMs`. Only with `cuts`; without them it is `durationMs`. */
  realMs?: number;
  /** Where an idle stretch was shortened, by media time, in order; at most `RECORDING_CUTS_MAX`. Absent when nothing was cut. */
  cuts?: RecordingCut[];
}

/** One idle stretch that plays as a short pause: the media time at which the pause ends, and the real time that was left out of the video. */
export interface RecordingCut {
  atMs: number;
  skippedMs: number;
}

/** A gap between two fed frames longer than this is shortened to a pause of `RECORDING_IDLE_PAUSE_MS`; a gap of this length or less is kept as it was. */
export const RECORDING_IDLE_GAP_MS = 3000;
export const RECORDING_IDLE_PAUSE_MS = 1000;
/** The most cuts a recording keeps: past it a gap stays as it is, so the mapping between the two clocks is never wrong. */
export const RECORDING_CUTS_MAX = 500;

/** The stage's time at a time of the video: the video's time plus what was cut out before it. `cuts` are in order. */
export function realAtMedia(cuts: readonly RecordingCut[] | undefined, mediaMs: number): number {
  let real = mediaMs;
  for (const c of cuts ?? []) {
    if (c.atMs > mediaMs) break;
    real += c.skippedMs;
  }
  return real;
}

/** The time of the video at a time of the stage; a time inside a stretch that was cut out is the end of its pause. `cuts` are in order. */
export function mediaAtReal(cuts: readonly RecordingCut[] | undefined, realMs: number): number {
  let skipped = 0;
  for (const c of cuts ?? []) {
    // The stage's time at which the pause ends, before the jump over the stretch that was left out.
    const from = c.atMs + skipped;
    if (realMs < from) break;
    if (realMs <= from + c.skippedMs) return c.atMs;
    skipped += c.skippedMs;
  }
  return realMs - skipped;
}

/** The most marks a recording keeps: a stage the person controls many times over keeps the first ones. */
export const RECORDING_MARKS_MAX = 200;

/** The largest recording the app keeps: its own ceiling, since the 8 MiB of a piece of evidence does not fit a video. */
export const RECORDING_MAX_BYTES = 24 * 1024 * 1024;
/** The longest recorded time: past it the recording stops and says so. */
export const RECORDING_MAX_MS = 60 * 60 * 1000;
/** How often the screen is looked at for the recording, and the least time between two frames that are fed (a little under the interval, so a timer's jitter never costs a frame). */
export const RECORDING_INTERVAL_MS = 1000;
export const RECORDING_MIN_GAP_MS = 900;
/** The target bit rate of the video, and how far apart the key frames are (a seek never decodes more than this). */
export const RECORDING_BITRATE = 250_000;
export const RECORDING_KEY_MS = 10_000;
/** Kept free below the ceiling for the frames still in the encoder and for the container's own bytes. */
export const RECORDING_RESERVE_BYTES = 1024 * 1024;
/** An interval of the person's use of the screen is marked at least this wide, so a single click is a mark that can be seen and hit. */
export const RECORDING_MARK_MIN_MS = 1000;

/** The EBML header of a WebM file: the magic, then the DocType element (id 0x4282, one length byte 4, "webm") within the first 64 bytes. */
const WEBM_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const WEBM_DOCTYPE = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];

/** Whether the bytes are a WebM file: what the app's own recording is, and the only video it keeps. */
export function isWebm(bytes: Uint8Array): boolean {
  if (!WEBM_MAGIC.every((b, i) => bytes[i] === b)) return false;
  const head = bytes.subarray(0, 64);
  for (let i = 0; i + WEBM_DOCTYPE.length <= head.length; i++) if (WEBM_DOCTYPE.every((b, j) => head[i + j] === b)) return true;
  return false;
}

/** What a run handed out carries while its working stage has a live screen. Filled by the runner when it hands the run out and never saved. */
export interface LiveScreen {
  stage: string;
  /** The screen's own size in pixels, for mapping the pointer. */
  width: number;
  height: number;
  /** ISO time the screen opened. */
  since: string;
  /** Someone is controlling it from the desktop. */
  control: boolean;
  /**
   * The screen is being recorded as evidence of the stage (`on`); `waiting` while no window is mapped on it, when nothing is recorded yet (#176); `stopped` once a limit
   * was reached (or the encoder failed): what came before is still kept.
   */
  recording: 'on' | 'waiting' | 'stopped';
}

/**
 * The answer to a viewer that asks for the latest frame: no live screen (the stage ended, or there never was one); the same picture as the sequence number it holds;
 * or a newer one; or `held`: the person has the screen for a hand-off (#178) and no picture of it is served to a paired browser. `screen` is the display's own size, which the pointer is mapped to; `width` and `height` are the picture's.
 */
export type ScreenFrameAnswer =
  | { state: 'none' }
  | { state: 'held' }
  | { state: 'same'; seq: number; control: boolean }
  | { state: 'frame'; seq: number; width: number; height: number; screen: { width: number; height: number }; jpeg: Uint8Array; control: boolean };

/** The widths a viewer may ask for: clamped to this range in steps, so the encoder holds a bounded number of pictures. */
export const SCREEN_FRAME_MIN_WIDTH = 320;
export const SCREEN_FRAME_MAX_WIDTH = 1280;
export const SCREEN_FRAME_STEP = 80;
/** The width the desktop asks for and the one the phone asks for. */
export const SCREEN_WIDTH_DESKTOP = 1280;
export const SCREEN_WIDTH_PHONE = 640;

export function clampFrameWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SCREEN_FRAME_MAX_WIDTH;
  const stepped = Math.round(width / SCREEN_FRAME_STEP) * SCREEN_FRAME_STEP;
  return Math.min(SCREEN_FRAME_MAX_WIDTH, Math.max(SCREEN_FRAME_MIN_WIDTH, stepped));
}

/** One input event from the viewer: pointer position in the screen's own pixels, buttons, wheel notches and keys. */
export type ScreenInput =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; b: 1 | 2 | 3; down: boolean }
  /** Wheel notches, signed: positive scrolls down. */
  | { t: 'scroll'; dy: number }
  /** A `KeyboardEvent.key`: a name such as `Enter`, or one character. */
  | { t: 'key'; key: string; down: boolean };

/** The answer to Take control on or off: `none` is a run with no live screen (the stage ended). */
export interface ScreenControlAnswer {
  ok: boolean;
  reason?: 'none';
}

/**
 * The answer to a batch of input: `delivered` events of the viewer reached the screen, `rejected` did not (a shape or a key the screen has no key for, past the limits).
 * `reason` says why nothing was sent at all: no live screen, or Take control is off.
 */
export interface ScreenInputAnswer {
  ok: boolean;
  delivered: number;
  rejected: number;
  reason?: 'none' | 'off';
}

/** Most events one call carries. */
export const SCREEN_INPUT_MAX = 64;
/** Most events accepted for a run in one second. */
export const SCREEN_INPUT_PER_SECOND = 200;
/** Longest `key` a call may carry. */
export const SCREEN_KEY_MAX = 32;
/** Most wheel notches one scroll event turns into. */
export const SCREEN_SCROLL_NOTCHES_MAX = 5;

/**
 * The chord that leaves Take control from the keyboard: Control, Alt and Shift held with Escape. The viewer acts on it and the main process never sends it to the
 * screen either, so a person is never stuck inside the agent's screen.
 */
export function isExitChord(key: string, held: { ctrl: boolean; alt: boolean; shift: boolean }): boolean {
  return key === 'Escape' && held.ctrl && held.alt && held.shift;
}
