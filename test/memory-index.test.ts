import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { MEMORY_LIMITS } from '../src/shared/memory';
import { createSharedMemory } from '../src/main/runner/activities';
import { createRunStore, type RunStore } from '../src/main/runs-core';
import { createFacts } from '../src/main/memory/facts';
import { PROMPT_CAPS, RANK, TOOL_CAPS, createMemoryIndex, lineOf, rankEntries, renderEntries, scoreOf, searchEntries, type BuildOptions, type MemoryEntry, type MemoryIndex, type RankContext } from '../src/main/memory/index';
import { createMemoryStore, type MemoryStore, type Scope } from '../src/main/memory/store';
import { drive, startInput } from './helpers/runs';

// The index an agent receives, built over a workspace folder of the test's own: notes, activities, the headings of cycle documents and the two facts.

let ws: string;
let store: MemoryStore;
let runs: RunStore;
let config: WorkspaceConfig;
let counter: number;
let clock: number;
const HOME = '/home/person';
const T0 = Date.parse('2026-10-09T10:00:00Z');

const dev: Scope = { conversation: 'general', agent: 'developer' };
const qa: Scope = { conversation: 'general', agent: 'qa' };

function build(over: { runs?: RunStore; config?: () => WorkspaceConfig } = {}): MemoryIndex {
  const cfg = over.config ?? (() => config);
  return createMemoryIndex({
    store,
    runs: over.runs ?? runs,
    activities: createSharedMemory(ws, () => new Date(clock)),
    facts: createFacts({ config: cfg, secret: () => false, home: HOME }),
    language: () => 'en',
    now: () => clock,
  });
}

const ctx = (over: Partial<RankContext> = {}): RankContext => ({ conversation: 'general', agent: 'developer', ...over });
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ ctx: ctx(), ...over });

function note(scope: Scope, over: { kind?: string; title?: string; text?: string; activity?: string; repo?: string } = {}): string {
  const r = store.save({ scope, kind: over.kind ?? 'decision', title: over.title ?? 'Use the queue for retries', text: over.text ?? 'Retries go through the queue, never inline.', activity: over.activity, repo: over.repo, home: HOME });
  if (!r.ok) throw new Error(r.text);
  clock += 60_000;
  return r.note.id;
}

/** A run whose worktree really exists, with the documents its stages produced. */
function runWith(id: string, ref: string, docs: Record<string, string>, over: { repo?: string; minutes?: number } = {}): string {
  const worktree = join(ws, 'worktrees', id);
  const folder = `docs/cycles/${ref.split('#')[1]}-thing`;
  mkdirSync(join(worktree, folder), { recursive: true });
  for (const [name, text] of Object.entries(docs)) writeFileSync(join(worktree, folder, name), text);
  const d = drive(undefined, startInput({ id, issue: { ref, iid: Number(ref.split('#')[1]), title: `Work on ${ref}`, url: null }, repo: over.repo ?? 'app', branch: `coxia/${id}`, worktree, cycleFolder: folder }));
  runs.create(d.run);
  return id;
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-index-'));
  clock = T0;
  counter = 0;
  store = createMemoryStore(ws, { now: () => clock, hex: () => (++counter).toString(16).padStart(8, '0'), home: HOME });
  runs = createRunStore(join(ws, 'runs'));
  config = neutralConfig();
});

const entry = (over: Partial<MemoryEntry> & { id: string }): MemoryEntry => ({ kind: 'note', title: 'a title', origin: { by: 'agent', at: '2026-10-09T10:00:00.000Z' }, about: {}, keywords: 'a title', ...over });

describe('the ranking key', () => {
  const none = new Set<string>();

  it('weighs the same conversation 4, the activity 3, the called agent 2 and the repository 1', () => {
    expect(RANK).toEqual({ sameConversation: 4, sameActivity: 3, calledAgent: 2, sameRepo: 1 });
    const c = ctx({ conversation: 'general', agent: 'developer', repo: 'app' });
    const refs = new Set(['app#101']);
    expect(scoreOf(entry({ id: 'm-00000001', origin: { conversation: 'general', by: 'agent', at: '' } }), c, refs)).toBe(4);
    expect(scoreOf(entry({ id: 'm-00000002', about: { ref: 'app#101' } }), c, refs)).toBe(3);
    expect(scoreOf(entry({ id: 'm-00000003', origin: { agent: 'developer', by: 'agent', at: '' } }), c, refs)).toBe(2);
    expect(scoreOf(entry({ id: 'm-00000004', about: { repo: 'app' } }), c, refs)).toBe(1);
    expect(scoreOf(entry({ id: 'm-00000005', origin: { conversation: 'general', agent: 'developer', by: 'agent', at: '' }, about: { ref: 'app#101', repo: 'app' } }), c, refs)).toBe(10);
    expect(scoreOf(entry({ id: 'm-00000006' }), c, refs)).toBe(0);
  });

  it('puts the two facts first, then score, then kind, then the newest, then the id', () => {
    const at = (day: number): { by: 'agent'; at: string } => ({ by: 'agent', at: `2026-10-0${day}T10:00:00.000Z` });
    const list = [
      entry({ id: 'doc:r-a-bb/1_SPEC.md', kind: 'document', origin: at(9) }),
      entry({ id: 'act:app#2', kind: 'activity', inProgress: false, origin: at(9) }),
      entry({ id: 'act:app#1', kind: 'activity', inProgress: true, origin: at(1) }),
      entry({ id: 'm-00000003', kind: 'note', origin: at(9) }),
      entry({ id: 'm-00000002', kind: 'finding', origin: at(1) }),
      entry({ id: 'm-00000001', kind: 'decision', origin: at(1) }),
      entry({ id: 'm-00000009', kind: 'decision', origin: at(5) }),
      entry({ id: 'sys:roadmap', kind: 'roadmap' }),
      entry({ id: 'sys:version', kind: 'version' }),
      entry({ id: 'm-0000000a', kind: 'note', origin: { conversation: 'elsewhere', by: 'agent', at: '2026-10-01T10:00:00.000Z' } }),
    ];
    const order = rankEntries(list, ctx({ conversation: 'elsewhere' }), none).map((e) => e.id);
    expect(order).toEqual(['sys:version', 'sys:roadmap', 'm-0000000a', 'm-00000009', 'm-00000001', 'm-00000002', 'm-00000003', 'act:app#1', 'doc:r-a-bb/1_SPEC.md', 'act:app#2']);
  });
});

describe('the lines and the caps', () => {
  it('shows a title and an origin, and the text of a note never', async () => {
    note(dev, { title: 'Use the queue', text: 'Secret plan: the body that must stay out of the list.' });
    const list = await build().list(opts(), {}, { ...PROMPT_CAPS, tool: true });
    expect(list.text).toContain('Use the queue');
    expect(list.text).toContain('(developer, general, 2026-10-09)');
    expect(list.text).not.toContain('body that must stay out');
  });

  it('puts the version and the roadmap first and says "unknown" and "none" when the source is empty', async () => {
    note(dev);
    const lines = (await build().list(opts(), {}, { ...PROMPT_CAPS, tool: true })).text.split('\n');
    expect(lines[0]).toBe('- sys:version Version: unknown (no tag or manifest was found)');
    expect(lines[1]).toBe('- sys:roadmap Roadmap: none (no file is configured)');
    expect(lines[2]).toMatch(/^- m-[0-9a-f]{8} decision:/);
  });

  it('keeps hundreds of entries within 40 lines and 3,000 characters and says how many were left out', async () => {
    for (let a = 0; a < 6; a++) {
      const scope: Scope = { conversation: `thread-${a}`, agent: 'developer' };
      for (let i = 0; i < 50; i++) note(scope, { title: `Decision ${a}-${i} about the queue and how retries behave in the system`, text: `text ${a}-${i}` });
    }
    const built = await build().build(opts());
    expect(built.entries).toHaveLength(300 + 2);
    const prompt = await build().list(opts(), {}, { ...PROMPT_CAPS, tool: true });
    const lines = prompt.text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(MEMORY_LIMITS.listLines);
    expect(prompt.text.length).toBeLessThanOrEqual(MEMORY_LIMITS.listChars);
    expect(prompt.omitted).toBe(302 - prompt.entries);
    expect(lines[lines.length - 1]).toBe(`- ${prompt.omitted} more not listed; narrow it with memory_list (a query or a kind) or open one by its id with memory_read`);
    expect(prompt.chars).toBe(prompt.text.length);
    const tool = await build().list(opts(), {}, { ...TOOL_CAPS, tool: true });
    expect(tool.text.split('\n').length).toBeLessThanOrEqual(MEMORY_LIMITS.toolListLines);
    expect(tool.text.length).toBeLessThanOrEqual(MEMORY_LIMITS.toolListChars);
  });

  it('without the tool the closing line only counts, and a list that fits has none', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry({ id: `m-${i.toString(16).padStart(8, '0')}`, title: `title ${i}` }));
    const r = renderEntries(many, { ...PROMPT_CAPS, tool: false });
    expect(r.text.split('\n').pop()).toBe(`- ${r.omitted} more not listed`);
    expect(r.entries + r.omitted).toBe(60);
    const small = renderEntries(many.slice(0, 5), { ...PROMPT_CAPS, tool: true });
    expect(small.omitted).toBe(0);
    expect(small.text.split('\n')).toHaveLength(5);
  });

  it('cuts by characters too: a few very long titles do not overrun the cap', () => {
    const long = Array.from({ length: 30 }, (_, i) => entry({ id: `m-${i.toString(16).padStart(8, '0')}`, title: 'x'.repeat(80) }));
    const r = renderEntries(long, { ...PROMPT_CAPS, tool: true });
    expect(r.text.length).toBeLessThanOrEqual(MEMORY_LIMITS.listChars);
    expect(r.omitted).toBeGreaterThan(0);
  });

  it('gives an activity one line of at most 200 characters of title', () => {
    const e = entry({ id: 'act:app#1', kind: 'activity', title: 'x'.repeat(500) });
    expect(lineOf(e).length).toBeLessThanOrEqual('- act:app#1 '.length + 200);
  });
});

describe('search', () => {
  it('matches every word over the title, the kind, the origin and the headings, case-insensitive', async () => {
    note(dev, { title: 'Use the queue for retries' });
    note(qa, { kind: 'finding', title: 'The fixture is stale' });
    note({ conversation: 'other-thread', agent: 'developer' }, { kind: 'note', title: 'Naming of the queue' });
    const idx = build();
    const text = async (view: Parameters<MemoryIndex['list']>[1]): Promise<string> => (await idx.list(opts(), view, { ...TOOL_CAPS, tool: true })).text;
    expect(await text({ query: 'QUEUE' })).toContain('Use the queue');
    expect(await text({ query: 'queue retries' })).not.toContain('Naming of the queue');
    expect(await text({ query: 'qa stale' })).toContain('The fixture is stale');
    expect(await text({ kind: 'finding' })).not.toContain('Use the queue');
    expect(await text({ conversation: 'other-thread' })).toContain('Naming of the queue');
    expect(await text({ conversation: 'other-thread' })).not.toContain('The fixture');
    expect(await text({ query: 'nothing matches this' })).toBe('');
  });

  it('searches the headings of a cycle document', async () => {
    runWith('r-docs11-aa11', 'app#7', { '1_SPEC.md': '# The spec\n\n## Retry budget\ntext\n## Other\n' });
    const idx = build();
    const hit = await idx.list(opts(), { query: 'retry budget' }, { ...TOOL_CAPS, tool: true });
    expect(hit.text).toContain('doc:r-docs11-aa11/1_SPEC.md');
    expect(hit.text).toContain('document: The spec');
    expect(searchEntries([], {})).toEqual([]);
  });
});

describe('what is in the index', () => {
  it('holds back a note that waits for review, one nobody wrote and one that no longer passes', async () => {
    const ok = note(dev, { title: 'Visible' });
    const waiting = store.save({ scope: dev, kind: 'note', title: 'Waiting for review', text: 'a text', handoff: true, home: HOME });
    expect(waiting.ok).toBe(true);
    // A note placed by hand has no entry in the state: foreign.
    const foreignFolder = join(ws, 'memory', 'conversations', 'general', 'qa');
    mkdirSync(foreignFolder, { recursive: true });
    writeFileSync(join(foreignFolder, 'm-ffffffff.md'), '---\nid: m-ffffffff\nkind: note\ntitle: Foreign one\nby: qa\nat: 2026-10-09T10:00:00.000Z\nrevision: 1\nreviewed: true\n---\nplaced by hand\n');
    const built = await build().build(opts());
    const ids = built.entries.map((e) => e.id);
    expect(ids).toContain(ok);
    expect(built.entries.map((e) => e.title)).not.toContain('Waiting for review');
    expect(built.entries.map((e) => e.title)).not.toContain('Foreign one');
    expect(built.held).toBe(2);
  });

  it('lists an activity as its compact line and a document by its first heading', async () => {
    runWith('r-docs11-aa11', 'app#7', { '1_SPEC.md': '# The retry spec\n\n## Goals\n', '0_ISSUE.md': '# app#7 Issue record\n', 'notes.txt': 'not markdown' });
    const built = await build().build(opts());
    const act = built.entries.find((e) => e.id === 'act:app#7');
    expect(act?.kind).toBe('activity');
    expect(lineOf(act as MemoryEntry).startsWith('- act:app#7 Work on app#7')).toBe(true);
    const docs = built.entries.filter((e) => e.kind === 'document');
    expect(docs.map((d) => d.id)).toEqual(['doc:r-docs11-aa11/1_SPEC.md']);
    expect(docs[0].title).toBe('The retry spec');
    expect(docs[0].about).toEqual({ ref: 'app#7', repo: 'app' });
  });

  it('leaves the call\'s own run out of the documents, but not out of the activities', async () => {
    runWith('r-docs11-aa11', 'app#7', { '1_SPEC.md': '# Mine\n' });
    runWith('r-docs22-bb22', 'app#8', { '1_SPEC.md': '# Theirs\n' });
    const built = await build().build(opts({ runId: 'r-docs11-aa11' }));
    expect(built.entries.filter((e) => e.kind === 'document').map((e) => e.title)).toEqual(['Theirs']);
    expect(built.entries.filter((e) => e.kind === 'activity').map((e) => e.id).sort()).toEqual(['act:app#7', 'act:app#8']);
  });

  it('looks at the 30 newest runs only, and skips a run whose worktree is gone and a document that is a link', async () => {
    for (let i = 0; i < 33; i++) runWith(`r-many${String(i).padStart(2, '0')}-aa11`, `app#${100 + i}`, { '1_SPEC.md': `# Spec ${i}\n` });
    const gone = drive(undefined, startInput({ id: 'r-gone11-aa11', issue: { ref: 'app#900', iid: 900, title: 'Gone', url: null }, worktree: join(ws, 'worktrees', 'nowhere'), cycleFolder: 'docs/cycles/900-gone' }));
    runs.create(gone.run);
    const linked = runWith('r-link11-aa11', 'app#901', {});
    mkdirSync(join(ws, 'elsewhere'), { recursive: true });
    writeFileSync(join(ws, 'elsewhere', 'outside.md'), '# Outside\n');
    symlinkSync(join(ws, 'elsewhere', 'outside.md'), join(ws, 'worktrees', linked, 'docs', 'cycles', '901-thing', '1_SPEC.md'));
    const docs = (await build().build(opts())).entries.filter((e) => e.kind === 'document');
    expect(docs.length).toBeLessThanOrEqual(MEMORY_LIMITS.docRuns);
    expect(docs.map((d) => d.title)).not.toContain('Outside');
    expect(docs.find((d) => d.id.includes('r-gone11'))).toBeUndefined();
  });

  it('reads the run files once per call', async () => {
    runWith('r-docs11-aa11', 'app#7', { '1_SPEC.md': '# One\n' });
    runWith('r-docs22-bb22', 'app#8', { '1_SPEC.md': '# Two\n' });
    for (let i = 0; i < 3; i++) createSharedMemory(ws).upsert(null, runs.list()[i % 2], 'en');
    let lists = 0;
    const counting: RunStore = { ...runs, list: () => (lists++, runs.list()) };
    await build({ runs: counting }).build(opts());
    expect(lists).toBe(1);
    lists = 0;
    await build({ runs: counting }).list(opts(), { query: 'one' }, { ...PROMPT_CAPS, tool: true });
    expect(lists).toBe(1);
  });

  it('scores a note about the activity the message named above one that is not', async () => {
    note({ conversation: 'elsewhere', agent: 'qa' }, { title: 'Unrelated' });
    note({ conversation: 'elsewhere', agent: 'qa' }, { title: 'About the activity', activity: 'app#101' });
    runWith('r-docs11-aa11', 'app#101', {});
    const built = await build().build(opts({ ctx: ctx({ conversation: 'direct-x', named: { refs: ['101'], agents: [] } }) }));
    const titles = built.entries.filter((e) => e.kind === 'note' || e.kind === 'decision').map((e) => e.title);
    expect(titles).toEqual(['About the activity', 'Unrelated']);
  });
});

describe('opening an entry', () => {
  it('opens a note as an excerpt with its origin, and pages through a long one', async () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i} of a long note`).join('\n');
    const id = note(dev, { title: 'A long note', text: long.slice(0, MEMORY_LIMITS.note) });
    const idx = build();
    const first = await idx.open(opts(), id);
    if (first.status !== 'ok') throw new Error('not opened');
    expect(first.text.length).toBeLessThanOrEqual(MEMORY_LIMITS.excerpt);
    expect(first.next).not.toBeNull();
    expect(first.provenance).toContain('written by developer');
    expect(first.provenance).toContain('conversation general');
    const second = await idx.open(opts(), id, { from: first.next as number });
    if (second.status !== 'ok') throw new Error('not opened');
    expect(second.from).toBe(first.next);
    expect(first.text + second.text).toBe(long.slice(0, MEMORY_LIMITS.note).replace(/\s+$/, '').slice(0, first.text.length + second.text.length));
  });

  it('says a note edited by the person is the person\'s, and hides what no agent may read', async () => {
    const id = note(dev, { title: 'Mine' });
    store.edit({ scope: dev, id, text: 'The person rewrote it.' });
    const edited = await build().open(opts(), id);
    expect(edited.status === 'ok' && edited.provenance).toContain('edited by the person');
    const waiting = store.save({ scope: dev, kind: 'note', title: 'Held', text: 'text', handoff: true, home: HOME });
    if (!waiting.ok) throw new Error(waiting.text);
    expect(await build().open(opts(), waiting.note.id)).toEqual({ status: 'hidden', reason: 'review' });
    expect(await build().open(opts(), 'm-0000dead')).toEqual({ status: 'missing' });
    expect(await build().open(opts(), 'nonsense')).toEqual({ status: 'missing' });
  });

  it('opens an activity whole, and a cycle document by section or by outline and opening', async () => {
    runWith('r-docs11-aa11', 'app#7', { '1_SPEC.md': '# The spec\n\nIntro text.\n\n## Goals\nGoal one.\n### Detail\nDetail text.\n\n## Risks\nRisk one.\n' });
    const idx = build();
    const act = await idx.open(opts(), 'act:app#7');
    expect(act.status === 'ok' && act.text).toContain('app#7 Work on app#7');
    const doc = await idx.open(opts(), 'doc:r-docs11-aa11/1_SPEC.md');
    if (doc.status !== 'ok') throw new Error('not opened');
    expect(doc.outline).toEqual(['The spec', '  Goals', '    Detail', '  Risks']);
    expect(doc.text).toContain('Intro text.');
    const goals = await idx.open(opts(), 'doc:r-docs11-aa11/1_SPEC.md', { section: 'goals' });
    if (goals.status !== 'ok') throw new Error('not opened');
    expect(goals.text).toBe('## Goals\nGoal one.\n### Detail\nDetail text.');
    expect(goals.text).not.toContain('Risk one');
    const none = await idx.open(opts(), 'doc:r-docs11-aa11/1_SPEC.md', { section: 'zzz' });
    expect(none).toEqual({ status: 'no-section', outline: ['The spec', '  Goals', '    Detail', '  Risks'] });
    expect(await idx.open(opts(), 'doc:r-docs11-aa11/9_NOPE.md')).toEqual({ status: 'missing' });
    expect(await idx.open(opts(), 'doc:../../etc/passwd')).toEqual({ status: 'missing' });
    expect(await idx.open(opts(), 'act:app#999')).toEqual({ status: 'missing' });
  });

  it('masks a document it opens, and keeps one excerpt within the cap however long the document is', async () => {
    runWith('r-docs11-aa11', 'app#7', { '1_SPEC.md': `# Big\napi_key = sk-abcdefghijklmnopqrstuvwxyz0123456789\n${'word '.repeat(5000)}\n` });
    const doc = await build().open(opts(), 'doc:r-docs11-aa11/1_SPEC.md');
    if (doc.status !== 'ok') throw new Error('not opened');
    expect(doc.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(doc.text.length).toBeLessThanOrEqual(MEMORY_LIMITS.excerpt);
    expect(doc.next).not.toBeNull();
  });

  it('opens the version with the detail and the roadmap by section', async () => {
    const path = join(ws, 'roadmap.md');
    writeFileSync(path, '# Roadmap\n\n## Next\nThe next thing.\n## Later\nThe later thing.\n');
    utimesSync(path, new Date(), new Date());
    const withRoadmap = neutralConfig();
    withRoadmap.docs.roadmapFile = path;
    const idx = build({ config: () => withRoadmap });
    const v = await idx.open(opts(), 'sys:version');
    expect(v.status === 'ok' && v.text).toBe('Version: unknown (no tag or manifest was found)');
    const section = await idx.open(opts(), 'sys:roadmap', { section: 'next' });
    expect(section.status === 'ok' && section.text).toBe('## Next\nThe next thing.');
    const outline = await idx.open(opts(), 'sys:roadmap');
    expect(outline.status === 'ok' && outline.outline).toEqual(['Roadmap', '  Next', '  Later']);
    expect(await idx.open(opts(), 'sys:roadmap', { section: 'nope' })).toMatchObject({ status: 'no-section' });
    const none = await build().open(opts(), 'sys:roadmap');
    expect(none.status === 'ok' && none.text).toBe('Roadmap: none (no file is configured)');
    const list = await idx.list(opts(), {}, { ...PROMPT_CAPS, tool: true });
    expect(list.text).toContain('- sys:roadmap Roadmap: Roadmap (3 sections): Next; Later');
  });
});
