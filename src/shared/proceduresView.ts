import { PROCEDURE_KINDS, awaitsReview, compareAll, isOld, type ProcedureKind, type ProcedureRecord, type ProcedureState, type ProcedureStep, type ProcedureSurface, type StepsFrom, FAILING_OUT_OF_LIST } from './procedures';

// What the Procedures view reads from the app: a line per record for the list, one record in full, and the workspace's figures. The same shapes serve the desktop window and
// a paired browser (both read); the writes answer with `ProcedureWrite`. Pure: the main side builds them from the store, the renderer filters and sorts what it got.

/** One record as the list shows it: enough to find and judge it, none of its steps. */
export interface ProcedureSummary {
  id: string;
  revision: number;
  kind: ProcedureKind;
  key: string;
  title: string;
  state: ProcedureState;
  /** The person looked at this revision, or wrote it. */
  reviewed: boolean;
  /** The agent that wrote this revision, or `person`. */
  by: string;
  surface: ProcedureSurface;
  /** When this revision was written. */
  at: string;
  lastVerified: string | null;
  lastUsed: string | null;
  uses: number;
  failures: number;
  /** Not verified for 90 days: listed as old, never dropped. */
  old: boolean;
  /** Failed twice since it was last saved: the agents' prompt list leaves it out; the person still sees it. */
  withheld: boolean;
  hasPrevious: boolean;
  /** Written while the person used the agent's screen: no agent reads it until the person reviews it. */
  awaitsReview: boolean;
}

export interface ProcedureListView {
  items: ProcedureSummary[];
  /** Files in the folder this app could not read (a newer app's, or not a record). */
  skipped: number;
  /** The workspace's switch: off, agents neither read nor write, and the view still works. */
  enabled: boolean;
}

export interface ProcedureStatsView {
  total: number;
  byKind: Record<ProcedureKind, number>;
  unreviewed: number;
  failing: number;
  old: number;
  /** The record that was verified (or written) longest ago. */
  oldest: { id: string; title: string; at: string } | null;
  enabled: boolean;
  /** The sums of the savings the view shows, with the same approximate label. */
  saved: ReturnType<typeof compareAll>;
}

export type ProcedureGet = { status: 'ok'; record: ProcedureRecord } | { status: 'missing' | 'deleted' | 'invalid' } | { status: 'newer'; v: number };

/** What a write by the person answers: the record as stored, or why not. A refusal of the validator carries every field it named. */
export type ProcedureWrite =
  | { ok: true; record: ProcedureRecord }
  | { ok: false; code: string; text: string; refusals?: { field: string; code: string; text: string }[]; id?: string };

export type ProcedureDelete = { ok: true } | { ok: false; code: 'not-found' | 'newer' | 'io' };

/**
 * An offer to keep a procedure, as the card in a thread shows it (#187): the text the app drafted and would save, and what the person needs to judge it. The work's usage and
 * the reference of the run stay on the main side.
 */
export interface OfferView {
  offerId: string;
  thread: string;
  /** The agent whose work this is. */
  agent: string;
  kind: 'gui' | 'repo' | 'tool';
  key: string;
  /** A title to start from; the person may change it before saying yes. */
  title: string;
  steps: ProcedureStep[];
  pitfalls: string[];
  waits: string[];
  /** Commands the app left out of the draft for safety, by count. */
  leftOut: number;
  /** The person used the agent's screen in this work: a yes is still reviewed, and the card says what they typed may be in the text. */
  handoff: boolean;
  stepsFrom: StepsFrom;
  /** The draft is of a screen (a yes or a no moves the screen's draft mark). */
  screen: boolean;
  stage?: string;
  /** When it was raised, and when it goes away unanswered (ISO). */
  at: string;
  expiresAt: string;
}

export function summarize(r: ProcedureRecord, now: number): ProcedureSummary {
  return {
    id: r.id,
    revision: r.revision,
    kind: r.kind,
    key: r.key,
    title: r.title,
    state: r.state,
    reviewed: r.reviewed,
    by: r.origin.by,
    surface: r.origin.surface,
    at: r.origin.at,
    lastVerified: r.lastVerified,
    lastUsed: r.stats.lastUsed,
    uses: r.stats.uses,
    failures: r.stats.failures,
    old: isOld(r, now),
    withheld: r.stats.failuresSinceSave >= FAILING_OUT_OF_LIST,
    hasPrevious: r.previous !== null,
    awaitsReview: awaitsReview(r),
  };
}

export function statsOf(records: readonly ProcedureRecord[], enabled: boolean, now: number): ProcedureStatsView {
  const byKind = Object.fromEntries(PROCEDURE_KINDS.map((k) => [k, 0])) as Record<ProcedureKind, number>;
  let oldest: ProcedureStatsView['oldest'] = null;
  for (const r of records) {
    byKind[r.kind]++;
    const at = r.lastVerified ?? r.origin.at;
    if (!oldest || at < oldest.at) oldest = { id: r.id, title: r.title, at };
  }
  return {
    total: records.length,
    byKind,
    unreviewed: records.filter((r) => !r.reviewed).length,
    failing: records.filter((r) => r.state === 'failing').length,
    old: records.filter((r) => isOld(r, now)).length,
    oldest,
    enabled,
    saved: compareAll(records.map((r) => r.stats)),
  };
}

export interface ProcedureFilters {
  kind: ProcedureKind | '';
  state: ProcedureState | '';
  /** The agent that wrote the revision, or `person`. */
  by: string;
  key: string;
  unreviewed: boolean;
  search: string;
}

export const NO_FILTERS: ProcedureFilters = { kind: '', state: '', by: '', key: '', unreviewed: false, search: '' };

const KIND_RANK = Object.fromEntries(PROCEDURE_KINDS.map((k, i) => [k, i])) as Record<ProcedureKind, number>;
const STATE_RANK: Record<ProcedureState, number> = { failing: 0, unverified: 1, ok: 2 };

/** The list as filtered: every condition set must hold; the search reads the title and the key without regard to case. */
export function filterProcedures(items: readonly ProcedureSummary[], f: ProcedureFilters): ProcedureSummary[] {
  const q = f.search.trim().toLowerCase();
  return items.filter(
    (p) =>
      (!f.kind || p.kind === f.kind) &&
      (!f.state || p.state === f.state) &&
      (!f.by || p.by === f.by) &&
      (!f.key || p.key === f.key) &&
      (!f.unreviewed || !p.reviewed) &&
      (!q || p.title.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)),
  );
}

/** What needs the person first: failing, then the ones not reviewed, then by kind, key and title. */
export function sortProcedures(items: readonly ProcedureSummary[]): ProcedureSummary[] {
  return [...items].sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      Number(a.reviewed) - Number(b.reviewed) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.key.localeCompare(b.key) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

/** What the filters offer to pick from: the distinct values in the list, sorted. */
export const distinct = (items: readonly ProcedureSummary[], pick: (p: ProcedureSummary) => string): string[] => [...new Set(items.map(pick))].sort((a, b) => a.localeCompare(b));
