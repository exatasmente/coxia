// What each job's agent runs are doing, as the main process reports it. DOM-free: the React side is in useActivity.ts.
import { ACTIVITY_RING, type ActivityCall, type ActivityEntry, runActive } from '../../shared/activity';

const entryKey = (e: ActivityEntry): string => `${e.runId}:${e.seq}`;
const order = (a: ActivityEntry, b: ActivityEntry): number => a.at - b.at || a.seq - b.seq;

/** The runs a bucket holds before its oldest finished trees go: the main log's own bound (four times its 60 trees). */
export const BUCKET_RUNS_MAX = 240;

/**
 * `incoming` folded into `list`: one copy of each entry, oldest first. Each run keeps its newest `cap` lines, so what a sub-agent says never pushes a line of its
 * parent out of the bucket; past `maxRuns` distinct runs the oldest finished trees go whole. Returns `list` itself when nothing is new.
 */
export function mergeEntries(list: readonly ActivityEntry[], incoming: readonly ActivityEntry[], cap = ACTIVITY_RING, maxRuns = BUCKET_RUNS_MAX): readonly ActivityEntry[] {
  const seen = new Set(list.map(entryKey));
  const fresh = incoming.filter((e) => !seen.has(entryKey(e)) && seen.add(entryKey(e)));
  if (!fresh.length) return list;
  const last = list[list.length - 1];
  const merged = last && fresh.every((e) => order(last, e) < 0) ? [...list, ...fresh.sort(order)] : [...list, ...fresh].sort(order);
  return dropOldTrees(capPerRun(merged, new Set(fresh.map((e) => e.runId)), cap), maxRuns);
}

// Only the runs the new lines belong to can have grown past the cap. As in the main log, the newest status line of a run stays even when it is older than the rest.
function capPerRun(merged: ActivityEntry[], touched: ReadonlySet<string>, cap: number): ActivityEntry[] {
  const counts = new Map<string, number>();
  for (const e of merged) if (touched.has(e.runId)) counts.set(e.runId, (counts.get(e.runId) ?? 0) + 1);
  const skip = new Map([...counts].filter(([, n]) => n > cap).map(([id, n]) => [id, n - cap]));
  if (!skip.size) return merged;
  const pinned = new Map<string, ActivityEntry>();
  for (const e of merged) if (skip.has(e.runId) && e.kind === 'status' && e.state !== 'blocked') pinned.set(e.runId, e);
  const seenOf = new Map<string, number>();
  return merged.filter((e) => {
    const n = skip.get(e.runId);
    if (n === undefined) return true;
    const index = seenOf.get(e.runId) ?? 0;
    seenOf.set(e.runId, index + 1);
    return index >= n || pinned.get(e.runId) === e;
  });
}

// The distinct runs of a bucket are bounded like the main log's: the oldest tree with no node still going is dropped whole, and a live tree never is.
function dropOldTrees(entries: ActivityEntry[], maxRuns: number): ActivityEntry[] {
  if (entries.length <= maxRuns) return entries;
  const parentOf = new Map<string, string | null>();
  for (const e of entries) parentOf.set(e.runId, e.parent ?? null);
  if (parentOf.size <= maxRuns) return entries;
  const rootOf = (id: string): string => {
    let cur = id;
    for (let hops = 0; hops < 64; hops++) {
      const up = parentOf.get(cur);
      if (!up || !parentOf.has(up)) break;
      cur = up;
    }
    return cur;
  };
  const live = new Set(activeRunIds(entries));
  const trees = new Map<string, { runs: Set<string>; live: boolean }>();
  for (const e of entries) {
    const root = rootOf(e.runId);
    const tree = trees.get(root) ?? { runs: new Set<string>(), live: false };
    tree.runs.add(e.runId);
    tree.live ||= live.has(e.runId);
    trees.set(root, tree);
  }
  let runs = parentOf.size;
  const gone = new Set<string>();
  // `trees` is in the order of the oldest line of each, so the first finished one is the oldest.
  for (const tree of trees.values()) {
    if (runs <= maxRuns) break;
    if (tree.live) continue;
    for (const id of tree.runs) gone.add(id);
    runs -= tree.runs.size;
  }
  return gone.size ? entries.filter((e) => !gone.has(e.runId)) : entries;
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

/**
 * The words that stand for a line wherever only "the newest line" is shown. A thought is its translated word, never its text: the reasoning appears only where the
 * person opened it, so no collapsed row can print it.
 */
export const stepText = (entry: ActivityEntry, thoughtWord: string): string => (entry.kind === 'thought' ? thoughtWord : entry.label);

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
   * What came back after the event stream dropped and reconnected, narrowed: an entry stays only when its run was already here or is still going, or when the chain of
   * runs it hangs under reaches one that is (a sub-agent that began and ended in the gap belongs to the tree of its parent), so lines of an earlier run of the same
   * work are not stitched into the timeline. The plain `backfill` stands for a screen opened fresh.
   */
  function backfillLive(jobId: string, entries: readonly ActivityEntry[]): void {
    const prev = byJob.get(jobId) ?? NONE;
    const here = new Set(prev.map((p) => p.runId));
    const going = new Set(activeRunIds(entries));
    const parentOf = new Map<string, string>();
    for (const e of [...prev, ...entries]) if (e.parent) parentOf.set(e.runId, e.parent);
    const belongs = (runId: string): boolean => {
      const seenRuns = new Set<string>();
      for (let id: string | undefined = runId; id && !seenRuns.has(id); id = parentOf.get(id)) {
        if (here.has(id) || going.has(id)) return true;
        seenRuns.add(id);
      }
      return false;
    };
    const kept = entries.filter((e) => belongs(e.runId));
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
