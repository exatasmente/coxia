import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from '../../shared/config/types';
import { cycleText } from '../../shared/cycles/text';
import { type HistoryEntry, type Run, type RunStatus, isTerminal } from '../../shared/runs';
import { redact } from '../errorlog-core';
import type { RunStore } from '../runs-core';

// The shared memory of the activities: one front per activity, projected from the state the run store already keeps and rendered for the text of a call.
// It lives in the workspace's own folder (never in a worktree: it would ride the pull request), the app is its only writer, and an agent receives a cut
// of it, never the file. Pure except for the store: no Electron, no model, no network.

/** The folder of the shared memory inside the workspace folder, and the one file it keeps for now. */
export const MEMORY_DIR = 'memory';
export const ACTIVITIES_FILE = 'activities.json';

/** The version of the file. A file a newer app wrote is not read and never overwritten. */
export const ACTIVITIES_VERSION = 1;

/** A front whose last update is older than this is rendered as probably finished; it is never dropped. */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** What a front says for the stage of a run whose stage is not a stage of its flow, by run status. */
const STATUS_STAGE: Partial<Record<RunStatus, string>> = {
  done: 'done',
  cancelled: 'cancelled',
  question: 'between',
  gate: 'between',
  'to-start': 'between',
  'to-accept': 'between',
  failed: 'failed',
  waiting: 'waiting',
};

export type ActivityLifecycle = 'open' | 'waiting-integration' | 'integrated' | 'cancelled' | 'failed';

/** One activity's front: what the app knows about it, derived from the run that stands for it. */
export interface ActivityFront {
  /** The key: the issue reference as the run writes it (`app#101`, `release:X.Y.Z`, `docs:<repo>`). */
  ref: string;
  iid: number | null;
  title: string;
  url: string | null;
  lifecycle: ActivityLifecycle;
  /** The front exists and no execution of the activity was ever created: only the reference is known (specification rule 8). */
  bare?: true;
  /** The stage the activity is in now, or the word for where it is between stages. Absent when nothing is known yet. */
  stage: { id: string; label: string; since: string } | null;
  /** The execution the front was projected from, so it can be projected again. Null for a bare front. */
  runId: string | null;
  squad: string | null;
  /** The agent working it now (the stage that is running), when there is one. */
  agent: string | null;
  /** The agent that last moved it. */
  lastAgent: string | null;
  decisions: string[];
  openQuestions: string[];
  stoppedAt: { text: string; stage: string | null; at: string } | null;
  lastHandoff: { text: string; from: string; to: string; at: string } | null;
  /** What the person wrote over the front, line by line; empty for a front nobody corrected. */
  correction: string[];
  /** Who wrote the trailing text of the front: the app, or the person who corrected it. */
  source: 'app' | 'person';
  updatedAt: string;
}

/** The whole record: the fronts by reference, and, per agent, where it last worked. */
export interface ActivityIndex {
  version: number;
  fronts: Record<string, ActivityFront>;
  /** The thumbnail of an agent: the activity and stage it was last seen in. Kept in the file so an agent's last activity survives a removed run. */
  agents: Record<string, { ref: string; stage: string | null; at: string }>;
}

export const emptyIndex = (): ActivityIndex => ({ version: ACTIVITIES_VERSION, fronts: {}, agents: {} });

export const activitiesPath = (dir: string): string => join(dir, MEMORY_DIR, ACTIVITIES_FILE);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The index as it is on disk; null when it is not there, is not ours, or a newer app wrote it (which is then never overwritten). */
export function readIndex(dir: string): ActivityIndex | null {
  const path = activitiesPath(dir);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ActivityIndex> | null;
    if (!raw || typeof raw !== 'object' || raw.version !== ACTIVITIES_VERSION || !raw.fronts || typeof raw.fronts !== 'object') return null;
    return {
      version: ACTIVITIES_VERSION,
      fronts: Object.fromEntries(Object.entries(raw.fronts).flatMap(([ref, f]) => (f && typeof f === 'object' && str((f as ActivityFront).ref) ? [[ref, f as ActivityFront]] : []))),
      agents: Object.fromEntries(Object.entries(raw.agents ?? {}).flatMap(([id, a]) => (a && typeof a === 'object' && str((a as { ref?: unknown }).ref) ? [[id, a as ActivityIndex['agents'][string]]] : []))),
    };
  } catch {
    return null;
  }
}

/** Writes the index whole and atomically: one writer, so a failure never leaves half a file behind. */
export function writeIndex(dir: string, index: ActivityIndex): void {
  const path = activitiesPath(dir);
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(index, null, 1)}\n`);
  renameSync(tmp, path);
}

/** Records that an activity exists before anything of it does (rule 8): reference, title, address and the instant. It stays until a run replaces it. */
export function ensureFront(dir: string, issue: { ref: string; iid: number | null; title: string; url: string | null }, at: string): void {
  const index = readIndex(dir) ?? emptyIndex();
  const before = index.fronts[issue.ref];
  if (before && !before.bare) return;
  index.fronts[issue.ref] = { ...(before ?? blankFront(issue.ref)), ...issue, bare: true, updatedAt: at };
  writeIndex(dir, index);
}

const blankFront = (ref: string): ActivityFront => ({
  ref,
  iid: null,
  title: ref,
  url: null,
  lifecycle: 'open',
  stage: null,
  runId: null,
  squad: null,
  agent: null,
  lastAgent: null,
  decisions: [],
  correction: [],
  openQuestions: [],
  stoppedAt: null,
  lastHandoff: null,
  source: 'app',
  updatedAt: new Date(0).toISOString(),
});

const MAX_FACT = 300;
const MAX_FACTS = 5;

const oneLine = (text: string): string => redact(text).replace(/\s+/g, ' ').trim().slice(0, MAX_FACT);

/** The stage word of a run: its flow's label in the given language, or where the run is when the stage is not one of its flow. */
function stageWord(run: Run, language: Language): string {
  const known = run.flow?.stages.find((s) => s.id === run.stage)?.label;
  if (known) return cycleText(known, language);
  const key = STATUS_STAGE[run.status];
  return key ? cycleText(`main.runner.activities.stage.${key}`, language) : run.stage;
}

const lifecycleOf = (run: Run): ActivityLifecycle => (run.status === 'cancelled' ? 'cancelled' : run.status === 'failed' ? 'failed' : isTerminal(run) ? (run.subject ? 'waiting-integration' : 'integrated') : 'open');

/** The agent of the last entry whose `by` is an agent of the team (a person and the app are not agents). */
function lastAgentOf(run: Run, team: readonly string[]): string | null {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const by = run.history[i].by;
    if (by !== 'person' && by !== 'app' && team.includes(by)) return by;
  }
  return null;
}

const entryOf = (entry: HistoryEntry): { text: string; stage: string | null } => ({ text: entry.detail ? oneLine(entry.detail) : entry.type, stage: entry.stage });

/** The newest entry of a kind, or null when there is none. */
function lastOf(run: Run, ...types: HistoryEntry['type'][]): HistoryEntry | null {
  for (let i = run.history.length - 1; i >= 0; i--) if (types.includes(run.history[i].type)) return run.history[i];
  return null;
}

/**
 * The front of an activity, projected from one run and from what the front already had. Pure: it reads the run, never the disk.
 * A correction the person made is kept (`source: 'person'`) until the next move of the run replaces the trailing text with the app's own words.
 */
export function frontOfActivity(run: Run, prior: ActivityFront | undefined, language: Language): ActivityFront {
  const agent = run.stages.find((s) => s.stage === run.stage && s.status === 'running')?.agent ?? null;
  const stopped = lastOf(run, 'completed', 'cancelled');
  // The last thing said to the activity with its text: the person's answer, or the work sent back to an earlier stage. The handoff a stage leaves for the
  // next one is a message of the thread and is not in the run file, so the front never claims it.
  const handoff = lastOf(run, 'answer', 'handback');
  const openQuestion = run.question && !run.question.holder ? oneLine(run.question.text) : null;
  // The correction the person made is one text: it stands in the front's trailing fields until the next move of the run takes them back.
  const corrected = prior?.source === 'person';
  const decisions = corrected ? [...prior.correction] : run.history.filter((h) => h.type === 'answer' || h.type === 'gate-approved' || h.type === 'gate-skipped').slice(-MAX_FACTS).reverse().flatMap((h) => (h.detail ? [oneLine(h.detail)] : []));
  const lastAgent = lastAgentOf(run, run.flow?.stages.flatMap((s) => (s.agent ? [s.agent] : [])) ?? []);
  return {
    ref: run.issue.ref,
    iid: run.issue.iid,
    title: run.issue.title,
    url: run.issue.url,
    lifecycle: lifecycleOf(run),
    stage: { id: run.stage, label: stageWord(run, language), since: run.updatedAt },
    runId: run.id,
    squad: run.squad ?? null,
    agent,
    lastAgent: lastAgent ?? (agent || prior?.lastAgent || null),
    decisions,
    correction: corrected ? [...prior.correction] : [],
    openQuestions: openQuestion ? [openQuestion] : [],
    stoppedAt: stopped ? { ...entryOf(stopped), at: stopped.at } : corrected ? null : (prior?.stoppedAt ?? null),
    lastHandoff: handoff?.detail && !corrected ? { text: oneLine(handoff.detail), from: handoff.by, to: agent ?? '', at: handoff.at } : corrected ? null : (prior?.lastHandoff ?? null),
    source: 'app',
    updatedAt: run.updatedAt,
  };
}

/**
 * The front of an activity as the store stands: projected from the newest run of the reference, or what the file had when no run is left. A correction the
 * person made (the front's own `source`) stands until the run moves past it: the newest run was not updated after the correction, so nothing new to say.
 */
export function claimFront(index: ActivityIndex, store: RunStore, ref: string, language: Language, runs: readonly Run[] = store.list()): ActivityFront | null {
  const run = runs
    .filter((r) => r.issue.ref === ref)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const prior = index.fronts[ref];
  if (run) {
    if (prior?.source === 'person' && prior.updatedAt >= run.updatedAt) return prior;
    return frontOfActivity(run, prior, language);
  }
  return prior ?? null;
}

/** The shared record of one workspace folder. The runner writes through it and the screens read through it; the file is never in a worktree. */
export interface SharedMemory {
  /** Adds or replaces the front of a run, from what it was before and what it is now. Never throws: a move of a run must not fail for this file. */
  upsert(before: Run | null, after: Run | null, language: Language): void;
  /** Records that an activity exists, before its first run does (rule 8). Never throws. */
  ensure(issue: { ref: string; iid: number | null; title: string; url: string | null }, at: string): void;
  /**
   * The whole index, each front rebuilt from the store of runs when the record does not hold it, oldest first. `runs` is the snapshot the caller already took: a call that
   * reads the record and other things of the runs lists the run files once, not once per front.
   */
  read(store: RunStore, language: Language, runs?: readonly Run[]): ActivityIndex;
  /** What a call is told: a cut of the record, already rendered as text. */
  render(store: RunStore, query: ActivityQuery, language: Language, runs?: readonly Run[]): string;
  /** The person's correction of one front: masked, capped, marked as theirs and kept for the next reader. Null when that activity is unknown. */
  correct(ref: string, text: string, store: RunStore, language: Language): ActivityFront | null;
}

export function createSharedMemory(dir: string, now: () => Date = () => new Date()): SharedMemory {
  const at = (): string => now().toISOString();
  const read = (store: RunStore, language: Language, snapshot?: readonly Run[]): ActivityIndex => {
    const index = readIndex(dir) ?? emptyIndex();
    const fronts: Record<string, ActivityFront> = {};
    const runs = snapshot ?? store.list();
    // Oldest first, so a rebuild with no `prior` still lands in the order the file keeps.
    for (const front of sortedFronts(index).reverse()) {
      const rebuilt = front.bare ? front : claimFront(index, store, front.ref, language, runs);
      if (rebuilt) fronts[front.ref] = rebuilt;
    }
    // An activity the record never learned about is still in the store: the reader adds it, so nothing that happened is invisible.
    for (const run of runs) fronts[run.issue.ref] ??= frontOfActivity(run, undefined, language);
    return { version: ACTIVITIES_VERSION, fronts, agents: index.agents };
  };
  return {
    upsert(before, after, language) {
      try {
        const ref = after?.issue.ref ?? before?.issue.ref ?? '';
        if (!ref) return;
        const index = readIndex(dir) ?? emptyIndex();
        // A move of the run reprojects the front and takes over the trailing text the person had corrected; a move that did not touch it does not.
        const prior = index.fronts[ref];
        const moved = (after ?? before) as Run;
        if (!(prior?.source === 'person' && prior.updatedAt > moved.updatedAt)) {
          index.fronts[ref] = frontOfActivity(moved, prior, language);
        }
        const who = index.fronts[ref].lastAgent;
        if (who) index.agents[who] = { ref, stage: index.fronts[ref].stage?.label ?? null, at: index.fronts[ref].updatedAt };
        writeIndex(dir, index);
      } catch (e) {
        console.error('[runner] could not update the shared memory', e instanceof Error ? e.message : e);
      }
    },
    ensure(issue, when) {
      try {
        ensureFront(dir, issue, when);
      } catch (e) {
        console.error('[runner] could not record the activity', e instanceof Error ? e.message : e);
      }
    },
    read,
    render(store, query, language, runs) {
      const index = read(store, language, runs);
      const fronts = selectFronts(index, query);
      return renderFronts(fronts, { language, now: at(), ...(query.agents?.length ? { thumbnails: query.onlyNamed ? thumbnailsOf(index, query.agents) : index.agents } : {}) });
    },
    correct(ref, text, store, language) {
      const index = read(store, language);
      const front = index.fronts[ref];
      if (!front) return null;
      const lines = redact(text)
        .slice(0, CORRECTION_MAX)
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, MAX_FACTS)
        .map((l) => l.slice(0, MAX_FACT));
      const corrected: ActivityFront = { ...front, source: 'person', correction: lines, updatedAt: at() };
      const stored = readIndex(dir) ?? emptyIndex();
      stored.fronts[ref] = corrected;
      writeIndex(dir, stored);
      return corrected;
    },
  };
}

/** What one call asks of the record: the activities and the agents the message named, or everything in progress. */
export interface ActivityQuery {
  /** The reference of the place the call happens in (a run's thread), when there is one. */
  ref?: string | null;
  /** The refs or numbers the message named. */
  refs?: string[];
  /** The agents the message named, and the owner of a direct conversation. */
  agents?: string[];
  /**
   * With the shared memory on: the section holds only what the call is about or named, whole, and only the named agents' thumbnails. The others in short are the index's
   * `act:` entries, not this section. Absent: the section is what it always was (the named fronts, else everything in progress; every thumbnail once an agent is named).
   */
  onlyNamed?: boolean;
}

/** Every front, the newest first: the order the record is read in. Pure. */
export const sortedFronts = (index: ActivityIndex): ActivityFront[] => Object.values(index.fronts).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

const tail = (ref: string): string => ref.split('#').pop() ?? ref;

/** The refs the record holds whose tail matches one of `names` (a number, or the part after the number in a reference). */
export function refsNamed(index: ActivityIndex, names: readonly string[]): string[] {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return [];
  return sortedFronts(index)
    .filter((f) => wanted.some((w) => w === f.ref.toLowerCase() || w === tail(f.ref).toLowerCase()))
    .map((f) => f.ref);
}

// The two cuts of the specification: what was named (whole), and what is in progress (a few lines), with a closing line that says the rest is there.
/** The most one call reads of the record. A front that does not fit is named in one line instead of being cut. */
export const SELECT_MAX = 2000;
/** A compact line says the reference, the title, the stage, the agent and where it stopped. */
const COMPACT_MAX = 160;
/** The most the person may paste as a correction. */
export const CORRECTION_MAX = 20_000;

const inProgress = (f: ActivityFront): boolean => f.lifecycle === 'open' || f.lifecycle === 'failed';

/** The lines of one front, short: reference, title, stage, agent and where it stopped. */
export function compactLine(f: ActivityFront): string {
  const parts = [`${f.ref} ${f.title}`.trim().slice(0, COMPACT_MAX), f.stage?.label ?? '', f.agent ?? '', f.stoppedAt?.text ?? ''].filter(Boolean);
  return `- ${parts.join(' · ')}`;
}

/** Whether a front is one of the activities still in progress (open or failed): the ones a ranking puts above the finished. */
export const isInProgress = inProgress;

// One front, whole, as text: what a call named, and what a stage is about. The words are read in the language the call is written in.
export function frontText(f: ActivityFront, now: string, language: Language): string {
  const word = (key: string): string => cycleText(key, language);
  const stale = Date.parse(now) - Date.parse(f.updatedAt) > STALE_AFTER_MS;
  const lines = [`${f.ref} ${f.title}`.trim()];
  if (f.url) lines.push(f.url);
  lines.push(`${word('main.runner.activities.stage')}: ${f.stage?.label ?? word('main.runner.activities.stage.none')}${stale ? ` (${word('main.runner.activities.stale')})` : ''}`);
  if (f.agent) lines.push(`${word('main.runner.activities.agent')}: ${f.agent}`);
  if (f.lastAgent && f.lastAgent !== f.agent) lines.push(`${word('main.runner.activities.lastAgent')}: ${f.lastAgent}`);
  if (f.openQuestions.length) lines.push(`${word('main.runner.activities.questions')}: ${f.openQuestions.join(' | ')}`);
  // What the person wrote over the front stands in place of what the app had put in the trailing fields.
  const decisions = f.source === 'person' && f.correction.length ? f.correction : f.decisions;
  if (decisions.length) lines.push(`${word('main.runner.activities.decisions')}: ${decisions.slice(0, MAX_FACTS).join(' | ')}`);
  if (f.stoppedAt) lines.push(`${word('main.runner.activities.stopped')}: ${f.stoppedAt.text}`);
  if (f.lastHandoff) lines.push(`${word('main.runner.activities.handoff')}: ${f.lastHandoff.text}`);
  lines.push(`${word('main.runner.activities.updated')}: ${f.updatedAt}`);
  return lines.join('\n');
}

/** What a query selects, newest first: the fronts it named, whole; otherwise the compact list of what is in progress. */
export function selectFronts(index: ActivityIndex, q: ActivityQuery): ActivityFront[] {
  const all = sortedFronts(index);
  const byRef = new Set([...(q.refs?.length ? refsNamed(index, q.refs) : []), ...(q.ref ? [q.ref] : [])]);
  const byAgent = new Set((q.agents ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean));
  const picked = all.filter((f) => byRef.has(f.ref) || (f.agent && byAgent.has(f.agent.toLowerCase())) || (f.lastAgent && byAgent.has(f.lastAgent.toLowerCase())));
  if (q.onlyNamed) return picked;
  return picked.length ? picked : all.filter(inProgress);
}

/** The thumbnails of the agents a query named, and nobody else's. */
export function thumbnailsOf(index: ActivityIndex, agents: readonly string[]): ActivityIndex['agents'] {
  const wanted = new Set(agents.map((a) => a.trim().toLowerCase()).filter(Boolean));
  return Object.fromEntries(Object.entries(index.agents).filter(([id]) => wanted.has(id.toLowerCase())));
}

/**
 * The text a call reads: the fronts of what was named, whole, and otherwise the compact list of what is in progress, with a closing line about what
 * the record holds besides it. Bounded by `SELECT_MAX`: a front that does not fit is said in one line that names it, never cut in the middle.
 */
export function renderFronts(fronts: readonly ActivityFront[], opts: { language: Language; now: string; thumbnails?: ActivityIndex['agents'] }): string {
  const now = opts.now;
  if (!fronts.length) return '';
  const parts: string[] = [];
  let used = 0;
  let left = 0;
  for (const f of fronts) {
    const whole = frontText(f, now, opts.language);
    if (whole.length > SELECT_MAX || used + whole.length > SELECT_MAX) {
      left++;
      continue;
    }
    parts.push(whole);
    used += whole.length;
  }
  if (left) parts.push(cycleText('main.runner.activities.leftOut', opts.language, { count: left }));
  const thumbs = Object.entries(opts.thumbnails ?? {});
  if (thumbs.length) parts.push(thumbs.map(([id, t]) => `- ${id}: ${t.ref}${t.stage ? ` · ${t.stage}` : ''}`).join('\n'));
  const older = fronts.filter((f) => !inProgress(f)).length;
  if (older) parts.push(cycleText('main.runner.activities.older', opts.language, { count: older }));
  return parts.join('\n\n');
}
