import type { TextSink } from '../engine/contract';
import type { LiveAnswer, LiveEvent } from '../../shared/persona';

// The text of the answers being written, kept in memory and published as it grows (the persona's chat). Electron-free: the emitter, the masking, the clock and the timers
// come in as arguments.
//
// What is published is what will be stored: the same masking the forum store applies to an agent's message, computed over the whole text so far (so a secret that
// straddles two pieces is caught once it is whole), with the last unfinished word held back while the call writes. If the masking rewrites text already published,
// the event is a replacement (offset 0). Nothing here survives a restart and nothing here posts: the answer is stored once, whole, by the pipeline that answers.

/** At most one event per answer every this many milliseconds: a long answer is a dozen events a second, not hundreds. */
export const LIVE_THROTTLE_MS = 80;

export interface LiveTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface PersonaLiveDeps {
  emit: (event: LiveEvent) => void;
  redact: (text: string) => string;
  now?: () => number;
  timers?: LiveTimers;
}

interface Entry {
  agent: string;
  /** Everything the call wrote for the turn in progress, raw. */
  raw: string;
  /** What the devices hold now. */
  published: string;
  rev: number;
  lastEmit: number;
  timer: unknown;
}

export interface PersonaLive {
  /** An answer starts: before the engine is called. */
  begin(thread: string, to: number, agent: string): void;
  /** The sink the engines feed for this answer. */
  sink(thread: string, to: number): TextSink;
  /** The whole text written so far, masked: what a Stop posts. Empty when nothing was written. */
  snapshot(thread: string, to: number): string;
  /** The answer is over. `done`: the complete text is published first (the stored message is what the devices last saw); `dropped`: a failure, only the end is published. */
  end(thread: string, to: number, how?: 'done' | 'dropped'): void;
  /** The answers being written in a thread, as the last event left them: what a device that joined late reads. */
  read(thread: string): LiveAnswer[];
  /** Whether any answer is being written (the updater waits for it). */
  active(): boolean;
}

const keyOf = (thread: string, to: number): string => `${thread}\n${to}`;

export function createPersonaLive(deps: PersonaLiveDeps): PersonaLive {
  const now = deps.now ?? Date.now;
  const timers: LiveTimers = deps.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const entries = new Map<string, Entry & { thread: string; to: number }>();

  // The text the devices should hold: masked, without leading blanks, and, while the call writes, without the word it is in the middle of.
  const shown = (e: Entry, final: boolean): string => {
    const text = deps.redact(e.raw.trimStart());
    if (final) return text.trimEnd();
    const cut = /\s\S*$/.exec(text);
    return cut ? text.slice(0, cut.index) : '';
  };

  const flush = (e: Entry & { thread: string; to: number }, final: boolean): void => {
    if (e.timer !== null) {
      timers.clear(e.timer);
      e.timer = null;
    }
    const next = shown(e, final);
    if (next === e.published) return;
    const append = next.startsWith(e.published) && e.published.length > 0;
    e.rev += 1;
    e.lastEmit = now();
    const offset = append ? e.published.length : 0;
    deps.emit({ thread: e.thread, to: e.to, agent: e.agent, rev: e.rev, offset, text: append ? next.slice(offset) : next });
    e.published = next;
  };

  const schedule = (e: Entry & { thread: string; to: number }): void => {
    if (e.timer !== null) return;
    const wait = e.lastEmit + LIVE_THROTTLE_MS - now();
    if (wait <= 0) {
      flush(e, false);
      return;
    }
    e.timer = timers.set(() => {
      e.timer = null;
      flush(e, false);
    }, wait);
  };

  return {
    begin(thread, to, agent) {
      const key = keyOf(thread, to);
      const old = entries.get(key);
      if (old?.timer) timers.clear(old.timer);
      entries.set(key, { thread, to, agent, raw: '', published: '', rev: 0, lastEmit: Number.NEGATIVE_INFINITY, timer: null });
    },
    sink(thread, to) {
      const at = () => entries.get(keyOf(thread, to));
      return {
        piece(text) {
          const e = at();
          if (!e || !text) return;
          e.raw += text;
          schedule(e);
        },
        restart() {
          const e = at();
          if (!e) return;
          e.raw = '';
          // What was shown is not the answer: it goes at once, not on the throttle.
          flush(e, false);
        },
        settle(text) {
          const e = at();
          if (!e || !text) return;
          e.raw = text;
          // The text is whole: nothing is held back and nothing waits for the throttle.
          flush(e, true);
        },
      };
    },
    snapshot(thread, to) {
      const e = entries.get(keyOf(thread, to));
      return e ? deps.redact(e.raw.trimStart()).trim() : '';
    },
    end(thread, to, how = 'done') {
      const key = keyOf(thread, to);
      const e = entries.get(key);
      if (!e) return;
      if (how === 'done') flush(e, true);
      else if (e.timer !== null) {
        timers.clear(e.timer);
        e.timer = null;
      }
      entries.delete(key);
      e.rev += 1;
      deps.emit({ thread, to, agent: e.agent, rev: e.rev, offset: 0, text: '', end: true });
    },
    read(thread) {
      return [...entries.values()].filter((e) => e.thread === thread).map((e) => ({ thread: e.thread, to: e.to, agent: e.agent, rev: e.rev, text: e.published }));
    },
    active: () => entries.size > 0,
  };
}
