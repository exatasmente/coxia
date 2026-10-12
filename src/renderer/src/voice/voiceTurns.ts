import { type ForumMessage, isInterrupted } from '../../../shared/forum';
import type { LiveAnswer } from '../../../shared/persona';
import { nextSentences } from './sentences';

// Which sentences of the persona's answers to speak, and when an answer is over. Pure on purpose: the hook feeds it the live text and the stored messages.
// Only the turns this device sent by voice are spoken: the live text reaches every paired device, and the computer and the phone must not talk at once.

/** What changed for one spoken turn since the last feed. */
export interface TurnUpdate {
  /** The `seq` of the person's spoken message. */
  to: number;
  /** New sentences, in order, never one already given out for this turn. */
  speak: string[];
  /** The answer started arriving with this feed. */
  started: boolean;
  /** The answer is over: nothing more will be given out for this turn. */
  done: boolean;
  /** The person stopped the answer: whatever is still playing stops too. */
  interrupted: boolean;
  /** The whole text of the answer so far, for the captions. */
  text: string;
}

export interface TurnTimeouts {
  /** An answer that was being written and vanished without a stored message (it failed) is closed after this long. */
  vanishedMs: number;
  /** A turn that never got any answer is closed after this long. */
  silentMs: number;
}

const TIMEOUTS: TurnTimeouts = { vanishedMs: 5_000, silentMs: 180_000 };

interface Turn {
  markedAt: number;
  /** The text the sentences were taken from, and how far into it. */
  basis: string;
  consumed: number;
  spoken: Set<string>;
  started: boolean;
  goneAt: number | null;
  done: boolean;
}

export interface TurnTracker {
  /** A message this device just sent by voice: its answer will be spoken. */
  mark(seq: number, now: number): void;
  feed(live: readonly LiveAnswer[], stored: readonly ForumMessage[], now: number): TurnUpdate[];
  /** The spoken turns whose answer is not over yet. */
  open(): number[];
  /** Forgets every turn (voice mode ended, the chat closed). */
  clear(): void;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function createTurnTracker(timeouts: Partial<TurnTimeouts> = {}): TurnTracker {
  const limits = { ...TIMEOUTS, ...timeouts };
  const turns = new Map<number, Turn>();

  // Sentences of `text` past what was already taken; a text that no longer starts with what was taken (a rewrite) is read again from the top, skipping what was said.
  const take = (turn: Turn, text: string, final: boolean): string[] => {
    if (!text.startsWith(turn.basis.slice(0, turn.consumed))) turn.consumed = 0;
    turn.basis = text;
    const { sentences, next } = nextSentences(text, turn.consumed, { final });
    turn.consumed = next;
    const fresh: string[] = [];
    for (const s of sentences) {
      const key = norm(s);
      if (turn.spoken.has(key)) continue;
      turn.spoken.add(key);
      fresh.push(s);
    }
    return fresh;
  };

  return {
    mark(seq, now) {
      if (!turns.has(seq)) turns.set(seq, { markedAt: now, basis: '', consumed: 0, spoken: new Set(), started: false, goneAt: null, done: false });
    },
    feed(live, stored, now) {
      const updates: TurnUpdate[] = [];
      for (const [to, turn] of turns) {
        if (turn.done) continue;
        const answer = stored.find((m) => m.answersTo === to && m.author.type === 'agent');
        const writing = live.find((a) => a.to === to);
        const wasStarted = turn.started;
        let speak: string[] = [];
        let interrupted = false;
        if (answer) {
          turn.started = true;
          turn.done = true;
          interrupted = isInterrupted(answer);
          if (!interrupted) speak = take(turn, answer.text, true);
        } else if (writing) {
          turn.started = true;
          turn.goneAt = null;
          speak = take(turn, writing.text, false);
        } else if (turn.started) {
          // the bubble went without a stored answer yet: the answer is posted in a moment, or it failed
          turn.goneAt ??= now;
          if (now - turn.goneAt >= limits.vanishedMs) turn.done = true;
        } else if (now - turn.markedAt >= limits.silentMs) {
          turn.done = true;
        }
        const started = turn.started && !wasStarted;
        if (speak.length || started || turn.done) updates.push({ to, speak, started, done: turn.done, interrupted, text: answer?.text ?? writing?.text ?? turn.basis });
      }
      return updates;
    },
    open() {
      return [...turns].filter(([, t]) => !t.done).map(([seq]) => seq);
    },
    clear() {
      turns.clear();
    },
  };
}
