import type { ClaudeOwnedSession } from '../../shared/claudeSessions';

// The Claude Code sessions whose process the app started (a new one, or a resume or a copy of the person's): the only ones it may end. Each keeps its process alive between
// messages through an input queue, so a second message goes to the same process. #282 adds the Remote Control option when starting and reads this same registry.

/** A user message as the SDK's streaming input takes it. */
export interface InputMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

export interface InputQueue {
  iterable: AsyncIterable<InputMessage>;
  push(text: string): void;
  /** No more input: the process ends after its current turn. */
  close(): void;
}

export function inputQueue(): InputQueue {
  const pending: InputMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const iterable: AsyncIterable<InputMessage> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = pending.shift();
        if (next) {
          yield next;
          continue;
        }
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
  const poke = (): void => wake?.();
  return {
    iterable,
    push(text) {
      if (closed) return;
      pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' });
      poke();
    },
    close() {
      closed = true;
      poke();
    },
  };
}

export interface Driven extends ClaudeOwnedSession {
  push(text: string): void;
  interrupt(): Promise<void>;
  /** Ends the process: closes the input and aborts the query. */
  end(): void;
}

export interface OwnedRegistry {
  get(sessionId: string): Driven | undefined;
  set(d: Driven): void;
  remove(sessionId: string): void;
  list(): ClaudeOwnedSession[];
  all(): Driven[];
}

export function createOwned(): OwnedRegistry {
  const map = new Map<string, Driven>();
  return {
    get: (id) => map.get(id),
    set: (d) => void map.set(d.sessionId, d),
    remove: (id) => void map.delete(id),
    list: () => [...map.values()].map(({ sessionId, cwd, busy, forked, of }) => ({ sessionId, cwd, busy, forked, of })),
    all: () => [...map.values()],
  };
}
