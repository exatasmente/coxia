// What each job's agent runs are doing, as the main process reports it. DOM-free: the React side is in useActivity.ts.
import { ACTIVITY_RING, type ActivityCall, type ActivityEntry, runActive } from '../../shared/activity';

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

/** One `@` call still going: the agent it asks, the message that named it, and the lines it has produced so far. */
export interface CallGroup {
  agent: string;
  /** The thread the call belongs to (`run-<id>`). */
  thread: string;
  /** The sequence of the message that named the agent. */
  message: number;
  /** The activity run that answers the call: what tells two calls of one agent apart. */
  runId: string;
  /** The newest line of the call: what a one-line notice shows. */
  entry: ActivityEntry;
  /** Every line of the call, oldest first. */
  entries: ActivityEntry[];
  /** When the call was accepted: where a call's own clock starts. */
  since: number;
}

/**
 * The `@` calls still going, one group per call, oldest first. A call is the activity run that answers it, and only the lines carrying a call
 * belong here: the work of a run's own stage has no call and is never part of a group.
 */
export function callGroups(entries: readonly ActivityEntry[]): CallGroup[] {
  const list = entries as ActivityEntry[];
  const buckets = new Map<string, ActivityEntry[]>();
  for (const e of list) {
    if (!e.call) continue;
    const bucket = buckets.get(e.runId);
    if (bucket) bucket.push(e);
    else buckets.set(e.runId, [e]);
  }
  const groups: CallGroup[] = [];
  for (const [runId, bucket] of buckets) {
    const lines = bucket.sort(order);
    if (!runActive(lines, runId)) continue;
    const { agent, thread, message } = lines[0].call as ActivityCall;
    groups.push({ agent, thread, message, runId, entry: lines[lines.length - 1], entries: lines, since: lines[0].at });
  }
  return groups.sort((a, b) => a.since - b.since || a.entry.seq - b.entry.seq);
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

  /**
   * What came back after the event stream dropped and reconnected, narrowed: an entry stays only when its run was already here or is still going, so lines of an
   * earlier run of the same work are not stitched into the timeline. The plain `backfill` stands for a screen opened fresh.
   */
  function backfillLive(jobId: string, entries: readonly ActivityEntry[]): void {
    const prev = byJob.get(jobId) ?? NONE;
    const kept = entries.filter((e) => prev.some((p) => p.runId === e.runId) || runActive(entries as ActivityEntry[], e.runId));
    if (!kept.length) return;
    const next = mergeEntries(prev, kept, cap);
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
    backfillLive,
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
