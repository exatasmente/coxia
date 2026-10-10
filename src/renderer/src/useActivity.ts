import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ACTIVITY_EVENT, ACTIVITY_GET, type ActivityEntry, EVENTS_RECONNECTED } from '../../shared/activity';
import { api, moduleEvents } from './api';
import { type ActivityStore, createActivityStore } from './activity';
import { type TopEntry, type TreeNode, buildTree, topEntries } from './activityTree';
import { jobs } from './useJobs';

export const activity: ActivityStore = createActivityStore();

// The main process pushes each line as a module event; a job that starts again forgets its earlier lines.
moduleEvents.addEventListener(ACTIVITY_EVENT, (e) => activity.add((e as CustomEvent<ActivityEntry>).detail));
jobs.onStart((job) => activity.reset(job.key));

/** Asks the main process for what it still holds (a screen opened mid-run, a browser that reconnected). '' is the runs no job asked for.
 * After a reconnect (`live`), the entries are narrowed to what the screen already holds: no lines of an earlier run stitched in. */
export async function backfillActivity(jobId: string, live = false): Promise<void> {
  try {
    const entries = await api.invoke<ActivityEntry[]>(ACTIVITY_GET, jobId || null);
    if (Array.isArray(entries)) (live ? activity.backfillLive : activity.backfill)(jobId, entries);
  } catch {
    // the live lines keep coming; a missed backfill only leaves the timeline shorter
  }
}

// After the event stream dropped and came back, whatever was said in the gap is fetched again — narrowed, so the timeline keeps only this run's lines.
window.addEventListener(EVENTS_RECONNECTED, () => {
  const keys = new Set(['', ...jobs.snapshot().filter((j) => j.status === 'running').map((j) => j.key), ...activity.snapshot().keys()]);
  for (const key of keys) void backfillActivity(key, true);
});

/** The lines of one job's runs; a job that is running is backfilled once when the screen asks. */
export function useActivity(jobId: string | undefined): readonly ActivityEntry[] {
  const entries = useSyncExternalStore(activity.subscribe, () => (jobId === undefined ? NONE : activity.entries(jobId)));
  useEffect(() => {
    if (jobId !== undefined) void backfillActivity(jobId);
  }, [jobId]);
  return entries;
}

const NONE: readonly ActivityEntry[] = [];

/** The tree of one job's lines: its roots, with the sub-agents and called agents under them. Rebuilt only when the lines change. */
export function useActivityTree(jobId: string | undefined): TreeNode[] {
  const entries = useActivity(jobId);
  return useMemo(() => buildTree(entries), [entries]);
}

/**
 * What the dock lists that no running job owns: one entry per run or conversation with something working, and one per agent for any other activity (the scheduler's,
 * a ceremony answer). Its length is the badge.
 */
export function useTopEntries(ownedKeys: readonly string[]): TopEntry[] {
  const all = useSyncExternalStore(activity.subscribe, activity.snapshot);
  const owned = ownedKeys.join('\n');
  const tops = useMemo(() => topEntries(all, new Set(owned ? owned.split('\n') : [])), [all, owned]);
  useEffect(() => {
    void backfillActivity('');
  }, []);
  return tops;
}
