import { type ForumDraft, runThreadId } from '../../shared/forum';
import type { ForumStore } from '../forum-core';

// The mailbox of a stage that talks while it works: the messages that arrive for the agent of the stage are queued here and handed to the engine between two
// steps of the model (the `incoming` door), and each delivery is announced in the thread. A message that arrives once the stage is already finishing is not
// handed over: the stage ends with what it has and the message comes back in the thread with the reason, so nothing restarts.

export interface StageInbox {
  /** The next message to hand over, or a promise that wakes when one arrives; null only after `close`. */
  next(): Promise<string | null>;
  /** The message entered the session: the delivery line in the thread, with the time. */
  delivered(text: string): void;
  /** The stage began finishing: a message that arrives now is not seen and comes back in the closing line. */
  closing(): void;
  /** The delivery is over (well or badly): the queue closes and whoever waits is let go. */
  close(): void;
  /** Whether the stage is finishing: the tools may say so to the agent. */
  readonly isClosing: boolean;
  /** Queues a message for the agent without waiting for a step; false when the stage is already finishing (the message comes back in the closing line). */
  post(text: string, asked?: boolean): boolean;
}

/** The answer type of a message nobody expects an answer from: what a stage that closes says about it. */
const SAY = { message: 'runner.message.afterClose', asks: 'runner.message.afterCloseAsk' } as const;

/** The mailboxes of the stages that are working, by run id: what a message of the thread is routed to. */
const live = new Map<string, StageInbox>();

/** The mailbox of a run's working stage, when there is one. */
export function inboxOf(runId: string): StageInbox | null {
  return live.get(runId) ?? null;
}

/**
 * Opens the mailbox of one attempt at a stage. `forum` is where the delivery and the closing lines are written; `now` gives the time they carry.
 */
export function openInbox(runId: string, stage: string, agent: string, forum: ForumStore, now: () => string): StageInbox {
  const thread = runThreadId(runId);
  const queued: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let closing = false;
  const flush = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  const append = (draft: ForumDraft): void => {
    try {
      forum.append(thread, draft);
    } catch (e) {
      console.error('[runner] could not record a message of the stage', runId, e instanceof Error ? e.message : e);
    }
  };
  // A message that arrived while the stage was working and did not make it into the session: the thread says so, and says whether it asked something.
  const missed = (text: string, asked: boolean): void => {
    append({ kind: 'system', author: { type: 'app' }, code: asked ? SAY.asks : SAY.message, params: { agent, text: text.slice(0, 600) }, stage });
  };
  const inbox: StageInbox = {
    async next() {
      for (;;) {
        if (queued.length) return queued.shift() as string;
        if (closed) return null;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
    delivered(text) {
      append({ kind: 'system', author: { type: 'app' }, code: 'runner.message.delivered', params: { agent, at: now(), text: text.slice(0, 600) }, stage });
    },
    get isClosing() {
      return closing;
    },
    closing() {
      if (closing) return;
      closing = true;
      // Whatever is still queued is not handed over; the stage ends with what it has and the thread says why.
      const left = queued.splice(0);
      for (const text of left) missed(text, false);
    },
    post(text, asked = false) {
      if (closing) {
        // The stage is already finishing: the message enters no session, not even briefly, and the thread is where it is answered for.
        missed(text, asked);
        return false;
      }
      queued.push(text);
      flush();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      if (live.get(runId) === inbox) live.delete(runId);
      flush();
    },
  };
  live.set(runId, inbox);
  return inbox;
}