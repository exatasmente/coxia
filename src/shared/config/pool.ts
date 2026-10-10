import type { Activity, ModelPool, ModelRef } from './types';

// Small pure edits of a model pool, shared by the config helpers and the editors. A pool with nothing in it is no pool: the field is left out, as it was before pools existed.

const copy = (list: ModelRef[]): ModelRef[] => list.map((r) => ({ ...r }));

/** The pool fields of a model, only what is there. */
export function poolFieldsOf(m: ModelPool): ModelPool {
  const activities = Object.entries(m.activities ?? {}).filter(([, l]) => l?.length);
  return {
    ...(m.fallbacks?.length ? { fallbacks: copy(m.fallbacks) } : {}),
    ...(activities.length ? { activities: Object.fromEntries(activities.map(([a, l]) => [a, copy(l!)])) as Partial<Record<Activity, ModelRef[]>> } : {}),
  };
}

/** The pool without the entries of a provider that is going away. */
export function poolWithoutProvider(m: ModelPool, providerId: string): ModelPool {
  const keep = (list: ModelRef[]) => list.filter((r) => r.provider !== providerId);
  const activities = Object.fromEntries(Object.entries(m.activities ?? {}).map(([a, l]) => [a, keep(l ?? [])]));
  return poolFieldsOf({ fallbacks: keep(m.fallbacks ?? []), activities });
}
