import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Screen } from './App';
import { errorText } from './api';
import { type Job, type JobMeta, createJobStore } from './jobs';

export const jobs = createJobStore<Screen>({ errorText });

export type { Job, JobMeta };
export type AppJobMeta = JobMeta<Screen>;

/** Everything a screen needs from the registry: the ones running under its key prefix, and the delivery of whatever finished. */
export interface JobHandlers<T> {
  /** Called once per finished job, whether it ended while the screen was open (late = false) or before it was opened (late = true). */
  done?: (result: T, job: Job<Screen, T>, late: boolean) => void;
  failed?: (error: string, job: Job<Screen, T>, late: boolean) => void;
}

export function useJobsSnapshot(): readonly Job<Screen>[] {
  return useSyncExternalStore(jobs.subscribe, jobs.snapshot);
}

/**
 * Re-attaches a screen to its jobs. Jobs are looked up by key prefix (`gate:app#101:`); the jobs still running are returned so the
 * screen can show its busy state, and each finished one is handed to the handlers once and leaves the registry.
 */
export function useJobs<T = unknown>(prefix: string | null, handlers: JobHandlers<T>): Job<Screen>[] {
  const snap = useJobsSnapshot();
  const latest = useRef(handlers);
  latest.current = handlers;
  const openedAt = useRef(Date.now());

  useEffect(() => {
    if (prefix === null) return;
    for (const j of jobs.finished(prefix)) {
      const job = jobs.take<T>(j.key);
      if (!job) continue;
      const late = (job.finishedAt ?? 0) < openedAt.current;
      if (job.status === 'done') latest.current.done?.(job.result as T, job, late);
      else latest.current.failed?.(job.error ?? '', job, late);
    }
  }, [snap, prefix]);

  return prefix === null ? [] : snap.filter((j) => j.status === 'running' && j.key.startsWith(prefix));
}

/** The text of the first running job (or the fallback) as the screen's busy line. */
export function busyText(running: Job<Screen>[], fallback: string | null = null): string | null {
  const j = running[0];
  return j ? (j.busy ?? j.label) : fallback;
}
