// Registry of long agent actions, so they outlive the screen that started them. DOM-free: the React side is in useJobs.ts.

import { t } from '../../shared/i18n';

export type JobStatus = 'running' | 'done' | 'failed';

export const RESULT_TTL_MS = 30 * 60_000;

let activeJob: string | null = null;

/** Runs `fn` as the work of a job: the calls it makes to the main process in its first synchronous stretch carry the job's id. */
export function withJob<T>(key: string | null, fn: () => T): T {
  const outer = activeJob;
  activeJob = key;
  try {
    return fn();
  } finally {
    activeJob = outer;
  }
}

export const currentJob = (): string | null => activeJob;

export interface JobMeta<S = unknown> {
  /** Shown in the panel and in notifications, in the language in force when the job starts. */
  label: string;
  /** The screen that shows the result. */
  screen: S;
  /** Spinner text on the owning screen while the job runs; falls back to the label. */
  busy?: string;
}

export interface Job<S = unknown, T = unknown> extends JobMeta<S> {
  readonly key: string;
  readonly status: JobStatus;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly error: string | null;
  readonly result: T | undefined;
  readonly promise: Promise<T>;
}

export interface JobStoreOptions {
  now?: () => number;
  ttlMs?: number;
  errorText?: (e: unknown) => string;
}

const plainError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createJobStore<S = unknown>(options: JobStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? RESULT_TTL_MS;
  const errorText = options.errorText ?? plainError;
  const jobs = new Map<string, Job<S>>();
  const listeners = new Set<() => void>();
  const finishListeners = new Set<(job: Job<S>) => void>();
  const startListeners = new Set<(job: Job<S>) => void>();
  let snap: readonly Job<S>[] = [];

  const alive = (j: Job<S>): boolean => j.finishedAt === null || now() - j.finishedAt < ttl;

  // Running first (oldest first), then the finished ones, newest first.
  const order = (a: Job<S>, b: Job<S>): number => {
    if (a.status === 'running' && b.status === 'running') return a.startedAt - b.startedAt;
    if (a.status === 'running') return -1;
    if (b.status === 'running') return 1;
    return (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
  };

  const publish = (): void => {
    snap = [...jobs.values()].sort(order);
    for (const l of [...listeners]) l();
  };

  /** Starts the action, or joins the one already running under the same key. A finished job under that key is replaced. */
  function run<T>(key: string, meta: JobMeta<S>, fn: () => Promise<T>): Promise<T> {
    const current = jobs.get(key);
    if (current?.status === 'running') return current.promise as Promise<T>;
    const promise = new Promise<T>((resolve) => resolve(withJob(key, fn)));
    const job: Job<S, T> = { ...meta, key, status: 'running', startedAt: now(), finishedAt: null, error: null, result: undefined, promise };
    jobs.set(key, job);
    publish();
    for (const l of [...startListeners]) l(job);
    const settle = (patch: { status: JobStatus; result?: T; error?: string }): void => {
      if (jobs.get(key) !== job) return;
      const next: Job<S, T> = { ...job, ...patch, error: patch.error ?? null, finishedAt: now() };
      jobs.set(key, next);
      publish();
      for (const l of [...finishListeners]) l(next);
    };
    promise.then(
      (result) => settle({ status: 'done', result }),
      (e) => settle({ status: 'failed', error: errorText(e) }),
    );
    return promise;
  }

  /** Same as run for callers that read the outcome through the registry. */
  function launch<T>(key: string, meta: JobMeta<S>, fn: () => Promise<T>): void {
    run(key, meta, fn).catch(() => undefined);
  }

  function get(key: string): Job<S> | undefined {
    const j = jobs.get(key);
    return j && alive(j) ? j : undefined;
  }

  function running(prefix: string): Job<S>[] {
    return snap.filter((j) => j.status === 'running' && j.key.startsWith(prefix));
  }

  /** Finished jobs under a key prefix, oldest first. */
  function finished(prefix: string): Job<S>[] {
    return snap
      .filter((j) => j.status !== 'running' && j.key.startsWith(prefix) && alive(j))
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  }

  /** Hands a finished job over to whoever shows it; it leaves the registry. */
  function take<T = unknown>(key: string): Job<S, T> | undefined {
    const j = jobs.get(key);
    if (!j || j.status === 'running') return undefined;
    jobs.delete(key);
    publish();
    return alive(j) ? (j as Job<S, T>) : undefined;
  }

  function dismiss(key: string): void {
    const j = jobs.get(key);
    if (!j || j.status === 'running') return;
    jobs.delete(key);
    publish();
  }

  function clearFinished(): void {
    let changed = false;
    for (const [key, j] of jobs) {
      if (j.status === 'running') continue;
      jobs.delete(key);
      changed = true;
    }
    if (changed) publish();
  }

  /** Drops the results nobody picked up in time. */
  function sweep(): void {
    let changed = false;
    for (const [key, j] of jobs) {
      if (alive(j)) continue;
      jobs.delete(key);
      changed = true;
    }
    if (changed) publish();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  function onFinish(listener: (job: Job<S>) => void): () => void {
    finishListeners.add(listener);
    return () => void finishListeners.delete(listener);
  }

  function onStart(listener: (job: Job<S>) => void): () => void {
    startListeners.add(listener);
    return () => void startListeners.delete(listener);
  }

  return { run, launch, get, running, finished, take, dismiss, clearFinished, sweep, subscribe, onFinish, onStart, snapshot: (): readonly Job<S>[] => snap };
}

export type JobStore<S = unknown> = ReturnType<typeof createJobStore<S>>;

/** m:ss, or h:mm:ss past the hour. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const sec = String(s % 60).padStart(2, '0');
  if (s < 3600) return `${Math.floor(s / 60)}:${sec}`;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${sec}`;
}

interface Located {
  name: string;
  ref?: string;
  id?: string;
  mr?: string;
}

/** Whether two screens show the same thing (a card or an action is part of the identity; the card payload is not). */
export function sameScreen(a: Located, b: Located): boolean {
  return a.name === b.name && a.ref === b.ref && a.id === b.id;
}

/** The serializable part of a screen: what a notification carries back to the app. */
export function screenPayload(screen: Located & { back?: string }): Record<string, string> {
  const out: Record<string, string> = { name: screen.name };
  for (const key of ['ref', 'id', 'mr', 'back'] as const) {
    const v = screen[key];
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

export function notificationText(job: Pick<Job, 'label' | 'status' | 'error'>): { title: string; body: string } {
  if (job.status === 'failed') return { title: t('ui.jobs.notify.failed', { label: job.label }), body: job.error ?? t('ui.jobs.notify.failedBody') };
  return { title: t('ui.jobs.notify.done', { label: job.label }), body: t('ui.jobs.notify.doneBody') };
}
