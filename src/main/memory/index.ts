// i18n-lint: allow-file what an agent reads from the memory: English by design, like the other tool texts of the engines
import type { Language } from '../../shared/config/types';
import { MEMORY_LIMITS, visibleToAgents, type EntryKind, type NoteSummary } from '../../shared/memory';
import type { Run } from '../../shared/runs';
import { ARTIFACT_NAME } from '../../shared/runs';
import type { RunStore } from '../runs-core';
import { compactLine, frontText, isInProgress, refsNamed, type ActivityFront, type ActivityIndex, type SharedMemory } from '../runner/activities';
import { createDocumentIndex, excerptOf, findSection, headingsOf, sectionText, type DocumentIndex } from './documents';
import { roadmapSection, versionDetail, type Facts } from './facts';
import type { MemoryStore } from './store';

// The index the agents receive: built when a call opens, never stored. It lists the notes the agents wrote, the activities (the record that already exists), the headings of
// the cycle documents and two facts (version, roadmap); ranks them by one fixed key; cuts the list to fixed caps; and opens one entry as a bounded excerpt. No model is
// called and nothing here writes. A line shows a title and where the entry came from, never a body.

export interface MemoryEntry {
  /** What a pointer is: `m-<hex>`, `act:<ref>`, `doc:<runId>/<name>`, `sys:version`, `sys:roadmap`. None holds a comma. */
  id: string;
  kind: EntryKind;
  title: string;
  origin: { conversation?: string; agent?: string; ref?: string; by: 'agent' | 'person' | 'app'; at: string };
  /** What relevance (the ranking and the notices) reads. */
  about: { ref?: string; repo?: string };
  /** Title, kind, origin and headings, lowercased. For the search; never shown. */
  keywords: string;
  /** An activity that is still in progress (open or failed). */
  inProgress?: boolean;
}

/** What a call is, for the ranking: where it happens, who it is and what it is about. */
export interface RankContext {
  conversation: string | null;
  /** The called agent. */
  agent: string;
  ref?: string | null;
  repo?: string;
  /** What the message named: refs or numbers of activities, and agents. */
  named?: { refs: string[]; agents: string[] };
}

export interface IndexDeps {
  store: MemoryStore;
  runs: RunStore;
  activities: SharedMemory;
  documents?: DocumentIndex;
  facts: Facts;
  language(): Language;
  now?(): number;
}

export interface BuildOptions {
  ctx: RankContext;
  /** The call's own run: its documents are read whole by its stages, so they are not listed back to it. */
  runId?: string | null;
  /** Never wait for git (a ceremony on a voice path). */
  cacheOnly?: boolean;
}

export interface Built {
  /** Ranked, `sys:version` and `sys:roadmap` first. */
  entries: MemoryEntry[];
  /** Notes that exist but are held back from every agent (waiting for review, foreign or no longer passing the checks), by the person's view. */
  held: number;
}

export interface ListView {
  query?: string;
  kind?: string;
  conversation?: string;
}

export interface Rendered {
  text: string;
  /** Entries on the lines of the text. */
  entries: number;
  chars: number;
  /** Entries that matched and did not fit. */
  omitted: number;
}

export interface ListCaps {
  lines: number;
  chars: number;
  /** The call has `memory_list`: the closing line says how to ask for the rest. */
  tool: boolean;
}

export const PROMPT_CAPS = { lines: MEMORY_LIMITS.listLines, chars: MEMORY_LIMITS.listChars } as const;
export const TOOL_CAPS = { lines: MEMORY_LIMITS.toolListLines, chars: MEMORY_LIMITS.toolListChars } as const;

export type Opened =
  | { status: 'ok'; id: string; kind: EntryKind; title: string; provenance: string; text: string; from: number; next: number | null; total: number; outline?: string[] }
  | { status: 'missing' }
  | { status: 'hidden'; reason: 'review' | 'foreign' | 'unsafe' }
  | { status: 'no-section'; outline: string[] };

export interface OpenOptions {
  section?: string;
  from?: number;
}

export interface MemoryIndex {
  build(opts: BuildOptions): Promise<Built>;
  /** The list a prompt carries or `memory_list` answers: the entries that match `view`, within `caps`. */
  list(opts: BuildOptions, view: ListView, caps: ListCaps): Promise<Rendered>;
  open(opts: BuildOptions, id: string, open?: OpenOptions): Promise<Opened>;
  /** Whether the activities record knows this reference: a note may say it concerns one. */
  knows(ref: string): boolean;
}

const day = (iso: string): string => iso.slice(0, 10);
const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

// --- ranking -----------------------------------------------------------------------------------------------------------------------

/** The weights of the key, in one place so the test pins them. */
export const RANK = { sameConversation: 4, sameActivity: 3, calledAgent: 2, sameRepo: 1 } as const;

const KIND_ORDER = (e: MemoryEntry): number => (e.kind === 'decision' ? 0 : e.kind === 'finding' ? 1 : e.kind === 'note' ? 2 : e.kind === 'activity' ? (e.inProgress ? 3 : 5) : 4);

/**
 * How relevant an entry is to a call: +4 same conversation; +3 about the call's activity or one it named; +2 written by the called agent; +1 same repository.
 * `refs` are the activity references the call is about, already resolved.
 */
export function scoreOf(e: MemoryEntry, ctx: RankContext, refs: ReadonlySet<string>): number {
  let s = 0;
  if (ctx.conversation !== null && e.origin.conversation === ctx.conversation) s += RANK.sameConversation;
  if (e.about.ref && refs.has(e.about.ref)) s += RANK.sameActivity;
  if (e.origin.agent && e.origin.agent === ctx.agent) s += RANK.calledAgent;
  if (e.about.repo && ctx.repo && e.about.repo === ctx.repo) s += RANK.sameRepo;
  return s;
}

/** The order of the list: the two facts first, then by score, then by kind (decision, finding, note, activity in progress, document, other activity), then newest first, then by id. */
export function rankEntries(entries: readonly MemoryEntry[], ctx: RankContext, refs: ReadonlySet<string>): MemoryEntry[] {
  const sys = (e: MemoryEntry): number => (e.id === 'sys:version' ? 0 : e.id === 'sys:roadmap' ? 1 : 2);
  const scored = entries.map((e) => ({ e, score: scoreOf(e, ctx, refs) }));
  scored.sort((a, b) => sys(a.e) - sys(b.e) || b.score - a.score || KIND_ORDER(a.e) - KIND_ORDER(b.e) || time(b.e.origin.at) - time(a.e.origin.at) || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
  return scored.map((s) => s.e);
}

/** The entries whose title, kind, origin or headings hold every word of `query` (case-insensitive), and whose kind and conversation are the ones asked for. */
export function searchEntries(entries: readonly MemoryEntry[], view: ListView): MemoryEntry[] {
  const words = (view.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => (!view.kind || e.kind === view.kind) && (!view.conversation || e.origin.conversation === view.conversation) && words.every((w) => e.keywords.includes(w)));
}

// --- lines -------------------------------------------------------------------------------------------------------------------------

const ACTIVITY_LINE_MAX = 200;
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** One entry as one line: its pointer, then what it is and where it came from. Never its text. */
export function lineOf(e: MemoryEntry): string {
  if (e.id === 'sys:version' || e.id === 'sys:roadmap') return `- ${e.id} ${e.title}`;
  if (e.kind === 'activity') return clip(`- ${e.id} ${e.title}`, ACTIVITY_LINE_MAX + e.id.length + 3);
  const where = [e.origin.by === 'person' ? 'edited by the person' : e.origin.by === 'agent' ? (e.origin.agent ?? 'agent') : 'app', e.origin.conversation ?? e.origin.ref, day(e.origin.at)].filter(Boolean);
  return `- ${e.id} ${e.kind}: ${oneLine(e.title)} (${where.join(', ')})`;
}

const closing = (omitted: number, tool: boolean): string =>
  tool ? `- ${omitted} more not listed; narrow it with memory_list (a query or a kind) or open one by its id with memory_read` : `- ${omitted} more not listed`;

/** The entries as lines within `caps`; what does not fit is counted in a closing line that says how to ask for it when the call can. */
export function renderEntries(entries: readonly MemoryEntry[], caps: ListCaps): Rendered {
  const lines = entries.map(lineOf);
  const size = (n: number): number => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  if (lines.length <= caps.lines && size(lines.length) <= caps.chars) return { text: lines.join('\n'), entries: lines.length, chars: lines.join('\n').length, omitted: 0 };
  // Room for the closing line first: it is what tells the agent the list is not whole.
  const reserve = closing(entries.length, caps.tool).length + 1;
  let n = Math.min(lines.length, caps.lines - 1);
  while (n > 0 && size(n) + reserve > caps.chars) n--;
  const omitted = entries.length - n;
  const text = [...lines.slice(0, n), closing(omitted, caps.tool)].join('\n');
  return { text, entries: n, chars: text.length, omitted };
}

// --- the index ---------------------------------------------------------------------------------------------------------------------

const keywordsOf = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ').toLowerCase();

function noteEntry(n: NoteSummary): MemoryEntry | null {
  if (!n.kind) return null;
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    origin: { conversation: n.conversation, agent: n.by, by: n.person ? 'person' : 'agent', at: n.at },
    about: { ...(n.activity ? { ref: n.activity } : {}), ...(n.repo ? { repo: n.repo } : {}) },
    keywords: keywordsOf(n.title, n.kind, n.conversation, n.agent, n.by, n.activity, n.repo),
  };
}

function activityEntry(f: ActivityFront, repoOf: (runId: string | null) => string | undefined): MemoryEntry {
  const repo = repoOf(f.runId);
  return {
    id: `act:${f.ref}`,
    kind: 'activity',
    // The compact line without its dash and its reference: the pointer (`act:<ref>`) already says which activity it is.
    title: compactLine(f).slice(2 + f.ref.length).trim(),
    origin: { ref: f.ref, ...(f.lastAgent ? { agent: f.lastAgent } : {}), by: 'app', at: f.updatedAt },
    about: { ref: f.ref, ...(repo ? { repo } : {}) },
    keywords: keywordsOf(f.ref, f.title, f.stage?.label, f.agent ?? undefined, f.lastAgent ?? undefined, 'activity', f.squad ?? undefined, repo),
    inProgress: isInProgress(f),
  };
}

export function createMemoryIndex(deps: IndexDeps): MemoryIndex {
  const documents = deps.documents ?? createDocumentIndex();
  const now = deps.now ?? Date.now;

  // The snapshot of one call: the run files are listed once, and everything below reads from it.
  interface Snapshot {
    runs: Run[];
    activities: ActivityIndex;
    fronts: ActivityFront[];
    notes: NoteSummary[];
    held: number;
  }

  function snapshot(): Snapshot {
    const runs = deps.runs.list();
    const activities = deps.activities.read(deps.runs, deps.language(), runs);
    const listing = deps.store.list();
    const notes = listing.notes.filter(visibleToAgents);
    return { runs, activities, fronts: Object.values(activities.fronts), notes, held: listing.notes.length - notes.length };
  }

  async function assemble(opts: BuildOptions, snap: Snapshot): Promise<MemoryEntry[]> {
    const repoOfRun = (runId: string | null): string | undefined => (runId ? snap.runs.find((r) => r.id === runId)?.repo : undefined);
    const entries: MemoryEntry[] = [];
    for (const n of snap.notes) {
      const e = noteEntry(n);
      if (e) entries.push(e);
    }
    for (const f of snap.fronts) entries.push(activityEntry(f, repoOfRun));
    for (const d of documents.list(snap.runs, opts.runId)) {
      const run = snap.runs.find((r) => r.id === d.runId);
      entries.push({
        id: `doc:${d.runId}/${d.name}`,
        kind: 'document',
        title: d.title,
        origin: { conversation: `run-${d.runId}`, ...(run ? { ref: run.issue.ref } : {}), by: 'app', at: d.at },
        about: { ...(run ? { ref: run.issue.ref, repo: run.repo } : {}) },
        keywords: keywordsOf(d.title, d.name, 'document', run?.issue.ref, ...d.headings),
      });
    }
    const version = await deps.facts.version(snap.runs, { cacheOnly: opts.cacheOnly });
    const roadmap = deps.facts.roadmap();
    const at = new Date(now()).toISOString();
    entries.push(
      { id: 'sys:version', kind: 'version', title: version.line, origin: { by: 'app', at }, about: {}, keywords: keywordsOf(version.line, 'version', 'release', 'tag') },
      { id: 'sys:roadmap', kind: 'roadmap', title: roadmap.line, origin: { by: 'app', at }, about: {}, keywords: keywordsOf(roadmap.line, 'roadmap', 'priorities', ...roadmap.headings.map((h) => h.title)) },
    );
    return entries;
  }

  const refsOf = (opts: BuildOptions, snap: Snapshot): Set<string> => {
    const refs = new Set<string>();
    if (opts.ctx.ref) refs.add(opts.ctx.ref);
    for (const r of refsNamed(snap.activities, opts.ctx.named?.refs ?? [])) refs.add(r);
    return refs;
  };

  async function buildFrom(opts: BuildOptions, snap: Snapshot): Promise<Built> {
    const entries = rankEntries(await assemble(opts, snap), opts.ctx, refsOf(opts, snap));
    return { entries, held: snap.held };
  }

  async function openNote(id: string, o: OpenOptions): Promise<Opened> {
    const scope = deps.store.locate(id);
    if (!scope) return { status: 'missing' };
    const r = deps.store.read(scope, id, 'agent');
    if (r.status === 'missing') return { status: 'missing' };
    if (r.status === 'hidden') return { status: 'hidden', reason: r.reason };
    const n = r.note;
    const who = n.person ? 'edited by the person' : `written by ${n.by}`;
    return { status: 'ok', id, kind: n.kind ?? 'note', title: n.title, provenance: `${n.kind ?? 'note'} · ${n.title} · ${who} · conversation ${n.conversation} · ${day(n.at)}`, ...slice(r.text, o.from) };
  }

  function slice(text: string, from: number | undefined): { text: string; from: number; next: number | null; total: number } {
    const ex = excerptOf(text, from ?? 0);
    return { text: ex.text, from: ex.from, next: ex.next, total: ex.total };
  }

  /** A text with headings as an entry: a section by name, else its outline and its opening. */
  function sectioned(base: { id: string; kind: EntryKind; title: string; provenance: string }, text: string, o: OpenOptions): Opened {
    const hs = headingsOf(text);
    const outline = hs.map((h) => `${'  '.repeat(h.level - 1)}${h.title}`);
    if (o.section && o.section.trim()) {
      const at = findSection(hs, o.section);
      if (at < 0) return { status: 'no-section', outline };
      return { status: 'ok', ...base, ...slice(sectionText(text, hs, at), o.from), outline };
    }
    return { status: 'ok', ...base, ...slice(text, o.from), outline };
  }

  return {
    build: async (opts) => buildFrom(opts, snapshot()),

    knows: (ref) => deps.activities.read(deps.runs, deps.language()).fronts[ref] !== undefined,

    async list(opts, view, caps) {
      const built = await buildFrom(opts, snapshot());
      return renderEntries(searchEntries(built.entries, view), caps);
    },

    async open(opts, id, o = {}) {
      if (/^m-[0-9a-f]{8}$/.test(id)) return openNote(id, o);
      const snap = snapshot();
      if (id.startsWith('act:')) {
        const front = snap.activities.fronts[id.slice(4)];
        if (!front) return { status: 'missing' };
        return { status: 'ok', id, kind: 'activity', title: front.title, provenance: `activity · ${front.ref} · projected by the app${front.source === 'person' ? ', corrected by the person' : ''} · ${day(front.updatedAt)}`, ...slice(frontText(front, new Date(now()).toISOString(), deps.language()), o.from) };
      }
      if (id.startsWith('doc:')) {
        const m = /^doc:(r-[a-z0-9]{1,12}-[a-z0-9]{2,8})\/(.+)$/.exec(id);
        const run = m ? snap.runs.find((r) => r.id === m[1]) : undefined;
        if (!m || !run || !ARTIFACT_NAME.test(m[2])) return { status: 'missing' };
        const doc = documents.read(run, m[2]);
        if (!doc) return { status: 'missing' };
        const title = headingsOf(doc.text)[0]?.title ?? m[2];
        return sectioned({ id, kind: 'document', title, provenance: `document · ${m[2]} of the run ${run.issue.ref} · written by the app from a stage's answer` }, doc.text, o);
      }
      if (id === 'sys:version') {
        const v = await deps.facts.version(snap.runs, { cacheOnly: opts.cacheOnly });
        return { status: 'ok', id, kind: 'version', title: v.line, provenance: 'version · read by the app from the tags and manifests of the workspace repositories', ...slice(versionDetail(v), o.from) };
      }
      if (id === 'sys:roadmap') {
        const fact = deps.facts.roadmap();
        if (fact.state !== 'ok') return { status: 'ok', id, kind: 'roadmap', title: fact.line, provenance: 'roadmap · none', ...slice(fact.line, 0) };
        const sec = roadmapSection(fact, o.section);
        if (!sec) return { status: 'no-section', outline: fact.headings.map((h) => `${'  '.repeat(h.level - 1)}${h.title}`) };
        return { status: 'ok', id, kind: 'roadmap', title: fact.title ?? 'Roadmap', provenance: 'roadmap · the file the person pointed the workspace at', ...slice(sec.text, o.from), outline: sec.outline };
      }
      return { status: 'missing' };
    },
  };
}
