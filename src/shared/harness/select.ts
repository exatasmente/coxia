import { coversPath } from './evidence';
import type { HarnessEntry, HarnessKind, InvalidReason } from './format';

// What an agent is given of the documentation of a repository, and how much: pure, so the screen's counts, the delivery and the tests share it. The wording is
// the delivery's (it speaks in the language of the workspace); this module only decides which files, in which order, cut where, and which marks they carry.

/** Characters the documentation may take in one call (about 6 thousand tokens), reduced by the window a provider declares, never below the floor. */
export const BUDGET_MAX = 24_000;
export const BUDGET_MIN = 3_000;
/** The overview may take at most this share of the budget: it is always given, so it must not crowd out the rules. */
export const OVERVIEW_SHARE = 0.4;
/** A file that does not fit whole is given cut only when this much of it fits. */
export const CLIP_MIN = 600;
// What the delivery adds around a file (its name, the fence, the mark), counted so that the sum of the parts stays inside the budget.
const FRAME = 40;
const MARK = 220;
const CLIP_NOTE = 80;

/** The budget of one call: `min(24000, 3 * window * 0.15)` when the provider declares a context window (3 characters a token, 15% of it), the floor 3000. */
export function budgetFor(contextWindow: number | null | undefined): number {
  if (!contextWindow || contextWindow <= 0) return BUDGET_MAX;
  return Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.round(3 * contextWindow * 0.15)));
}

/** Where a file stands against the code it cites. `stale` and `unverified` are what `stale.ts` found; `invalid` is a file with no valid header. */
export type Mark =
  | { state: 'checked' }
  | { state: 'stale'; ref: string; changed: string[]; total: number }
  | { state: 'unverified'; reason: string }
  | { state: 'invalid'; reason: InvalidReason };

export interface SelectInput {
  entries: HarnessEntry[];
  /** The staleness of each file that parsed, by path inside `.coxia/`. */
  marks: Record<string, Mark>;
  /** The text of the files that did not parse and that the delivery wants (see `wantsInvalid`); the rest of them can only be indexed. */
  texts: Record<string, string>;
  /** The stage the call works, when it works one. */
  stage: { id: string; kind: string } | null;
  /** The paths of the repository the work touches. */
  paths: string[];
  /** The id of the agent that is called. */
  agent: string;
  budget: number;
}

export type Why = 'overview' | 'role' | 'evidence' | 'stage' | 'roles';

export interface Item {
  path: string;
  kind: HarnessKind;
  /** Null for a file that is checked. */
  mark: Mark | null;
  text: string;
  clipped: boolean;
  why: Why;
}

export interface IndexLine {
  path: string;
  kind: HarnessKind;
  summary: string | null;
  mark: Mark | null;
}

export interface Selection {
  overview: Item | null;
  picked: Item[];
  indexed: IndexLine[];
  /** Files that were chosen or indexed and did not fit: only their names go in the text. */
  notIncluded: string[];
}

/** The invalid files that are given to an agent all the same, with the mark: the overview, and the notes of the agent's own role (by name). */
export function wantsInvalid(entry: Pick<HarnessEntry, 'kind' | 'id'>, agent: string): boolean {
  return entry.kind === 'overview' || (entry.kind === 'role' && entry.id === agent);
}

/** The text cut at a line end when there is one near the limit, else at the limit. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max));
  const line = cut.lastIndexOf('\n');
  return (line > max * 0.6 ? cut.slice(0, line) : cut).trimEnd();
}

const frame = (path: string, mark: Mark | null): number => path.length + FRAME + (mark ? MARK : 0);

interface Candidate {
  entry: HarnessEntry;
  mark: Mark | null;
  text: string;
  why: Why;
  /** 0 the notes of the agent's role; 1 the rules over the paths of the work; 2 the rest chosen by stage or role; 3 the skills. */
  rank: number;
  covered: number;
}

/**
 * Which files an agent gets of one repository: the overview always; of the rules, skills and roles, the ones chosen by the stage (its id or its kind), by the agent
 * (its id in `roles`, or `roles/<id>.md`) or by evidence over a path the work touches; the others are listed in an index. What does not fit in the budget is cut
 * with a note or only named, never dropped without a word.
 */
export function selectDocs(input: SelectInput): Selection {
  const markOf = (e: HarnessEntry): Mark | null => {
    if (!e.parse.ok) return { state: 'invalid', reason: e.parse.reason };
    const m = input.marks[e.path];
    if (!m) return { state: 'unverified', reason: 'git' };
    return m.state === 'checked' ? null : m;
  };

  let overview: Item | null = null;
  const candidates: Candidate[] = [];
  const indexed: IndexLine[] = [];
  const notIncluded: string[] = [];

  for (const entry of input.entries) {
    const mark = markOf(entry);
    const file = entry.parse.ok ? entry.parse.file : null;
    const text = file ? file.body : (input.texts[entry.path] ?? null);
    if (entry.kind === 'overview') {
      if (text === null) {
        indexed.push({ path: entry.path, kind: entry.kind, summary: null, mark });
        continue;
      }
      const room = Math.max(0, Math.floor(input.budget * OVERVIEW_SHARE) - frame(entry.path, mark) - CLIP_NOTE);
      const clipped = text.length > room;
      overview = { path: entry.path, kind: entry.kind, mark, text: clipped ? clipText(text, room) : text, clipped, why: 'overview' };
      continue;
    }
    if (!file) {
      // No header: nothing says which stage, role or path it is for, so only the agent's own role notes go whole; the rest are named.
      if (text !== null && wantsInvalid(entry, input.agent)) candidates.push({ entry, mark, text, why: 'role', rank: 0, covered: 0 });
      else indexed.push({ path: entry.path, kind: entry.kind, summary: null, mark });
      continue;
    }
    const h = file.header;
    const own = entry.kind === 'role' && (entry.id === input.agent || h.roles.includes(input.agent));
    const byRole = h.roles.includes(input.agent);
    const byStage = !!input.stage && (h.stages.includes(input.stage.id) || h.stages.includes(input.stage.kind));
    const covered = input.paths.filter((p) => h.evidence.some((e) => coversPath(e, p))).length;
    if (!own && !byRole && !byStage && covered === 0) {
      indexed.push({ path: entry.path, kind: entry.kind, summary: h.summary, mark });
      continue;
    }
    const why: Why = own ? 'role' : covered > 0 ? 'evidence' : byStage ? 'stage' : 'roles';
    const rank = own ? 0 : entry.kind === 'skill' ? 3 : covered > 0 ? 1 : 2;
    candidates.push({ entry, mark, text: file.body, why, rank, covered });
  }

  candidates.sort((a, b) => a.rank - b.rank || b.covered - a.covered || (a.entry.path < b.entry.path ? -1 : 1));

  let left = input.budget - (overview ? overview.text.length + frame(overview.path, overview.mark) + (overview.clipped ? CLIP_NOTE : 0) : 0);
  const picked: Item[] = [];
  for (const c of candidates) {
    const path = c.entry.path;
    const cost = frame(path, c.mark);
    const item = { path, kind: c.entry.kind, mark: c.mark, why: c.why };
    if (c.text.length + cost <= left) {
      picked.push({ ...item, text: c.text, clipped: false });
      left -= c.text.length + cost;
      continue;
    }
    const room = left - cost - CLIP_NOTE;
    if (room >= CLIP_MIN) {
      picked.push({ ...item, text: clipText(c.text, room), clipped: true });
      left = 0;
    } else notIncluded.push(path);
  }

  // The index comes last: it only helps the agent find what else exists, so it takes what is left, and a line that does not fit is named instead.
  const lines: IndexLine[] = [];
  for (const line of indexed) {
    const cost = line.path.length + 8 + (line.summary?.length ?? 0) + (line.mark ? MARK : 0);
    if (cost <= left) {
      lines.push(line);
      left -= cost;
    } else notIncluded.push(line.path);
  }
  return { overview, picked, indexed: lines, notIncluded };
}
