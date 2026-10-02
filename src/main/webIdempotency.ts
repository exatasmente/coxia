import { t } from '../shared/i18n';
// A queued browser send may reach the server twice (the answer was lost, or the page and the service worker both replay it).
// The same key from the same device and channel runs the call once: a repeat joins the call in flight or gets the stored answer.
export interface Idempotency {
  run<T>(deviceId: string, channel: string, key: string, fn: () => Promise<T>): Promise<T>;
  size(): number;
}

export class IdempotencyConflict extends Error {}

interface Entry {
  channel: string;
  promise: Promise<unknown>;
  expiresAt: number;
}

export function createIdempotency(ttlMs = 15 * 60_000, max = 200, now: () => number = Date.now): Idempotency {
  const entries = new Map<string, Entry>();

  function sweep(): void {
    const t = now();
    for (const [k, e] of entries) if (e.expiresAt <= t) entries.delete(k);
    while (entries.size > max) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }
  }

  return {
    async run<T>(deviceId: string, channel: string, key: string, fn: () => Promise<T>): Promise<T> {
      sweep();
      const id = `${deviceId}:${key}`;
      const hit = entries.get(id);
      if (hit) {
        if (hit.channel !== channel) throw new IdempotencyConflict(t('main.web.idemUsed'));
        return hit.promise as Promise<T>;
      }
      const promise = fn();
      entries.set(id, { channel, promise, expiresAt: now() + ttlMs });
      // Only successes are kept: a failed call is retried by running it again.
      promise.catch(() => {
        if (entries.get(id)?.promise === promise) entries.delete(id);
      });
      return promise;
    },
    size: () => entries.size,
  };
}
