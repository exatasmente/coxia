import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync as renameSyncReal, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, isOld, type ProcedureRecord } from '../src/shared/procedures';
import type { StageUsage } from '../src/shared/runs/types';
import { createProcedureStore, proceduresPath, type CallEnd, type ProcedureStore, type SaveRequest, type StoreDeps } from '../src/main/procedures/store';

// Every test has a workspace folder of its own in the temp folder: never the app's real data.
let ws: string;
let clock: number;
let counter: number;

const AT = '2026-10-09T10:30:00.000Z';
const T0 = Date.parse('2026-10-09T10:00:00Z');
const writer = { by: 'writer', surface: 'stage' as const, stage: 'development', ref: 'app#123', permission: 'worktree' as const, shell: 'sandbox' as const };
const repos = ['api', 'web'];
const usage = (promptTokens: number): StageUsage => ({ promptTokens, completionTokens: 100, cachedTokens: 0, calls: 3, costUsd: null });

const content = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'repo',
  key: 'api',
  title: 'Run the end-to-end tests',
  steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite', run: 'npm run test:e2e' }],
  pitfalls: [],
  waits: [],
  ...over,
});

function make(deps: StoreDeps = {}): ProcedureStore {
  return createProcedureStore(ws, { now: () => clock, hex: () => (++counter).toString(16).padStart(8, '0'), ...deps });
}

const req = (over: Partial<SaveRequest> & { input?: unknown } = {}): SaveRequest => ({ input: content(), writer, repos, ...over });

function created(store: ProcedureStore, over: Record<string, unknown> = {}): ProcedureRecord {
  const r = store.save(req({ input: content(over) }));
  if (!r.ok) throw new Error(r.text);
  return r.record;
}

const fileOf = (id: string): string => join(proceduresPath(ws), `${id}.json`);
const onDisk = (id: string): ProcedureRecord => JSON.parse(readFileSync(fileOf(id), 'utf8'));

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-'));
  clock = T0;
  counter = 0;
});

describe('save: a new record', () => {
  it('writes one file under memory/procedures of the workspace folder, with the app-set fields', () => {
    const store = make();
    const r = store.save(req());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.record).toMatchObject({ v: 1, id: 'p-00000001', revision: 1, state: 'unverified', lastVerified: null, lastFailed: null, stepsFrom: 'agent', reviewed: false, previous: null });
    expect(r.record.stats).toEqual({ uses: 0, failures: 0, failuresSinceSave: 0, lastUsed: null, baseline: null, recent: [] });
    expect(r.record.origin).toEqual({ ...writer, createdBy: 'writer', at: '2026-10-09T10:00:00.000Z' });
    expect(onDisk('p-00000001')).toEqual(r.record);
    expect(readdirSync(proceduresPath(ws))).toEqual(['p-00000001.json']);
    expect(proceduresPath(ws)).toBe(join(ws, 'memory', 'procedures'));
  });

  it('the person\'s write is marked reviewed and as the person\'s', () => {
    const r = make().save(req({ writer: { by: 'person', surface: 'person' } }));
    expect(r.ok && r.record.reviewed).toBe(true);
    expect(r.ok && r.record.origin).toMatchObject({ by: 'person', createdBy: 'person', surface: 'person' });
  });

  it('names the agent as the creator when the person keeps what it did, and a replacement keeps the first creator', () => {
    const store = make();
    const kept = store.save(req({ writer: { ...writer, by: 'person' }, createdBy: 'writer' }));
    expect(kept.ok && kept.record.reviewed).toBe(true);
    expect(kept.ok && kept.record.origin).toMatchObject({ by: 'person', createdBy: 'writer', surface: 'stage', stage: 'development', ref: 'app#123', permission: 'worktree', shell: 'sandbox' });
    if (!kept.ok) return;
    const again = store.save(req({ id: kept.record.id, revision: 1, createdBy: 'someone-else', input: content({ title: 'Run the tests, fixed' }) }));
    expect(again.ok && again.record.origin.createdBy).toBe('writer');
  });

  it('draws ids of "p-" and 8 hex digits', () => {
    const r = createProcedureStore(ws).save(req());
    expect(r.ok && r.record.id).toMatch(/^p-[0-9a-f]{8}$/);
  });

  it('a refusal of the validator writes no file and tells what to fix', () => {
    const store = make();
    const r = store.save(req({ input: content({ title: 'Account 123456' }) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid');
    expect(r.text).toContain('title');
    expect(r.text).not.toContain('123456');
    expect(existsSync(proceduresPath(ws))).toBe(false);
  });

  it('a repo record needs a repository of the workspace', () => {
    const r = make().save(req({ input: content({ key: 'mobile' }) }));
    expect(r.ok).toBe(false);
  });
});

describe('save: atomic and checked', () => {
  it('a write that fails leaves the old file as it was and no temporary file', () => {
    let fail = false;
    const store = make({
      rename: (from, to) => {
        if (fail) throw new Error('disk full');
        renameSyncReal(from, to);
      },
    });
    const first = created(store);
    const before = readFileSync(fileOf(first.id), 'utf8');
    fail = true;
    const r = store.save(req({ id: first.id, revision: 1, input: content({ title: 'Run the tests again' }) }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('io');
    expect(readFileSync(fileOf(first.id), 'utf8')).toBe(before);
    expect(readdirSync(proceduresPath(ws))).toEqual([`${first.id}.json`]);
    const none = store.save(req({ input: content({ key: 'web' }) }));
    expect(none.ok).toBe(false);
    expect(readdirSync(proceduresPath(ws))).toEqual([`${first.id}.json`]);
  });

  it('two saves naming the same revision give one success and one "changed since you read it"', () => {
    const store = make();
    const first = created(store);
    const a = store.save(req({ id: first.id, revision: 1, input: content({ title: 'Run the tests, version A' }) }));
    const b = store.save(req({ id: first.id, revision: 1, input: content({ title: 'Run the tests, version B' }) }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.code).toBe('revision');
    expect(b.text).toContain('changed since you read it');
    expect(onDisk(first.id).title).toBe('Run the tests, version A');
    expect(onDisk(first.id).revision).toBe(2);
  });

  it('a replacement that names no revision is refused', () => {
    const store = make();
    const first = created(store);
    const r = store.save(req({ id: first.id, input: content({ title: 'Other' }) }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('revision');
  });

  it('an id that does not exist is "not found; save a new one"', () => {
    const r = make().save(req({ id: 'p-0000beef', revision: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r).toMatchObject({ code: 'not-found', text: expect.stringContaining('save a new one') });
  });
});

describe('save: the caps', () => {
  it('stops at 10 per kind and key, names the least used to replace, and evicts nothing', () => {
    const store = make();
    const records = Array.from({ length: LIMITS.perKey }, (_, i) => created(store, { title: `Task number ${i + 1}` }));
    // The fifth is the one used least: the others were used once.
    for (const r of records) if (r.id !== records[4].id) store.finishUse({ at: '2026-10-09T11:00:00.000Z', ref: 'app#1', usage: usage(100), read: [r.id], stale: [], replaced: [], created: [] });
    const eleventh = store.save(req({ input: content({ title: 'One too many' }) }));
    expect(eleventh.ok).toBe(false);
    if (eleventh.ok) return;
    expect(eleventh.code).toBe('cap-key');
    expect(eleventh.id).toBe(records[4].id);
    expect(eleventh.text).toContain(records[4].id);
    expect(store.list().records).toHaveLength(LIMITS.perKey);
    // Replacing the one it named is the way through, and another key has its own room.
    expect(store.save(req({ id: records[4].id, revision: 1, input: content({ title: 'One too many' }) })).ok).toBe(true);
    expect(store.save(req({ input: content({ key: 'web' }) })).ok).toBe(true);
  });

  it('stops at 300 per workspace and names the least used', () => {
    const store = make();
    for (let i = 0; i < LIMITS.perWorkspace; i++) created(store, { kind: 'tool', key: `tool-${Math.floor(i / 5)}`, title: `Use the tool, case ${i}` });
    const r = store.save(req({ input: content({ kind: 'tool', key: 'one-more', title: 'The newcomer' }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r).toMatchObject({ code: 'cap-workspace', text: expect.stringContaining('p-0000') });
    expect(store.list().records).toHaveLength(LIMITS.perWorkspace);
  });

  it('a refusal does not name a record that waits for the person\'s review, to an agent; the person is told', () => {
    const store = make();
    const held = store.save(req({ handoff: true }));
    if (!held.ok) throw new Error(held.text);
    const dup = store.save(req({}));
    expect(dup).toMatchObject({ ok: false, code: 'duplicate' });
    expect(JSON.stringify(dup)).not.toContain(held.record.id);
    expect(JSON.stringify(dup)).not.toContain('Run the end-to-end tests (');
    const person = store.save(req({ writer: { by: 'person', surface: 'person' } }));
    expect(person).toMatchObject({ ok: false, code: 'duplicate', id: held.record.id });

    // A key full of held records: nothing to point at.
    const full = make();
    for (let i = 0; i < LIMITS.perKey; i++) {
      const r = full.save(req({ handoff: true, input: content({ key: 'web', title: `Held number ${i + 1}` }) }));
      if (!r.ok) throw new Error(r.text);
    }
    const capped = full.save(req({ input: content({ key: 'web', title: 'One too many' }) }));
    expect(capped).toMatchObject({ ok: false, code: 'cap-key' });
    expect(JSON.stringify(capped)).not.toMatch(/p-0000|Held number/);
  });

  it('a near-duplicate title in the same kind and key is stopped, naming the record to update', () => {
    const store = make();
    const first = created(store);
    const r = store.save(req({ input: content({ title: '  run  the END-TO-END tests ' }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r).toMatchObject({ code: 'duplicate', id: first.id, text: expect.stringContaining(`${first.id}`) });
    // Another key, or another kind, may hold the same title.
    expect(store.save(req({ input: content({ key: 'web' }) })).ok).toBe(true);
    expect(store.save(req({ input: content({ kind: 'tool', key: 'make' }) })).ok).toBe(true);
  });

  it('a replacement does not collide with itself, but does with another record\'s title', () => {
    const store = make();
    const a = created(store);
    const b = created(store, { title: 'Start the stack' });
    expect(store.save(req({ id: a.id, revision: 1, input: content({ title: 'Run the end-to-end tests', pitfalls: ['A new pitfall'] }) })).ok).toBe(true);
    const clash = store.save(req({ id: b.id, revision: 1, input: content({ title: 'Run the end-to-end tests' }) }));
    expect(clash.ok).toBe(false);
  });
});

describe('save: a replacement', () => {
  it('replaces the text, bumps the revision, keeps one previous, and starts the state again', () => {
    const store = make();
    const first = created(store);
    store.stale(first.id, 2, '2026-10-09T10:30:00.000Z');
    store.finishUse({ at: '2026-10-09T11:00:00.000Z', ref: 'app#1', usage: usage(500), read: [], stale: [], replaced: [], created: [first.id] });
    clock = T0 + 3600_000;
    const second = store.save(req({ id: first.id, revision: 1, writer: { ...writer, by: 'fixer' }, input: content({ title: 'Run the tests, fixed', steps: [{ text: 'Run the suite', run: 'npm run test:e2e' }] }) }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    const r = second.record;
    expect(r.id).toBe(first.id);
    expect(r.revision).toBe(2);
    expect(r.state).toBe('unverified');
    expect(r.stats.failuresSinceSave).toBe(0);
    expect(r.stats.failures).toBe(1);
    expect(r.stats.baseline).toEqual(usage(500));
    expect(r.origin).toMatchObject({ by: 'fixer', createdBy: 'writer', at: '2026-10-09T11:00:00.000Z' });
    expect(r.previous).toEqual({ title: 'Run the end-to-end tests', steps: first.steps, pitfalls: [], waits: [] });
    expect(r.title).toBe('Run the tests, fixed');
    expect(r.reviewed).toBe(false);
    // One level only: a third revision keeps the second, not the first.
    const third = store.save(req({ id: first.id, revision: 2, input: content({ title: 'Run the tests, third' }) }));
    expect(third.ok && third.record.previous?.title).toBe('Run the tests, fixed');
    expect(store.list().records).toHaveLength(1);
  });

  it('an agent may replace what the person wrote; the revision is then the agent\'s', () => {
    const store = make();
    const mine = store.save(req({ writer: { by: 'person', surface: 'person' } }));
    if (!mine.ok) throw new Error(mine.text);
    const r = store.save(req({ id: mine.record.id, revision: 1, input: content({ title: 'Changed by an agent' }) }));
    expect(r.ok && r.record.reviewed).toBe(false);
    expect(r.ok && r.record.previous?.title).toBe('Run the end-to-end tests');
  });

  it('an agent replacing an agent\'s version does not push the person\'s version out of previous', () => {
    const store = make();
    const mine = store.save(req({ writer: { by: 'person', surface: 'person' } }));
    if (!mine.ok) throw new Error(mine.text);
    const second = store.save(req({ id: mine.record.id, revision: 1, input: content({ title: 'Changed by an agent' }) }));
    expect(second.ok && second.record.previous).toMatchObject({ title: 'Run the end-to-end tests', byPerson: true });
    const third = store.save(req({ id: mine.record.id, revision: 2, input: content({ title: 'Changed again by an agent' }) }));
    expect(third.ok && third.record.previous?.title).toBe('Run the end-to-end tests');
    const fourth = store.save(req({ id: mine.record.id, revision: 3, input: content({ title: 'Changed a third time' }) }));
    expect(fourth.ok && fourth.record.previous?.title).toBe('Run the end-to-end tests');
    // The person marks the agent's version as reviewed: that one is now worth keeping, and the next agent replacement pushes it into previous.
    store.review(mine.record.id);
    const fifth = store.save(req({ id: mine.record.id, revision: 4, input: content({ title: 'Changed a fourth time' }) }));
    expect(fifth.ok && fifth.record.previous).toMatchObject({ title: 'Changed a third time', byPerson: true });
  });

  it('the person\'s edit of a failing record makes it unverified; of an ok one it keeps the state', () => {
    const store = make();
    const failing = created(store);
    store.stale(failing.id, 1, '2026-10-09T10:30:00.000Z');
    const edited = store.save(req({ id: failing.id, revision: 1, writer: { by: 'person', surface: 'person' }, input: content({ title: 'Run the tests by hand' }) }));
    expect(edited.ok && edited.record).toMatchObject({ state: 'unverified', reviewed: true });

    const okOne = created(store, { title: 'Another task' });
    store.finishUse({ at: '2026-10-09T10:40:00.000Z', ref: 'app#1', usage: usage(1), read: [okOne.id], stale: [], replaced: [], created: [] });
    const kept = store.save(req({ id: okOne.id, revision: 1, writer: { by: 'person', surface: 'person' }, input: content({ title: 'Another task, reworded' }) }));
    expect(kept.ok && kept.record).toMatchObject({ state: 'ok', lastVerified: '2026-10-09T10:40:00.000Z', reviewed: true });
  });
});

describe('leftovers of a write that died', () => {
  it('a temporary file older than an hour is removed when the store lists; a younger one is left', () => {
    const store = make();
    const r = created(store);
    const old = `${fileOf(r.id)}.tmp-4242`;
    const young = `${fileOf(r.id)}.tmp-4343`;
    const foreign = join(proceduresPath(ws), 'notes.tmp-1');
    for (const [path, ageMs] of [[old, 2 * 3600_000], [young, 10 * 60_000], [foreign, 2 * 3600_000]] as const) {
      writeFileSync(path, '{');
      utimesSync(path, (clock - ageMs) / 1000, (clock - ageMs) / 1000);
    }
    expect(store.list().records).toHaveLength(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });

  it('a read-only store lists and gets without sweeping, and every write method throws', () => {
    const r = created(make());
    const old = `${fileOf(r.id)}.tmp-4242`;
    writeFileSync(old, '{');
    utimesSync(old, (clock - 2 * 3600_000) / 1000, (clock - 2 * 3600_000) / 1000);
    const ro = make({ readOnly: true });
    expect(ro.list().records).toHaveLength(1);
    expect(ro.get(r.id).status).toBe('ok');
    expect(existsSync(old)).toBe(true);
    expect(() => ro.save(req())).toThrow(/read-only/);
    expect(() => ro.remove(r.id)).toThrow(/read-only/);
    expect(() => ro.stale(r.id, 1, '2026-10-03T10:00:00.000Z')).toThrow(/read-only/);
    expect(() => ro.review(r.id)).toThrow(/read-only/);
    expect(() => ro.finishUse({} as CallEnd)).toThrow(/read-only/);
    expect(existsSync(fileOf(r.id))).toBe(true);
  });
});

describe('a stored file with malformed figures', () => {
  it('is skipped by the list, and the statistics over the others still work', async () => {
    const store = make();
    const good = created(store);
    const bad = created(store, { title: 'The broken one' });
    const raw = onDisk(bad.id);
    writeFileSync(fileOf(bad.id), JSON.stringify({ ...raw, stats: { ...raw.stats, recent: [{ at: AT, ref: 'x', failed: false, usage: null }] } }));
    const listed = store.list();
    expect(listed.records.map((r) => r.id)).toEqual([good.id]);
    expect(listed.skipped).toBe(1);
    const { statsOf } = await import('../src/shared/proceduresView');
    expect(() => statsOf(listed.records, true, T0)).not.toThrow();
  });
});

describe('stale and use', () => {
  it('a stale report sets failing, lastFailed and the step, without moving the revision', () => {
    const store = make();
    const r = created(store);
    const at = '2026-10-09T10:30:00.000Z';
    const marked = store.stale(r.id, 2, at);
    expect(marked.ok).toBe(true);
    expect(onDisk(r.id)).toMatchObject({ state: 'failing', lastFailed: { at, step: 2 }, revision: 1, stats: { failures: 1, failuresSinceSave: 1 } });
    // The agent that found it failing still holds revision 1 and can write the fix.
    expect(store.save(req({ id: r.id, revision: 1, input: content({ title: 'Run the tests, fixed' }) })).ok).toBe(true);
  });

  it('refuses a report that read an older revision than the record has', () => {
    const store = make();
    const r = created(store);
    store.save(req({ id: r.id, revision: 1, input: content({ title: 'Run the tests, fixed' }) }));
    expect(store.stale(r.id, 1, AT, 1)).toMatchObject({ ok: false, code: 'revision' });
    expect(onDisk(r.id)).toMatchObject({ revision: 2, state: 'unverified', stats: { failures: 0 } });
    expect(store.stale(r.id, 1, AT, 2).ok).toBe(true);
  });

  it('refuses a step the record does not have, and a record that is not there', () => {
    const store = make();
    const r = created(store);
    expect(store.stale(r.id, 3, AT)).toMatchObject({ ok: false, code: 'step' });
    expect(store.stale(r.id, 0, AT)).toMatchObject({ ok: false, code: 'step' });
    expect(store.stale('p-0000beef', 1, AT)).toMatchObject({ ok: false, code: 'not-found' });
    expect(onDisk(r.id).state).toBe('unverified');
  });

  const end = (over: Partial<CallEnd> = {}): CallEnd => ({ at: '2026-10-09T11:00:00.000Z', ref: 'app#9', usage: usage(1000), read: [], stale: [], replaced: [], created: [], ...over });

  it('a call that read a record and reported no failure makes it ok, with the use and the figures', () => {
    const store = make();
    const r = created(store);
    const marks = store.finishUse(end({ read: [r.id, r.id] }));
    expect(marks).toEqual([{ id: r.id, revision: 1, title: r.title, outcome: 'ok' }]);
    expect(onDisk(r.id)).toMatchObject({ state: 'ok', lastVerified: '2026-10-09T11:00:00.000Z', stats: { uses: 1, lastUsed: '2026-10-09T11:00:00.000Z', recent: [{ at: '2026-10-09T11:00:00.000Z', ref: 'app#9', failed: false, usage: usage(1000) }] } });
  });

  it('a record reported stale in the call stays failing, and the use is counted as failed', () => {
    const store = make();
    const r = created(store);
    store.stale(r.id, 1, '2026-10-09T10:50:00.000Z');
    const marks = store.finishUse(end({ read: [r.id], stale: [r.id] }));
    expect(marks).toEqual([{ id: r.id, revision: 1, title: r.title, outcome: 'failed' }]);
    expect(onDisk(r.id)).toMatchObject({ state: 'failing', lastVerified: null, stats: { uses: 1, failures: 1, recent: [{ failed: true }] } });
  });

  it('a record the call replaced is not a use', () => {
    const store = make();
    const r = created(store);
    const fixed = store.save(req({ id: r.id, revision: 1, input: content({ title: 'Run the tests, fixed' }) }));
    expect(fixed.ok).toBe(true);
    const marks = store.finishUse(end({ read: [r.id], replaced: [r.id] }));
    expect(marks).toEqual([{ id: r.id, revision: 2, title: 'Run the tests, fixed', outcome: 'replaced' }]);
    expect(onDisk(r.id)).toMatchObject({ state: 'unverified', stats: { uses: 0, recent: [] } });
  });

  it('what a call created gets its usage as the baseline, once', () => {
    const store = make();
    const r = created(store);
    store.finishUse(end({ created: [r.id], usage: usage(7000) }));
    store.finishUse(end({ created: [r.id], usage: usage(9999) }));
    expect(onDisk(r.id).stats.baseline).toEqual(usage(7000));
    expect(onDisk(r.id).stats.uses).toBe(0);
  });

  it('keeps the last 20 uses, oldest out', () => {
    const store = make();
    const r = created(store);
    for (let i = 1; i <= LIMITS.recent + 5; i++) store.finishUse(end({ read: [r.id], ref: `app#${i}`, usage: usage(i) }));
    const stats = onDisk(r.id).stats;
    expect(stats.uses).toBe(LIMITS.recent + 5);
    expect(stats.recent).toHaveLength(LIMITS.recent);
    expect(stats.recent[0].ref).toBe('app#6');
    expect(stats.recent[LIMITS.recent - 1].ref).toBe(`app#${LIMITS.recent + 5}`);
  });

  it('an id that is gone is skipped, not marked', () => {
    const store = make();
    const r = created(store);
    store.remove(r.id);
    expect(store.finishUse(end({ read: [r.id], created: [r.id] }))).toEqual([]);
    expect(existsSync(fileOf(r.id))).toBe(false);
  });

  it('a record not verified for 90 days is still listed, and is old', () => {
    const store = make();
    const r = created(store);
    store.finishUse(end({ read: [r.id], at: '2026-01-01T00:00:00.000Z' }));
    const now = Date.parse('2026-10-09T00:00:00Z');
    const listed = store.list().records;
    expect(listed.map((x) => x.id)).toEqual([r.id]);
    expect(isOld(listed[0], now)).toBe(true);
  });
});

describe('delete', () => {
  it('removes the file, remembers the id, and an agent holding the id is told it is gone', () => {
    const store = make();
    const r = created(store);
    expect(store.remove(r.id)).toEqual({ ok: true });
    expect(existsSync(fileOf(r.id))).toBe(false);
    expect(JSON.parse(readFileSync(join(proceduresPath(ws), 'deleted.json'), 'utf8')).ids).toEqual([r.id]);
    expect(store.get(r.id)).toEqual({ status: 'deleted' });
    const replace = store.save(req({ id: r.id, revision: 1 }));
    expect(replace.ok).toBe(false);
    if (!replace.ok) expect(replace).toMatchObject({ code: 'deleted', text: expect.stringContaining('Save it as a new procedure') });
    expect(store.remove(r.id)).toEqual({ ok: false, code: 'not-found' });
  });

  it('never gives a deleted id to a new record', () => {
    // The id source repeats the deleted id first.
    const ids = ['00000001', '00000001', '00000002'];
    const store = createProcedureStore(ws, { now: () => clock, hex: () => ids.shift() ?? 'ffffffff' });
    const first = created(store);
    expect(first.id).toBe('p-00000001');
    store.remove(first.id);
    const second = created(store, { title: 'A different task' });
    expect(second.id).toBe('p-00000002');
  });

  it('does not draw an id that is a file already', () => {
    const ids = ['00000001', '00000001', '00000002'];
    const store = createProcedureStore(ws, { now: () => clock, hex: () => ids.shift() ?? 'ffffffff' });
    expect(created(store).id).toBe('p-00000001');
    expect(created(store, { title: 'Second task' }).id).toBe('p-00000002');
  });
});

describe('a record of a newer app', () => {
  it('is not listed, not read, and never overwritten, marked or deleted', () => {
    const store = make();
    const mine = created(store);
    mkdirSync(proceduresPath(ws), { recursive: true });
    const theirs = join(proceduresPath(ws), 'p-0000abcd.json');
    const text = `${JSON.stringify({ v: 2, id: 'p-0000abcd', anything: 'a newer shape' })}\n`;
    writeFileSync(theirs, text);
    expect(store.list()).toMatchObject({ skipped: 1 });
    expect(store.list().records.map((r) => r.id)).toEqual([mine.id]);
    expect(store.get('p-0000abcd')).toEqual({ status: 'newer', v: 2 });
    const save = store.save(req({ id: 'p-0000abcd', revision: 1, input: content({ title: 'Overwrite it' }) }));
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.code).toBe('newer');
    expect(store.stale('p-0000abcd', 1, AT)).toMatchObject({ ok: false, code: 'newer' });
    expect(store.finishUse({ at: '2026-10-09T11:00:00.000Z', ref: 'r', usage: usage(1), read: ['p-0000abcd'], stale: [], replaced: [], created: ['p-0000abcd'] })).toEqual([]);
    expect(store.remove('p-0000abcd')).toEqual({ ok: false, code: 'newer' });
    expect(readFileSync(theirs, 'utf8')).toBe(text);
  });

  it('a deleted.json of a newer app is not overwritten: the delete is refused', () => {
    const store = make();
    const r = created(store);
    const file = join(proceduresPath(ws), 'deleted.json');
    writeFileSync(file, '{"v":2,"ids":[],"more":true}\n');
    expect(store.remove(r.id)).toEqual({ ok: false, code: 'newer' });
    expect(existsSync(fileOf(r.id))).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('{"v":2,"ids":[],"more":true}\n');
  });

  it('a file that is not a record is skipped and counted, and a temporary file is not looked at', () => {
    const store = make();
    created(store);
    writeFileSync(join(proceduresPath(ws), 'p-0000dead.json'), '{not json');
    writeFileSync(join(proceduresPath(ws), 'notes.json'), '{}');
    writeFileSync(join(proceduresPath(ws), 'p-0000f00d.json.tmp-1'), '{}');
    expect(store.list()).toMatchObject({ skipped: 1 });
    expect(store.list().records).toHaveLength(1);
  });
});

describe('where records live', () => {
  it('only in the workspace folder: a worktree or a cycle folder never gets one, and a file an agent writes is not a record', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coxia-procedures-worktree-'));
    const cycle = join(worktree, 'docs', 'cycles', '123-a-task');
    mkdirSync(cycle, { recursive: true });
    const store = make();
    const r = created(store);
    store.stale(r.id, 1, '2026-10-09T10:30:00.000Z');
    store.finishUse({ at: '2026-10-09T11:00:00.000Z', ref: 'r', usage: usage(1), read: [r.id], stale: [], replaced: [], created: [r.id] });
    expect(readdirSync(worktree)).toEqual(['docs']);
    expect(readdirSync(cycle)).toEqual([]);
    expect(readdirSync(join(ws, 'memory'))).toEqual(['procedures']);

    // A record-shaped file in the agent's own folder is nothing to the store; dropped into the store's folder with a foreign id it is still only what it parses to.
    writeFileSync(join(cycle, 'p-0000cafe.json'), JSON.stringify({ ...onDisk(r.id), id: 'p-0000cafe' }));
    expect(store.get('p-0000cafe')).toEqual({ status: 'missing' });
    expect(store.list().records.map((x) => x.id)).toEqual([r.id]);
  });

  it('a file whose name is one id and whose content another is invalid', () => {
    const store = make();
    const r = created(store);
    writeFileSync(join(proceduresPath(ws), 'p-0000cafe.json'), JSON.stringify(onDisk(r.id)));
    expect(store.get('p-0000cafe')).toEqual({ status: 'invalid' });
  });
});
