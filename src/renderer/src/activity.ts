// What each job's agent runs are doing, as the main process reports it. DOM-free: the React side is in useActivity.ts.
import { ACTIVITY_RING, type ActivityEntry, runActive } from '../../shared/activity';

const entryKey = (e: ActivityEntry): string => `${e.runId}:${e.seq}`;
const order = (a: ActivityEntry, b: ActivityEntry): number => a.at - b.at || a.seq - b.seq;

/** `incoming` folded into `list`: one copy of each entry, oldest first, only the newest `cap` kept. Returns `list` itself when nothing is new. */
export function mergeEntries(list: readonly ActivityEntry[], incoming: readonly ActivityEntry[], cap = ACTIVITY_RING): readonly ActivityEntry[] {
  const seen = new Set(list.map(entryKey));
  const fresh = incoming.filter((e) => !seen.has(entryKey(e)) && seen.add(entryKey(e)));
  if (!fresh.length) return list;
  const last = list[list.length - 1];
  const merged = last && fresh.every((e) => order(last, e) < 0) ? [...list, ...fresh.sort(order)] : [...list, ...fresh].sort(order);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/** The runs of these entries that have not reported their end. */
export function activeRunIds(entries: readonly ActivityEntry[]): string[] {
  const list = entries as ActivityEntry[];
  return [...new Set(list.map((e) => e.runId))].filter((id) => runActive(list, id));
}

/** The step to show on one line: the newest entry. */
export function latestStep(entries: readonly ActivityEntry[]): ActivityEntry | null {
  return entries[entries.length - 1] ?? null;
}

/** Whether a scrolled list is at its end (within `slack` px), so new lines should keep it there. */
export function atBottom(box: { scrollTop: number; clientHeight: number; scrollHeight: number }, slack = 24): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= slack;
}

export interface ActivityStoreOptions {
  cap?: number;
}

const NONE: readonly ActivityEntry[] = [];

export function createActivityStore(options: ActivityStoreOptions = {}) {
  const cap = options.cap ?? ACTIVITY_RING;
  let byJob: ReadonlyMap<string, readonly ActivityEntry[]> = new Map();
  const listeners = new Set<() => void>();

  const publish = (next: Map<string, readonly ActivityEntry[]>): void => {
    byJob = next;
    for (const l of [...listeners]) l();
  };

  /** One entry pushed by the main process. A run no job asked for is kept under ''. */
  function add(entry: ActivityEntry): void {
    const key = entry.jobId ?? '';
    const prev = byJob.get(key) ?? NONE;
    const next = mergeEntries(prev, [entry], cap);
    if (next !== prev) publish(new Map(byJob).set(key, next));
  }

  /** What the main process still holds for a job (or for the unattributed runs, with ''), merged with what is already here. */
  function backfill(jobId: string, entries: readonly ActivityEntry[]): void {
    const prev = byJob.get(jobId) ?? NONE;
    const next = mergeEntries(prev, entries, cap);
    if (next !== prev) publish(new Map(byJob).set(jobId, next));
  }

  /** A job starts over: what an earlier run of the same key did is no longer its story. */
  function reset(jobId: string): void {
    if (!byJob.has(jobId)) return;
    const next = new Map(byJob);
    next.delete(jobId);
    publish(next);
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  return {
    add,
    backfill,
    reset,
    subscribe,
    entries: (jobId: string): readonly ActivityEntry[] => byJob.get(jobId) ?? NONE,
    snapshot: (): ReadonlyMap<string, readonly ActivityEntry[]> => byJob,
  };
}

export type ActivityStore = ReturnType<typeof createActivityStore>;

/** The still-running runs of every bucket that no job on the screen owns: the "agent" entry of the dock. */
export function strayActivity(all: ReadonlyMap<string, readonly ActivityEntry[]>, owned: ReadonlySet<string>): readonly ActivityEntry[] {
  const picked: ActivityEntry[] = [];
  for (const [key, entries] of all) {
    if (owned.has(key)) continue;
    const live = new Set(activeRunIds(entries));
    picked.push(...entries.filter((e) => live.has(e.runId)));
  }
  return picked.sort(order);
}
