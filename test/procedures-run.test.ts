// What a run keeps of the procedures a stage used (#179): the field of the stage record, the run format 5 that carries it (and only it), the file check, and the whole
// path from a stage that read a procedure to its record. A stage that read none leaves no field and the run stays in the format it had.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunStore } from '../src/main/runs-core';
import type { ProcedureUse } from '../src/shared/procedures';
import { PROCEDURES_PER_STAGE, RUN_VERSION, parseRun, recordEvidence, recordProcedures, runVersionOf, startRun, type EvidenceRecord, type Run } from '../src/shared/runs';
import { setLanguage } from '../src/shared/i18n';
import { createProceduresPort } from '../src/main/procedures/port';
import { createProcedureStore } from '../src/main/procedures/store';
import { agentFlowStages, at, startInput } from './helpers/runs';
import { type BootOptions, boot, doc, work, type Boot } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');
const { DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');

const flow = agentFlowStages();
const fresh = (over = {}): Run => startRun(startInput(over), flow, at(0)).run;
const use = (n: number, over: Partial<ProcedureUse> = {}): ProcedureUse => ({ id: `p-${n.toString(16).padStart(8, '0')}`, revision: 1, title: `Task number ${n}`, outcome: 'ok', ...over });
const stageOf = (run: Run) => run.stages.find((s) => s.stage === run.stage)!;

const recording: EvidenceRecord = { id: 'ev-1', stage: 'qa', by: 'qa', title: 'Screen recording', description: '', name: 'screen-recording.webm', kind: 'webm', bytes: 100, at: at(2), from: null, message: null, recording: { durationMs: 9000, width: 8, height: 4, marks: [], cuts: [{ atMs: 1, skippedMs: 2 }] } };

describe('recordProcedures', () => {
  it('adds the uses to the record of the stage, one entry per procedure, the later outcome replacing the earlier', () => {
    const run = fresh();
    const first = recordProcedures(run, run.stage, [use(1), use(2)], at(1)).run;
    expect(stageOf(first).procedures).toEqual([use(1), use(2)]);
    const second = recordProcedures(first, run.stage, [use(2, { outcome: 'failed' }), use(3)], at(2)).run;
    expect(stageOf(second).procedures).toEqual([use(1), use(2, { outcome: 'failed' }), use(3)]);
    expect(run.stages.every((s) => s.procedures === undefined)).toBe(true);
  });

  it('keeps the most a stage lists, and adds no field for a stage that used none', () => {
    const run = fresh();
    const many = recordProcedures(run, run.stage, Array.from({ length: PROCEDURES_PER_STAGE + 5 }, (_, i) => use(i + 1)), at(1)).run;
    expect(stageOf(many).procedures).toHaveLength(PROCEDURES_PER_STAGE);
    expect(stageOf(many).procedures?.at(-1)?.title).toBe(`Task number ${PROCEDURES_PER_STAGE + 5}`);
    expect(stageOf(recordProcedures(run, run.stage, [], at(1)).run).procedures).toBeUndefined();
    expect(recordProcedures(run, 'no-such-stage', [use(1)], at(1)).run.stages).toEqual(run.stages);
  });
});

describe('the run format', () => {
  it('is 5 only when a stage record holds the field, whatever else the run holds', () => {
    const run = fresh();
    expect(RUN_VERSION).toBe(6);
    expect(runVersionOf(run)).toBe(1);
    expect(runVersionOf(recordProcedures(run, run.stage, [use(1)], at(1)).run)).toBe(5);
    // A recording with cuts is 3 by itself; with a procedure the run is 5.
    expect(runVersionOf({ evidence: { 'ev-1': recording } })).toBe(3);
    expect(runVersionOf({ evidence: { 'ev-1': recording }, stages: [{ procedures: [use(1)] }] })).toBe(5);
    expect(runVersionOf({ stages: [{}, {}] })).toBe(1);
  });

  // #160: a run blocked by its pull request carries values an older app's closed enums and strict records would call invalid, so it is written as 6.
  it('is 6 when the run is blocked by its pull request, whatever else it holds, and only then', () => {
    const run = fresh();
    expect(runVersionOf(run)).toBe(1);
    const question = (extra: Record<string, unknown>) => ({ ...run.question, ...extra }) as unknown as NonNullable<Run['question']>;
    expect(runVersionOf({ question: question({ kind: 'pr-retry' }) })).toBe(6);
    expect(runVersionOf({ question: question({ kind: 'agent', bases: ['main'] }) })).toBe(6);
    expect(runVersionOf({ question: question({ kind: 'agent', targetBranch: 'release/1.0.0' }) })).toBe(6);
    expect(runVersionOf({ question: question({ kind: 'agent', baseGone: true }) })).toBe(6);
    expect(runVersionOf({ question: question({ kind: 'agent' }) })).toBe(1);
    expect(runVersionOf({ error: { code: 'pr-open-failed' } })).toBe(6);
    expect(runVersionOf({ error: { code: 'stage-failed' } })).toBe(1);
    expect(runVersionOf({ comments: { pr: { waitingSaid: true } } })).toBe(6);
    expect(runVersionOf({ comments: { pr: {} } })).toBe(1);
    // It wins over a procedure and a recording; a run with procedures and none of these stays at 5.
    expect(runVersionOf({ error: { code: 'pr-open-failed' }, stages: [{ procedures: [use(1)] }] })).toBe(6);
    expect(runVersionOf({ evidence: { 'ev-1': recording }, comments: { pr: { waitingSaid: true } } })).toBe(6);
    expect(runVersionOf({ error: { code: 'stage-failed' }, comments: { pr: {} }, stages: [{ procedures: [use(1)] }] })).toBe(5);
  });

  it('is stamped by the store on every save and follows the content', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'coxia-runs-')), 'runs');
    const store = createRunStore(dir);
    const run = store.create(fresh());
    const onDisk = (): { version: number } => JSON.parse(readFileSync(join(dir, `${run.id}.json`), 'utf8'));
    expect(onDisk().version).toBe(1);
    store.update(run.id, (r) => recordProcedures(r, r.stage, [use(1)], at(1)));
    expect(onDisk().version).toBe(5);
    expect(store.get(run.id)?.stages[0].procedures).toEqual([use(1)]);
    // A move that adds a recording does not take the version down.
    store.update(run.id, (r) => recordEvidence(r, recording, at(2)));
    expect(onDisk().version).toBe(5);
  });

  it('is believed by the file check: a good field is read back, a bad one and a newer format are refused', () => {
    const base = JSON.parse(JSON.stringify(recordProcedures(fresh(), 'refine', [use(1)], at(1)).run));
    base.version = 4;
    expect(parseRun(base).ok).toBe(true);
    const with_ = (u: Record<string, unknown>) => parseRun({ ...base, stages: [{ ...base.stages[0], procedures: [{ ...use(1), ...u }] }] });
    expect(with_({}).ok).toBe(true);
    expect(with_({ outcome: 'lost' }).ok).toBe(false);
    expect(with_({ id: 'p-xyz' }).ok).toBe(false);
    expect(with_({ revision: 0 }).ok).toBe(false);
    expect(with_({ title: 'x'.repeat(81) }).ok).toBe(false);
    expect(with_({ steps: [] }).ok).toBe(false);
    const newer = parseRun({ ...base, version: 7 });
    expect(newer).toMatchObject({ ok: false, reason: 'newer' });
  });

  it('a run of an older format is read as it was, with no field', () => {
    const old = JSON.parse(JSON.stringify(fresh()));
    const parsed = parseRun(old);
    expect(parsed.ok && parsed.run.stages.every((s) => s.procedures === undefined)).toBe(true);
  });
});

describe('from a stage that read a procedure to its record', () => {
  let dir: string;
  beforeAll(() => setLanguage('en'));
  afterAll(() => setLanguage('pt-BR'));
  beforeEach(() => {
    updateConfig((c) => ({ ...c, language: 'en' }));
    dir = mkdtempSync(join(tmpdir(), 'procedures-run-'));
    writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const start = (over: BootOptions = {}): Promise<Boot> =>
    boot({ dir, procedures: createProceduresPort({ config: getConfig, dir }), ...over, configure: (c) => { c.language = 'en'; over.configure?.(c); } });

  const seeded = () => {
    const r = createProcedureStore(dir).save({ input: { kind: 'repo', key: 'app', title: 'Run the end-to-end tests', steps: [{ text: 'Start the stack' }] }, writer: { by: 'seeder', surface: 'stage' }, repos: ['app'] });
    if (!r.ok) throw new Error(r.text);
    return r.record;
  };

  it('marks the stage with the id, the revision and the outcome, and the run is stored as format 5; the next stage that read none has no mark', async () => {
    const record = seeded();
    const b = await start();
    b.engine.script('refiner', async (call) => {
      await call.procedures?.get({ id: record.id });
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' });
    });
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const done = b.runs.get(run.id)!;
    const refine = done.stages.find((s) => s.stage === 'refine')!;
    expect(refine.procedures).toEqual([{ id: record.id, revision: 1, title: 'Run the end-to-end tests', outcome: 'ok' }]);
    expect(done.stages.filter((s) => s.stage !== 'refine').every((s) => s.procedures === undefined)).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'runs', `${run.id}.json`), 'utf8')).version).toBe(5);
    expect(b.thread(done).find((m) => m.code === 'runner.procedures.used')).toBeDefined();
  });

  it('a stage that reported a step failed says so, and one that replaced the procedure says that', async () => {
    const failing = seeded();
    const other = createProcedureStore(dir).save({ input: { kind: 'repo', key: 'app', title: 'Run the linter', steps: [{ text: 'Run it' }] }, writer: { by: 'seeder', surface: 'stage' }, repos: ['app'] });
    if (!other.ok) throw new Error(other.text);
    const b = await start();
    b.engine.script('refiner', async (call) => {
      await call.procedures?.get({ id: failing.id });
      await call.procedures?.stale({ id: failing.id, step: 1 });
      await call.procedures?.get({ id: other.record.id });
      await call.procedures?.save({ id: other.record.id, revision: 1, kind: 'repo', key: 'app', title: 'Run the linter, fixed', steps: [{ text: 'Run it with the flag' }] });
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' });
    });
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const refine = b.runs.get(run.id)!.stages.find((s) => s.stage === 'refine')!;
    expect(refine.procedures).toEqual([
      { id: failing.id, revision: 1, title: 'Run the end-to-end tests', outcome: 'failed' },
      { id: other.record.id, revision: 2, title: 'Run the linter, fixed', outcome: 'replaced' },
    ]);
  });

  it('a stage that read nothing leaves no field and the run keeps format 1; a failed call marks no use', async () => {
    const record = seeded();
    const b = await start();
    b.engine.script('refiner', async (call) => {
      await call.procedures?.get({ id: record.id });
      throw new Error('the model went away');
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    const after = b.runs.get(run.id)!;
    expect(after.stages.every((s) => s.procedures === undefined)).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'runs', `${run.id}.json`), 'utf8')).version).toBe(1);
  });
});
