import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ACTIVITY_EVENT, ACTIVITY_GET, type ActivityEntry, EVENTS_RECONNECTED } from '../../shared/activity';
import { api, moduleEvents } from './api';
import { type ActivityStore, createActivityStore, strayActivity } from './activity';
import { jobs } from './useJobs';

export const activity: ActivityStore = createActivityStore();

// The main process pushes each line as a module event; a job that starts again forgets its earlier lines.
moduleEvents.addEventListener(ACTIVITY_EVENT, (e) => activity.add((e as CustomEvent<ActivityEntry>).detail));
jobs.onStart((job) => activity.reset(job.key));

/** Asks the main process for what it still holds (a screen opened mid-run, a browser that reconnected). '' is the runs no job asked for. */
export async function backfillActivity(jobId: string): Promise<void> {
  try {
    const entries = await api.invoke<ActivityEntry[]>(ACTIVITY_GET, jobId || null);
    if (Array.isArray(entries)) activity.backfill(jobId, entries);
  } catch {
    // the live lines keep coming; a missed backfill only leaves the timeline shorter
  }
}

// After the event stream dropped and came back, whatever was said in the gap is fetched again.
window.addEventListener(EVENTS_RECONNECTED, () => {
  const keys = new Set(['', ...jobs.snapshot().filter((j) => j.status === 'running').map((j) => j.key), ...activity.snapshot().keys()]);
  for (const key of keys) void backfillActivity(key);
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

/** The runs still going that no running job owns (the scheduler's, or a call that is not a job): the dock's "agent" entry. */
export function useStrayActivity(ownedKeys: readonly string[]): readonly ActivityEntry[] {
  const all = useSyncExternalStore(activity.subscribe, activity.snapshot);
  const owned = ownedKeys.join('\n');
  const stray = useMemo(() => strayActivity(all, new Set(owned ? owned.split('\n') : [])), [all, owned]);
  useEffect(() => {
    void backfillActivity('');
  }, []);
  return stray;
}
