// The runner follows the flow the cycle says, not an order of its own: a stage added or taken out changes new runs and not the ones going on, the stages that
// wait look at the code host on the runner's tick, an agent can ask the person who reported the issue, and a stage can set a label on the tracker.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newAgent } from '../src/shared/config/team';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, issue, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { onRunnerActionDone } = await import('../src/main/runner/door');

let forge: Forge;
let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  stop?.();
  stop = null;
});

const stage = (id: string, over: Partial<StageDef> = {}): StageDef => ({ id, label: id, match: [], kind: 'development', rank: 0, type: 'work', ...over });
const at = (c: WorkspaceConfig, id: string): StageDef => c.devCycle.stages.find((s) => s.id === id) as StageDef;
const addAgent = (c: WorkspaceConfig, id: string, stages: string[]): void => void c.agents.team.push(newAgent({ id, name: id, stages, autonomous: true, model: { role: 'deep' } }));
const notReady = (c: WorkspaceConfig): void => {
  at(c, 'ready').type = 'wait';
};

/** Every agent does its stage at once; a test overrides the ones it is about. */
function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
  b.engine.script('security', () => work('Safe.', { artifacts: [doc('4B_SECURITY.md')], verdict: 'approved', findings: [] }));
  b.engine.script('writer', () => work('Written.', { artifacts: [doc('6_NOTE.md')] }));
}

/** Approves gates until the run is at something else. */
async function through(b: Boot, run: Run | string): Promise<Run> {
  const id = typeof run === 'string' ? run : run.id;
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(id)!;
    if (now.status !== 'gate') return now;
    b.runner.gate(id, 'approve');
  }
  return b.runner.get(id)!;
}

/** Approves gates until the run is waiting at the stage `id` (or at something else). */
async function until(b: Boot, run: Run | string, id: string): Promise<Run> {
  const key = typeof run === 'string' ? run : run.id;
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(key)!;
    if (now.stage === id || now.status !== 'gate') return now;
    b.runner.gate(key, 'approve');
  }
  return b.runner.get(key)!;
}

const security = (c: WorkspaceConfig): void => {
  const i = c.devCycle.stages.findIndex((s) => s.id === 'review');
  c.devCycle.stages.splice(i + 1, 0, stage('security', { label: 'Security', kind: 'review', agentId: 'security', produces: ['4B_SECURITY.md'], returnsTo: 'implement' }));
  addAgent(c, 'security', ['security']);
};

describe('a flow that is edited', () => {
  it('a stage added after the review is gone through by new runs; a run that was going keeps the flow it began with, until it is moved', async () => {
    const b = await boot({ issues: undefined });
    b.issues.add(issue(102));
    easy(b);
    const old = await b.runner.start('app#101');
    expect((await until(b, old, 'gate1')).stage).toBe('gate1');
    expect(old.flow?.stages.map((s) => s.id)).not.toContain('security');

    b.deps.updateConfig((c) => {
      security(c);
      return c;
    });
    const fresh = await b.runner.start('app#102');
    expect(fresh.flow?.stages.map((s) => s.id)).toContain('security');
    expect((await through(b, fresh)).status).toBe('done');
    expect(b.runner.get(fresh.id)!.stages.map((s) => s.stage)).toContain('security');

    // the old run goes through what it was started with
    expect((await through(b, old.id)).status).toBe('done');
    expect(b.runner.get(old.id)!.stages.map((s) => s.stage)).not.toContain('security');
  });

  it('moves a run to the current flow when its stage still exists there, and then goes through the new stage', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    let now = await until(b, run, 'gate2');
    expect(now).toMatchObject({ status: 'gate', stage: 'gate2' });
    b.deps.updateConfig((c) => {
      security(c);
      return c;
    });
    const before = now.flow?.hash;
    now = b.runner.migrateFlow(run.id);
    expect(now.flow?.hash).not.toBe(before);
    expect(now.flow?.stages.map((s) => s.id)).toContain('security');
    expect(b.thread(run).some((m) => m.code === 'run.flow.migrated')).toBe(true);
    now = await through(b, run);
    expect(now.status).toBe('done');
    expect(now.stages.map((s) => s.stage)).toContain('security');
  });

  it('refuses to move a run whose stage is gone from the current flow', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    await until(b, run, 'gate2');
    b.deps.updateConfig((c) => {
      c.devCycle.stages = c.devCycle.stages.filter((s) => s.id !== 'gate2');
      return c;
    });
    expect(() => b.runner.migrateFlow(run.id)).toThrow(expect.objectContaining({ code: 'unknown-stage' }));
    expect(b.runner.get(run.id)!.flow?.stages.map((s) => s.id)).toContain('gate2');
  });

  it('a flow without the second gate goes from plan straight to implement, for new runs', async () => {
    const b = await boot({ configure: (c) => void (c.devCycle.stages = c.devCycle.stages.filter((s) => s.id !== 'gate2')) });
    easy(b);
    const run = await b.runner.start('app#101');
    await through(b, run);
    expect(b.runner.get(run.id)!.stages.map((s) => s.stage)).toEqual(['refine', 'gate1', 'plan', 'implement', 'review', 'qa', 'ready']);
    expect(b.runner.get(run.id)!.status).toBe('done');
  });

  it('is refused at the start when the flow has a problem, and says which', async () => {
    const b = await boot();
    easy(b);
    const stored = structuredClone(b.deps.config());
    at(stored, 'review').returnsTo = 'ghost';
    const { writeConfigFile } = await import('../src/main/config-bootstrap');
    const { reloadConfig } = await import('../src/main/workspaceConfig');
    writeConfigFile(ATAS, stored);
    reloadConfig();
    await expect(b.runner.start('app#101')).rejects.toMatchObject({ code: 'invalid-flow' });
    await expect(b.runner.start('app#101')).rejects.toThrow(/ghost/);
    expect(b.runs.list()).toEqual([]);
  });
});

describe('stages that wait', () => {
  const withWait = (waitsFor: StageDef['waitsFor']) => (c: WorkspaceConfig) => {
    notReady(c);
    at(c, 'ready').waitsFor = waitsFor;
    c.devCycle.stages.push(stage('communicate', { agentId: 'writer', produces: ['6_NOTE.md'] }));
    addAgent(c, 'writer', ['communicate']);
  };

  async function reachWait(b: Boot): Promise<Run> {
    const run = await b.runner.start('app#101');
    const now = await through(b, run);
    await through(b, run);
    return b.runner.get(run.id) ?? now;
  }

  it('waits for the pull request to be merged, looking at the code host on each tick, and then goes on to the stage after it', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: withWait({ kind: 'pr-merged' }) });
    easy(b);
    const run = await reachWait(b);
    expect(run).toMatchObject({ status: 'waiting', stage: 'ready', wait: { kind: 'pr-merged' } });
    expect(await b.runner.tick()).toEqual([]);
    expect(b.runner.get(run.id)!.status).toBe('waiting');
    forge.pr!.merged = true;
    const sent = await b.runner.tick();
    await b.settle();
    expect(sent.map((r) => r.id)).toEqual([run.id]);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'done', wait: null });
    expect(b.runner.get(run.id)!.stages.map((s) => [s.stage, s.status]).slice(-2)).toEqual([['ready', 'done'], ['communicate', 'done']]);
    expect(b.thread(run).map((m) => m.code)).toEqual(expect.arrayContaining(['run.stage.wait.pr-merged', 'wait.done.pr-merged']));
  });

  it('a pull request closed without a merge is not a merge', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: withWait({ kind: 'pr-merged' }) });
    easy(b);
    const run = await reachWait(b);
    forge.pr = null;
    expect(await b.runner.tick()).toEqual([]);
    expect(b.runner.get(run.id)!.status).toBe('waiting');
  });

  it('never starts the pr-merged wait without a pull request recorded for the run: it fails closed instead', async () => {
    // no publisher: nothing can publish the pull request, so the wait may not even start
    const b = await boot({ configure: withWait({ kind: 'pr-merged' }) });
    easy(b);
    const run = await reachWait(b);
    expect(run).toMatchObject({ status: 'failed', stage: 'ready', wait: null });
    expect(run.error).toMatchObject({ code: 'pr-open-failed', stage: 'ready' });
    expect(b.thread(run).some((m) => m.code === 'run.stage.noPullRequest')).toBe(true);
  });

  it('waits for a label on the issue, whatever its case', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: withWait({ kind: 'label', label: 'shipped' }) });
    easy(b);
    const run = await reachWait(b);
    expect(run.status).toBe('waiting');
    forge.labels = ['bug'];
    expect(await b.runner.tick()).toEqual([]);
    forge.labels = ['bug', 'Shipped'];
    expect(await b.runner.tick()).toHaveLength(1);
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('done');
  });

  it('waits for a time, which the tick measures from when the stage was entered', async () => {
    const b = await boot({ configure: withWait({ kind: 'time', minutes: 5 }) });
    easy(b);
    const t0 = Date.parse('2026-10-03T10:00:00Z');
    b.deps.now = () => new Date(t0);
    const run = await reachWait(b);
    expect(run.wait).toMatchObject({ kind: 'time', minutes: 5, since: '2026-10-03T10:00:00.000Z' });
    b.deps.now = () => new Date(t0 + 4 * 60_000);
    expect(await b.runner.tick()).toEqual([]);
    b.deps.now = () => new Date(t0 + 5 * 60_000);
    expect(await b.runner.tick()).toHaveLength(1);
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('done');
  });

  it('a wait on a linked issue has nothing to wait for when the run asked for nothing: it goes on at the tick', async () => {
    const b = await boot({ configure: withWait({ kind: 'linked-done' }) });
    easy(b);
    const run = await reachWait(b);
    expect(run.status).toBe('waiting');
    expect((await b.runner.tick()).map((r) => r.id)).toEqual([run.id]);
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'done' });
  });

  it('holds a run that asked another squad for something until what it asked for is over, and the person can go on without it', async () => {
    const b = await boot({ configure: withWait({ kind: 'linked-done' }) });
    easy(b);
    const run = await reachWait(b);
    // the run asked for another run that is still going
    b.runs.update(run.id, (r) => ({ run: { ...r, links: [{ key: 'req-1', role: 'requested', kind: 'change', squad: 'b', run: 'r-gone-0000', issue: 'app#999', title: 'Something', status: 'open', at: r.updatedAt }] }, messages: [] }));
    expect(await b.runner.tick()).toEqual([]);
    expect(() => b.runner.skipWait(run.id, '')).toThrow(expect.objectContaining({ code: 'empty-reason' }));
    b.runner.skipWait(run.id, 'The other issue was closed by hand.');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'done' });
    expect(b.thread(run).find((m) => m.code === 'wait.skipped')).toMatchObject({ kind: 'decision', text: 'The other issue was closed by hand.' });
  });

  it('can be cancelled while it waits, and nothing is looked up for a run that is not waiting', async () => {
    const b = await boot({ configure: withWait({ kind: 'pr-merged' }) });
    easy(b);
    const run = await reachWait(b);
    b.runner.cancel(run.id);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'cancelled', wait: null });
    expect(await b.runner.tick()).toEqual([]);
  });
});

describe('an agent that asks the person who reported the issue', () => {
  const start = async (b: Boot): Promise<Run> => {
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    b.deps.now = () => new Date('2026-10-03T11:00:00Z');
    const run = await b.runner.start('app#101');
    await b.settle();
    return b.runner.get(run.id)!;
  };

  it('posts the question on the issue, waits for the reply of a person (not for what the app itself wrote), and goes on with the reply', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => void (c.language = 'en') });
    easy(b);
    b.engine.script('refiner', () => work('I need one more thing.', { reporterQuestion: 'Which browser do you use?' }), () => work('Spec, with the browser.', { artifacts: [doc('1_SPEC.md')] }));
    const run = await start(b);
    expect(run).toMatchObject({ status: 'waiting', stage: 'refine', wait: { kind: 'reporter-reply', by: 'refiner', since: '2026-10-03T11:00:00.000Z' } });
    // the question is on the issue, from the agent's autonomy
    expect(forge.bodies(101)).toHaveLength(1);
    expect(forge.bodies(101)[0][1]).toContain('Which browser do you use?');
    expect(b.thread(run).find((m) => m.kind === 'question')).toMatchObject({ to: 'reporter', public: true });
    // what the app wrote is not a reply, and neither is a note of the system
    expect(await b.runner.tick()).toEqual([]);
    forge.say(101, 'ana', 'Firefox, on a phone.', '2026-10-03T12:30:00Z');
    expect(await b.runner.tick()).toHaveLength(1);
    await b.settle();
    expect(b.engine.calls.map((c) => c.agent.id).slice(0, 2)).toEqual(['refiner', 'refiner']);
    expect(b.engine.calls[1].prompt).toContain('Firefox, on a phone.');
    const now = b.runner.get(run.id)!;
    expect(now).toMatchObject({ status: 'gate', stage: 'gate1', wait: null });
    expect(now.stages.find((s) => s.stage === 'refine')).toMatchObject({ status: 'done', attempts: 1 });
    expect(b.thread(run).find((m) => m.kind === 'answer')).toMatchObject({ text: 'Firefox, on a phone.', public: false });
  });

  it('is asked of the first stage only', async () => {
    const b = await boot();
    easy(b);
    await b.runner.start('app#101');
    await b.settle();
    const withField = (agent: string) => b.engine.calls.filter((c) => c.agent.id === agent).map((c) => 'reporterQuestion' in ((c.schema as { properties: object }).properties ?? {}));
    expect(withField('refiner')).toEqual([true]);
    b.runner.gate(b.runs.list()[0].id, 'approve');
    await b.settle();
    expect(withField('planner')).toEqual([false]);
  });

  it('the person can go on without a reply, with a reason', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => work('Hm.', { reporterQuestion: 'Which browser?' }), () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    const run = await start(b);
    expect(run.status).toBe('waiting');
    b.runner.skipWait(run.id, 'It does not matter.');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(b.engine.calls[1].prompt).toContain('It does not matter.');
  });
});

describe('the label a stage sets on the tracker', () => {
  const labelled = (c: WorkspaceConfig): void => {
    c.devCycle.stages = c.devCycle.stages.filter((s) => s.id !== 'gate1' && s.id !== 'gate2');
    at(c, 'plan').trackerStatus = 'coxia-planning';
    at(c, 'implement').trackerStatus = 'coxia-building';
  };

  it('is set when the run enters the stage and taken off when it leaves, by an agent that runs by itself, and audited', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: labelled });
    easy(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const labelsSeen: string[][] = [];
    b.engine.script('developer', async (_c, tools) => {
      labelsSeen.push([...forge.labels]);
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('done');
    // while the developer worked the issue had only the label of that stage
    expect(labelsSeen).toEqual([['coxia-building']]);
    expect(forge.labels).toEqual([]);
    const calls = forge.writes.filter((w) => /labels/.test(w.endpoint)).map((w) => `${w.method} ${w.endpoint.replace('repos/group/project/', '')}`);
    // entering the plan sets its label; going on to implement sets that stage's and takes the plan's off in the same step; leaving implement takes its label off
    expect(calls).toEqual(['POST issues/101/labels', 'POST issues/101/labels', 'DELETE issues/101/labels/coxia-planning', 'DELETE issues/101/labels/coxia-building']);
    expect(listAudit().filter((a) => /labels/.test(a.target)).map((a) => a.by)).toEqual(expect.arrayContaining(['planner', 'developer']));
  });

  it('waits for a "yes" when the stage entered is a gate, and says so', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => void (at(c, 'gate1').trackerStatus = 'needs-review') });
    easy(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)!.stage).toBe('gate1');
    expect(forge.labels).toEqual([]);
    const proposal = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'status');
    expect(proposal).toMatchObject({ state: 'pending', summary: expect.stringContaining('needs-review') });
    expect(b.thread(run).some((m) => m.code === 'runner.status.proposed')).toBe(true);
    await actions.approveAction(proposal!.id);
    expect(forge.labels).toEqual(['needs-review']);
  });
});
