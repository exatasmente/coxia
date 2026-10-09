// The rest of a busy model, for the whole app: a model that refused for good (rate limit, overload, server error after the client's retries) is left alone for a
// while by every run, then comes back. In memory only: a restart forgets it, so nothing is left over from an error of yesterday.

/** How long a model rests when the server did not say. */
export const DEFAULT_REST_MS = 5 * 60_000;
/** The longest a Retry-After may keep a model out. */
export const MAX_REST_MS = 15 * 60_000;

/**
 * What identifies the thing that refuses: the server, the model and the key (two keys on one server have their own limits). The same care as the client cache of the bridge.
 */
export function restKey(p: { baseUrl: string; model: string; secretRef?: string | null }): string {
  return `${p.baseUrl.replace(/\/+$/, '')}|${p.model}|${p.secretRef ?? ''}`;
}

/** The rest to apply for a refusal: the server's own word (capped), else the default. A Retry-After of zero says nothing about when the model is free. */
export function restFor(ms: number | undefined): number {
  return ms !== undefined && Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_REST_MS) : DEFAULT_REST_MS;
}

export interface RestRegistry {
  /** Puts the model to rest; returns when it is back (epoch ms). A longer rest already there is kept. */
  rest(key: string, ms?: number): number;
  /** When the model is back (epoch ms), or null when it is not resting. */
  until(key: string): number | null;
  resting(key: string): boolean;
  clear(): void;
}

export function createRestRegistry(now: () => number = Date.now): RestRegistry {
  const until = new Map<string, number>();
  const get = (key: string): number | null => {
    const at = until.get(key);
    if (at === undefined) return null;
    if (at <= now()) {
      until.delete(key);
      return null;
    }
    return at;
  };
  return {
    rest(key, ms) {
      const at = now() + restFor(ms);
      const kept = get(key);
      const next = kept !== null && kept > at ? kept : at;
      until.set(key, next);
      return next;
    },
    until: get,
    resting: (key) => get(key) !== null,
    clear: () => until.clear(),
  };
}

/** The registry of the app. */
export const restRegistry: RestRegistry = createRestRegistry();
