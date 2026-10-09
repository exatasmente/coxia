import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { AuditEntry } from '../src/shared/auditoria';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { createProcedureChannels, type ProcedureChannels } from '../src/main/procedures/channels';
import { createProcedureStore, proceduresPath, type ProcedureStore } from '../src/main/procedures/store';
import { procedureAuditEntry } from '../src/main/procedures/audit';
import type { ProcedureRecord } from '../src/shared/procedures';
import type { ProcedureWrite } from '../src/shared/proceduresView';
import { filterProcedures, sortProcedures, NO_FILTERS, summarize } from '../src/shared/proceduresView';

// The channels of the Procedures view over a store in a temp folder: never the app's real data.
let ws: string;
let clock: number;
let store: ProcedureStore;
let audits: Omit<AuditEntry, 'at'>[];
let config: WorkspaceConfig;
let ch: ProcedureChannels;

const T0 = Date.parse('2026-10-09T10:00:00Z');
const agent = { by: 'writer', surface: 'stage' as const, stage: 'development', ref: 'app#123', permission: 'worktree' as const, shell: 'sandbox' as const };
const withRepos = (): WorkspaceConfig => ({ ...neutralConfig(), projects: { ...neutralConfig().projects, repos: [{ id: 'api', path: '/tmp/api', remoteUrl: null, vcsId: null, projectPath: null }] } });

const content = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'repo',
  key: 'api',
  title: 'Run the end-to-end tests',
  steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite', run: 'npm run test:e2e' }],
  pitfalls: [],
  waits: [],
  ...over,
});

function agentRecord(over: Record<string, unknown> = {}, id?: string, revision?: number): ProcedureRecord {
  const r = store.save({ input: content(over), writer: agent, repos: ['api'], id, revision });
  if (!r.ok) throw new Error(r.text);
  return r.record;
}
const ok = (w: ProcedureWrite): ProcedureRecord => {
  if (!w.ok) throw new Error(`${w.code}: ${w.text}`);
  return w.record;
};

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-ch-'));
  clock = T0;
  let n = 0;
  store = createProcedureStore(ws, { now: () => clock, hex: () => (++n).toString(16).padStart(8, '0') });
  audits = [];
  config = { ...withRepos(), runner: { ...withRepos().runner, procedures: false } };
  ch = createProcedureChannels({ store, config: () => config, audit: (e) => audits.push(e), now: () => clock });
});

describe('the reads', () => {
  it('lists a line per record, none of its steps, and says whether the switch is on', () => {
    const r = agentRecord();
    const view = ch.list();
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ id: r.id, kind: 'repo', key: 'api', title: 'Run the end-to-end tests', state: 'unverified', reviewed: false, by: 'writer', uses: 0, old: false, withheld: false, hasPrevious: false });
    expect(JSON.stringify(view)).not.toContain('stack:up');
    expect(view.enabled).toBe(false);
    config = { ...config, runner: { ...config.runner, procedures: true } };
    expect(ch.list().enabled).toBe(true);
  });

  it('lists even with the switch off (the switch governs the agents, not the person)', () => {
    agentRecord();
    expect(config.runner.procedures).not.toBe(true);
    expect(ch.list().items).toHaveLength(1);
  });

  it('reads one record in full, and says why when it cannot', () => {
    const r = agentRecord();
    expect(ch.get(r.id)).toMatchObject({ status: 'ok', record: { id: r.id, steps: [{ text: 'Start the stack' }, { text: 'Run the suite' }] } });
    expect(ch.get('p-00000000')).toEqual({ status: 'missing' });
    expect(ch.get('../etc/passwd')).toEqual({ status: 'missing' });
    expect(ch.get(42)).toEqual({ status: 'missing' });
    expect(ch.delete(r.id)).toEqual({ ok: true });
    expect(ch.get(r.id)).toEqual({ status: 'deleted' });
  });

  it('counts the records by kind and state, names the oldest, and sums the savings', () => {
    const a = agentRecord();
    agentRecord({ kind: 'tool', key: 'git', title: 'Rebase a branch' });
    store.stale(a.id, 1, '2026-10-09T11:00:00.000Z');
    clock = T0 + 200 * 24 * 3600 * 1000;
    const s = ch.stats();
    expect(s).toMatchObject({ total: 2, byKind: { repo: 1, tool: 1, gui: 0, cycle: 0, request: 0 }, unreviewed: 2, failing: 1, old: 2, enabled: false });
    expect(s.oldest).toMatchObject({ id: a.id });
    expect(s.saved).toMatchObject({ procedures: 0, tokens: 0, approximate: true });
  });
});

describe("the person's writes", () => {
  it('edits a record: through the validator, marked as the person, reviewed, revision up, the version before kept', () => {
    const r = agentRecord();
    const saved = ok(ch.save(r.id, r.revision, content({ title: 'Run the tests end to end' })));
    expect(saved).toMatchObject({ id: r.id, revision: 2, title: 'Run the tests end to end', reviewed: true, origin: { by: 'person', surface: 'person', createdBy: 'writer' }, previous: { title: 'Run the end-to-end tests' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ kind: 'procedure', issue: 0, target: 'procedures:replace', via: 'person', by: 'person', ok: true, result: 'replaced' });
    expect(audits[0].fields).toMatchObject({ agent: 'person', id: r.id, revision: '2', title: 'Run the tests end to end' });
  });

  it('refuses what the agent would be refused, every field at once, audited without the value', () => {
    const r = agentRecord();
    const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const w = ch.save(r.id, r.revision, content({ title: 'a <b> title', steps: [{ text: `use ${secret}` }] }));
    expect(w.ok).toBe(false);
    if (w.ok) return;
    expect(w.code).toBe('invalid');
    expect([...new Set(w.refusals?.map((x) => x.field))].sort()).toEqual(['steps[0].text', 'title']);
    expect(JSON.stringify(w)).not.toContain(secret);
    expect(store.get(r.id)).toMatchObject({ status: 'ok', record: { revision: 1 } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ ok: false, result: 'refused', fields: { fields: 'title, steps[0].text', code: 'invalid' } });
    expect(JSON.stringify(audits)).not.toContain(secret);
    expect(JSON.stringify(audits)).not.toContain('<b>');
  });

  it('refuses a key that is not a repository of the workspace, as the agent is', () => {
    const r = agentRecord();
    const w = ch.save(r.id, r.revision, content({ key: 'elsewhere' }));
    expect(w).toMatchObject({ ok: false, code: 'invalid', refusals: [{ field: 'key', code: 'key-repo' }] });
  });

  it('answers "changed since you read it" when the revision is old, and writes nothing', () => {
    const r = agentRecord();
    agentRecord({ title: 'Run the tests, new way' }, r.id, r.revision);
    const w = ch.save(r.id, r.revision, content());
    expect(w).toMatchObject({ ok: false, code: 'revision' });
    expect(store.get(r.id)).toMatchObject({ record: { revision: 2, title: 'Run the tests, new way' } });
  });

  it('edits an existing record only: an id that does not exist is not created', () => {
    expect(ch.save('p-00000009', 1, content())).toMatchObject({ ok: false, code: 'not-found' });
    expect(ch.save(undefined, 1, content())).toMatchObject({ ok: false, code: 'not-found' });
    expect(store.list().records).toEqual([]);
  });

  it('marks a record reviewed without moving its revision, text or state, once', () => {
    const r = agentRecord();
    const done = ok(ch.review(r.id));
    expect(done).toMatchObject({ id: r.id, revision: 1, reviewed: true, title: r.title, state: 'unverified', origin: { by: 'writer' } });
    expect(audits.map((a) => a.target)).toEqual(['procedures:review']);
    expect(audits[0]).toMatchObject({ result: 'marked reviewed', by: 'person', issue: 0 });
    // Already reviewed: nothing to write, nothing to audit.
    expect(ok(ch.review(r.id)).reviewed).toBe(true);
    expect(audits).toHaveLength(1);
    // An agent that read revision 1 can still replace it.
    expect(agentRecord({ title: 'Run the end-to-end tests again' }, r.id, 1)).toMatchObject({ revision: 2, reviewed: false });
  });

  it('restores the version before: a new revision with its text, the current text kept as the previous, the person as writer', () => {
    const r = agentRecord();
    const v2 = agentRecord({ title: 'Run the tests the new way', steps: [{ text: 'Just run it', run: 'npm run test:e2e' }] }, r.id, 1);
    expect(v2.previous?.title).toBe('Run the end-to-end tests');
    const back = ok(ch.restore(r.id, v2.revision));
    expect(back).toMatchObject({ revision: 3, title: 'Run the end-to-end tests', reviewed: true, origin: { by: 'person' }, previous: { title: 'Run the tests the new way' } });
    expect(back.steps).toEqual(r.steps);
    expect(audits.at(-1)).toMatchObject({ target: 'procedures:restore', result: 'restored the previous version' });
    // A second restore undoes the first.
    expect(ok(ch.restore(r.id, back.revision)).title).toBe('Run the tests the new way');
  });

  it('has nothing to restore on a record with no earlier version, and refuses a stale revision', () => {
    const r = agentRecord();
    expect(ch.restore(r.id, 1)).toMatchObject({ ok: false, code: 'no-previous' });
    const v2 = agentRecord({ title: 'Run it differently' }, r.id, 1);
    expect(ch.restore(r.id, 1)).toMatchObject({ ok: false, code: 'revision' });
    expect(store.get(r.id)).toMatchObject({ record: { revision: v2.revision } });
  });

  it('deletes: the file goes, the id is remembered and never drawn again, an agent holding it is told it is gone', () => {
    const r = agentRecord();
    expect(ch.delete(r.id)).toEqual({ ok: true });
    expect(readdirSync(proceduresPath(ws)).filter((f) => f.startsWith('p-'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(proceduresPath(ws), 'deleted.json'), 'utf8')).ids).toEqual([r.id]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ target: 'procedures:delete', result: 'deleted', issue: 0, by: 'person' });
    expect(audits[0].fields).toMatchObject({ id: r.id, title: r.title });
    expect(JSON.stringify(audits[0])).not.toContain('stack:up');
    // The next id is drawn again until it is free: the deleted one is not reused (the fake hex would give 00000002 next).
    expect(agentRecord().id).not.toBe(r.id);
    const replace = store.save({ input: content(), id: r.id, revision: 1, writer: agent, repos: ['api'] });
    expect(replace).toMatchObject({ ok: false, code: 'deleted' });
    expect(ch.delete(r.id)).toEqual({ ok: false, code: 'not-found' });
    expect(ch.review(r.id)).toMatchObject({ ok: false, code: 'deleted' });
  });

  it('works with the switch off: the view lists, edits and deletes', () => {
    config = { ...config, runner: { ...config.runner, procedures: false } };
    const r = agentRecord();
    expect(ok(ch.save(r.id, 1, content({ title: 'Run the suite' }))).revision).toBe(2);
    expect(ch.delete(r.id)).toEqual({ ok: true });
  });

  it('keeps a recorded gui draft "recording" until the person rewrites a step', () => {
    const w = store.save({ input: content({ kind: 'gui', key: 'docs.example.com', title: 'Update a row', steps: [{ text: 'Open the sheet' }] }), writer: agent, repos: ['api'], keyedBy: 'app', stepsFrom: 'recording' });
    if (!w.ok) throw new Error(w.text);
    const same = ok(ch.save(w.record.id, 1, content({ kind: 'gui', key: 'docs.example.com', title: 'Update a row in a sheet', steps: [{ text: 'Open the sheet' }] })));
    expect(same.stepsFrom).toBe('recording');
    expect(same.keyedBy).toBe('app');
    const edited = ok(ch.save(w.record.id, 2, content({ kind: 'gui', key: 'docs.example.com', title: 'Update a row in a sheet', steps: [{ text: 'Open the budget sheet' }] })));
    expect(edited.stepsFrom).toBe('edited');
  });
});

describe('the audit entry of the person', () => {
  it('has no issue, no thread, and no step, pitfall or wait', () => {
    const r = agentRecord({ pitfalls: ['Do not run it twice'], waits: ['about 3 s'] });
    const e = procedureAuditEntry({ op: 'review', by: 'person', surface: 'person', record: r });
    expect(e).toMatchObject({ kind: 'procedure', issue: 0, via: 'person', target: 'procedures:review' });
    expect(JSON.stringify(e)).not.toMatch(/stack:up|twice|3 s/);
  });
});

describe('the view helpers', () => {
  it('filters by kind, key, agent, state and unreviewed, and searches the title and the key', () => {
    const a = agentRecord();
    const b = agentRecord({ kind: 'tool', key: 'git', title: 'Rebase a branch' });
    ch.review(b.id);
    store.stale(a.id, 1, '2026-10-09T11:00:00.000Z');
    const items = ch.list().items;
    const ids = (f: Partial<typeof NO_FILTERS>): string[] => filterProcedures(items, { ...NO_FILTERS, ...f }).map((p) => p.id);
    expect(ids({})).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids({ kind: 'tool' })).toEqual([b.id]);
    expect(ids({ key: 'api' })).toEqual([a.id]);
    expect(ids({ state: 'failing' })).toEqual([a.id]);
    expect(ids({ unreviewed: true })).toEqual([a.id]);
    expect(ids({ by: 'writer' })).toEqual([a.id, b.id].sort());
    expect(ids({ search: 'REBASE' })).toEqual([b.id]);
    expect(ids({ search: ' git ' })).toEqual([b.id]);
    expect(ids({ kind: 'tool', unreviewed: true })).toEqual([]);
  });

  it('sorts what needs the person first: failing, then not reviewed', () => {
    const a = agentRecord();
    const b = agentRecord({ kind: 'tool', key: 'git', title: 'Rebase a branch' });
    const c = agentRecord({ key: 'api', title: 'Build the docs' });
    ch.review(b.id);
    store.stale(c.id, 1, '2026-10-09T11:00:00.000Z');
    expect(sortProcedures(ch.list().items).map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });

  it('summarises a record without its text', () => {
    const r = agentRecord();
    expect(Object.keys(summarize(r, T0)).sort()).not.toContain('steps');
  });
});
