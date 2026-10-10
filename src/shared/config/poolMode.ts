import { DEFAULT_POOL_MODE, type Activity, type PoolMode } from './types';

// Which way a pool is used is chosen in three places, from the most specific: the agent, the stage of the cycle model, the workspace. Pure, so the runner, the
// ceremonies and the editors read it the same way.

/** The first mode that is set: agent, then stage, then workspace, then the default. */
export function resolvePoolMode(s: { agent?: PoolMode; stage?: PoolMode; workspace?: PoolMode }): PoolMode {
  return s.agent ?? s.stage ?? s.workspace ?? DEFAULT_POOL_MODE;
}

/** The activities whose lists make `switch` and `delegate` mean anything (`write` is the main model's own list). */
export const MODE_ACTIVITIES = ['explore', 'edit', 'shell', 'screen'] as const satisfies readonly Activity[];

/** `switch` and `delegate` need a list of their own for an activity; without one the pool is a plain fallback. */
export function effectivePoolMode(mode: PoolMode, lists: Partial<Record<Activity, readonly unknown[] | undefined>> | undefined): PoolMode {
  if (mode === 'fallback') return mode;
  return MODE_ACTIVITIES.some((a) => (lists?.[a]?.length ?? 0) > 0) ? mode : 'fallback';
}
