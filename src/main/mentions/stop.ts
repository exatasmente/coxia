// The way to stop one answer of an agent in a conversation: a call that runs registers the abort it was given, and the person's Stop aborts it. Only the answer stops: the agent's
// screen stays open and starts its idle clock (the screen is closed by Close). A mention call that is not registered (a ceremony, a call that already ended) is not found,
// and Stop answers false for it.

export interface CallStops {
  /** A call of `agent` in `thread` is running and can be stopped by `abort`. Returns the way to take it back when the call ends. */
  register(thread: string, agent: string, abort: AbortController): () => void;
  /** Stops every running call of the agent in the thread; whether there was any. */
  stop(thread: string, agent: string): boolean;
  /** The calls that can be stopped, of one thread or of all. */
  running(thread?: string): { thread: string; agent: string }[];
}

const keyOf = (thread: string, agent: string): string => `${thread}\u0000${agent}`;

export function createCallStops(): CallStops {
  const calls = new Map<string, { thread: string; agent: string; aborts: Set<AbortController> }>();
  return {
    register(thread, agent, abort) {
      const key = keyOf(thread, agent);
      const entry = calls.get(key) ?? { thread, agent, aborts: new Set<AbortController>() };
      entry.aborts.add(abort);
      calls.set(key, entry);
      return () => {
        entry.aborts.delete(abort);
        if (entry.aborts.size === 0 && calls.get(key) === entry) calls.delete(key);
      };
    },
    stop(thread, agent) {
      const entry = calls.get(keyOf(thread, agent));
      if (!entry || entry.aborts.size === 0) return false;
      for (const abort of [...entry.aborts]) abort.abort();
      return true;
    },
    running: (thread) => [...calls.values()].filter((c) => thread === undefined || c.thread === thread).map((c) => ({ thread: c.thread, agent: c.agent })),
  };
}

/** The calls of this process. */
export const callStops: CallStops = createCallStops();
