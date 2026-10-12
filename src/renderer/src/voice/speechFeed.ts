import type { SpeechSegment } from '../../../shared/types';

// The segments of one speech, planned as its text arrives. Pure on purpose: the planner is injected, so the order,
// the end and a cancel are tested without audio; playback.ts reads it slot by slot.

export interface SpeechFeed {
  /** Plans a piece of text (a sentence) and appends its segments after the ones already planned. */
  push(text: string): void;
  /** No more text: the feed ends once what was pushed is planned. */
  end(): void;
  /** Drops what is still being planned and ends the feed now. */
  cancel(): void;
  /** Segment `i` once it is planned, or null when the feed ends without it. */
  at(i: number): Promise<SpeechSegment | null>;
  /** Called whenever segments are appended or the feed ends. */
  subscribe(cb: () => void): () => void;
  readonly segments: readonly SpeechSegment[];
  readonly done: boolean;
}

export function createSpeechFeed(plan: (text: string) => Promise<SpeechSegment[]>): SpeechFeed {
  const segments: SpeechSegment[] = [];
  const listeners = new Set<() => void>();
  let chain: Promise<void> = Promise.resolve();
  let closing = false;
  let cancelled = false;
  let done = false;

  const notify = () => {
    for (const cb of [...listeners]) cb();
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  };

  return {
    push(text) {
      if (closing || cancelled || !text.trim()) return;
      // one plan at a time, so the segments keep the order of the text
      chain = chain.then(async () => {
        if (cancelled) return;
        let planned: SpeechSegment[];
        try {
          planned = await plan(text);
        } catch {
          // a sentence that cannot be planned is skipped, as a sentence that cannot be synthesized is
          planned = [];
        }
        if (cancelled || planned.length === 0) return;
        segments.push(...planned);
        notify();
      });
    },
    end() {
      if (closing || cancelled) return;
      closing = true;
      void chain.then(() => {
        if (done) return;
        done = true;
        notify();
      });
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      closing = true;
      done = true;
      notify();
    },
    at(i) {
      return new Promise((resolve) => {
        const check = () => {
          if (i < segments.length) resolve(segments[i]);
          else if (done) resolve(null);
          else return false;
          return true;
        };
        if (check()) return;
        const off = subscribe(() => {
          if (check()) off();
        });
      });
    },
    subscribe,
    get segments() {
      return segments;
    },
    get done() {
      return done;
    },
  };
}
