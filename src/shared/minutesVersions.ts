import { effectKey } from './efeitos';
import type { Card, Decision, Effect, Minutes, SavedCeremony, WrittenDecision } from './types';

// Every pre-daily held on a day is a version of that day's minutes. This file holds the shapes of the day index and the pure rules on them:
// what changed since the previous version, and the minutes of the whole day (the latest decision of an activity wins).

export type CoverStatus = 'new' | 'unchanged' | 'changed';

export interface Covered {
  ref: string;
  iid: string;
  title: string;
  status: CoverStatus;
  // What the team chat text of a version or of the day is written from.
  url: string;
  stage: string | null;
  blockers: string[];
  changes: string[];
}

// What a version says, kept in the index so the diff and the day view survive the purge of the ceremony file.
export interface MinutesSnapshot {
  decisions: Decision[];
  effects: Effect[];
  unanswered: { ref: string; question: string }[];
  covered: Covered[];
}

export interface MinutesVersion {
  n: number;
  ceremonyId: string;
  startedAt: number | null;
  endedAt: number | null;
  // Set when the minutes were written to disk.
  savedAt: string | null;
  file: string | null;
  teams: string | null;
  written: WrittenDecision[];
  snapshot: MinutesSnapshot;
}

export interface DayIndex {
  version: 1;
  date: string;
  versions: MinutesVersion[];
  // What the app wrote itself after a meeting (a decision in a spec, a card note): the next meeting does not count it as news.
  selfWrites?: { files: Record<string, number>; notes: Record<string, string> };
  // The team chat text of the whole day, with what it was written from.
  dayTeams: { key: string; text: string; at: string } | null;
}

export const norm = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

const decisionKey = (d: Pick<Decision, 'ref' | 'text'>): string => `${d.ref}\n${norm(d.text)}`;

type SnapshotSource = Pick<SavedCeremony, 'cards' | 'turns' | 'answered' | 'decisions' | 'effects' | 'spoken'>;

export function snapshotOf(s: SnapshotSource): MinutesSnapshot {
  const cards = s.cards?.cards ?? [];
  return {
    decisions: s.decisions,
    effects: s.effects,
    unanswered: cards.map((c) => ({ ref: c.ref, question: s.turns[c.ref]?.question ?? null })).filter((u): u is { ref: string; question: string } => !!u.question && !s.answered[u.ref]),
    covered: cards
      .filter((c) => s.spoken?.[c.ref] || s.turns[c.ref]?.sameDay)
      .map((c) => ({ ref: c.ref, iid: c.iid, title: c.title, status: s.turns[c.ref]?.sameDay?.kind ?? 'new', url: c.url, stage: c.stage, blockers: c.blockers, changes: c.changes })),
  };
}

export interface VersionDiff {
  // The version compared against; null for the first of the day.
  base: number | null;
  decisionsAdded: Decision[];
  decisionsChanged: { ref: string; before: Decision[]; after: Decision[] }[];
  effectsAdded: Effect[];
  questionsResolved: { ref: string; question: string }[];
  questionsNew: { ref: string; question: string }[];
  activitiesNew: Covered[];
  activitiesUnchanged: Covered[];
  activitiesChanged: Covered[];
  empty: boolean;
}

const byRef = <T extends { ref: string }>(items: T[]): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const i of items) out.set(i.ref, [...(out.get(i.ref) ?? []), i]);
  return out;
};

export function diffVersions(prev: MinutesVersion | null, cur: MinutesSnapshot): VersionDiff {
  const before = prev?.snapshot ?? { decisions: [], effects: [], unanswered: [], covered: [] };
  const prevDecisions = byRef(before.decisions);
  const added: Decision[] = [];
  const changed: VersionDiff['decisionsChanged'] = [];
  for (const [ref, now] of byRef(cur.decisions)) {
    const old = prevDecisions.get(ref);
    if (!old) added.push(...now);
    else if (now.some((d) => !old.some((o) => decisionKey(o) === decisionKey(d)))) changed.push({ ref, before: old, after: now });
  }
  const prevEffects = new Set(before.effects.map(effectKey));
  const coveredNow = new Set(cur.covered.map((c) => c.ref));
  const prevCovered = new Set(before.covered.map((c) => c.ref));
  const unansweredNow = new Map(cur.unanswered.map((u) => [u.ref, u.question]));
  const unansweredBefore = new Map(before.unanswered.map((u) => [u.ref, u.question]));
  const resolved = before.unanswered.filter((u) => coveredNow.has(u.ref) && !unansweredNow.has(u.ref));
  const fresh = cur.unanswered.filter((u) => norm(unansweredBefore.get(u.ref) ?? '') !== norm(u.question));
  const activitiesNew = cur.covered.filter((c) => !prevCovered.has(c.ref));
  const repeated = cur.covered.filter((c) => prevCovered.has(c.ref));
  const diff: VersionDiff = {
    base: prev?.n ?? null,
    decisionsAdded: added,
    decisionsChanged: changed,
    effectsAdded: cur.effects.filter((e) => !prevEffects.has(effectKey(e))),
    questionsResolved: resolved,
    questionsNew: fresh,
    activitiesNew,
    activitiesUnchanged: repeated.filter((c) => c.status === 'unchanged'),
    activitiesChanged: repeated.filter((c) => c.status !== 'unchanged'),
    empty: false,
  };
  diff.empty = !(added.length || changed.length || diff.effectsAdded.length || resolved.length || fresh.length || activitiesNew.length || repeated.length);
  return diff;
}

/** The version before `n` that still exists (a deleted version leaves a gap, not a renumbering). */
export function previousOf(versions: MinutesVersion[], n: number): MinutesVersion | null {
  return [...versions].filter((v) => v.n < n).sort((a, b) => b.n - a.n)[0] ?? null;
}

export interface MergedDay {
  versions: number[];
  startedAt: number | null;
  endedAt: number | null;
  // The latest version's decisions for each activity, tagged with the version they come from; the older ones it replaced are in `superseded`.
  decisions: (Decision & { version: number })[];
  superseded: (Decision & { version: number })[];
  effects: (Effect & { version: number })[];
  unanswered: { ref: string; question: string; version: number }[];
  covered: Covered[];
}

export function mergeDay(versions: MinutesVersion[]): MergedDay {
  const sorted = [...versions].sort((a, b) => a.n - b.n);
  const decisions = new Map<string, (Decision & { version: number })[]>();
  const superseded: MergedDay['superseded'] = [];
  const effects = new Map<string, Effect & { version: number }>();
  const unanswered = new Map<string, { ref: string; question: string; version: number }>();
  const covered = new Map<string, Covered>();
  for (const v of sorted) {
    for (const [ref, now] of byRef(v.snapshot.decisions)) {
      const old = decisions.get(ref) ?? [];
      superseded.push(...old.filter((o) => !now.some((d) => decisionKey(d) === decisionKey(o))));
      decisions.set(ref, now.map((d) => ({ ...d, version: v.n })));
    }
    for (const e of v.snapshot.effects) if (!effects.has(effectKey(e))) effects.set(effectKey(e), { ...e, version: v.n });
    // A question stays open until a later version that covers the activity no longer has it.
    for (const c of v.snapshot.covered) {
      unanswered.delete(c.ref);
      covered.set(c.ref, c);
    }
    for (const u of v.snapshot.unanswered) unanswered.set(u.ref, { ...u, version: v.n });
  }
  const starts = sorted.map((v) => v.startedAt).filter((x): x is number => x !== null);
  const ends = sorted.map((v) => v.endedAt).filter((x): x is number => x !== null);
  return {
    versions: sorted.map((v) => v.n),
    startedAt: starts.length ? Math.min(...starts) : null,
    endedAt: ends.length ? Math.max(...ends) : null,
    decisions: [...decisions.values()].flat(),
    superseded,
    effects: [...effects.values()],
    unanswered: [...unanswered.values()],
    covered: [...covered.values()],
  };
}

/** The whole day as the Minutes the team chat text is written from. */
export function dayMinutes(day: MergedDay): Minutes {
  const iso = (ms: number | null) => new Date(ms ?? Date.now()).toISOString();
  return {
    startedAt: iso(day.startedAt),
    endedAt: iso(day.endedAt),
    decisions: day.decisions.map(({ version: _v, ...d }) => d),
    effects: day.effects.map(({ version: _v, ...e }) => e),
    unanswered: day.unanswered.map(({ version: _v, ...u }) => u),
    transcript: [],
  };
}

/** The cards a team chat text lists, from what the version or the day covered. */
export function coveredCards(covered: Covered[]): Card[] {
  return covered.map((c) => ({ ref: c.ref, iid: c.iid, title: c.title, stage: c.stage, spec: null, mrs: [], mrPaths: [], blockers: c.blockers, pending: [], changes: c.changes, note: null, url: c.url }));
}

/** One version as the Minutes the team chat text is written from. */
export function versionMinutes(v: MinutesVersion): Minutes {
  const iso = (ms: number | null) => new Date(ms ?? Date.now()).toISOString();
  return { startedAt: iso(v.startedAt), endedAt: iso(v.endedAt), decisions: v.snapshot.decisions, effects: v.snapshot.effects, unanswered: v.snapshot.unanswered, transcript: [] };
}

/** What the day's team chat text is written from; it is written again only when this changes. */
export function dayKey(day: MergedDay): string {
  return JSON.stringify({ d: day.decisions.map((d) => [d.ref, d.text]), e: day.effects.map((e) => [e.ref, e.text]), c: day.covered.map((c) => [c.ref, c.status]), u: day.unanswered.map((u) => [u.ref, u.question]) });
}

export const versionFile = (date: string, n: number): string => `${date}-pre-daily.v${n}.md`;
export const indexFile = (date: string): string => `${date}-pre-daily.versions.json`;
export const dayFile = (date: string): string => `${date}-pre-daily.md`;

// ---- what the screens read and what the deletion tells the person

export interface VersionView extends MinutesVersion {
  // The call of this version has not ended: it cannot be deleted yet.
  live: boolean;
  diff: VersionDiff;
  // Absolute path of the version's file, when the minutes were written.
  path: string | null;
}

export interface DayView {
  date: string;
  versions: VersionView[];
  merged: MergedDay;
  dayTeams: DayIndex['dayTeams'];
  dayKey: string;
  // The generated document with every version of the day.
  dayPath: string | null;
}

export interface Kept {
  n: number;
  ref: string;
  text: string;
  dest: string;
}

export interface DeletePreview {
  date: string;
  scope: 'versions' | 'day';
  versions: { n: number; startedAt: number | null; endedAt: number | null; file: string | null }[];
  // Names of the files that move to the trash.
  files: string[];
  // Ceremony records (transcript, what each agent said, deep dives) that move with them.
  ceremonies: number;
  // Why it cannot be done now (already worded for the person), or null.
  blocked: string | null;
  // What stays where it was written: deleting minutes does not undo any of it.
  kept: { registro: Kept[]; notes: Kept[]; effects: Kept[] };
  trashDays: number;
}

export interface TrashEntry {
  id: string;
  trashedAt: string;
  date: string;
  scope: 'versions' | 'day';
  versions: number[];
  ceremonies: number;
  ceremonyIds: string[];
  files: string[];
  daysLeft: number;
}

export const TRASH_DAYS = 30;
