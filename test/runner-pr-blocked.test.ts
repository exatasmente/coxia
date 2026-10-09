// A run whose pull request the code host refused to open. A fake host with a memory stands behind the real provider: the write that creates the pull
// request answers a validation failure, as a release branch that left the host does, and the tests check that the run stops blocked where the person
// can see it, that the pr-merged wait never starts without a pull request recorded, that a linked one is picked up before the wait, that the retry
// from the run screen resumes the normal flow, and that the review says it waits at most once per round. No network, no real host.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { gateApprove, stageDone } from '../src/shared/runs';
import type { Forge } from './helpers/fakeForge';
import { makeForge } from './helpers/fakeForge';
import { git } from './helpers/conflictRepos';
import { type Boot, boot, doc, makeRepo, work } from './helpers/runner';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlowConfig, drive, startInput } from './helpers/runs';

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { VcsError } = await import('../src/main/vcs/errors');
const { isRunBlocker } = await import('../src/shared/runs/view');
const { onRunnerActionDone } = await import('../src/main/runner/door');
const { flowOf } = await import('../src/shared/runs/flow');

vi.setConfig({ testTimeout: 30_000 });
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
});

const sectionOf = (heading: string, body: string) => ({ heading, body });
const commentOf = (sections: [string, string][]) => ({ sections: sections.map(([h, b]) => sectionOf(h, b)), technical: 'Touches `src/feature.ts`.' });
const PR = { title: 'Add the thing', ...commentOf([['What changes for the person using it', 'The thing does X.'], ['How to verify', 'Use it.']]) };
const reviewOk = () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: commentOf([['Beyond the lines of the code', 'None.']]) });
const CREATED_MR = 'POST repos/group/project/pulls';

/** A repository whose runs are cut from an open release branch, as the reported runs were. */
function releaseRepo() {
  const repo = makeRepo();
  git(repo.clone, 'fetch', '-q', 'origin');
  git(repo.clone, 'branch', 'release/0.8.0', 'origin/main');
  git(repo.clone, 'push', '-q', 'origin', 'release/0.8.0');
  return repo;
}

/** Wraps the fake host: the first write that creates a pull request is refused, with a validation failure and a 422, as a release branch that has left the host is; later ones go through, so the retry succeeds. `hit` says whether the refusal was reached. */
const failingOnce = { hit: false, fail: true };
function refusedPullRequest(forge: Forge): void {
  const base = forge.runtime();
  const run = async (command: Parameters<typeof base.exec.run>[0], meta?: Parameters<typeof base.exec.run>[1]): Promise<string> => {
    if (command.method === 'POST' && command.endpoint === CREATED_MR.replace(/^POST /, '')) {
      failingOnce.hit = true;
      if (!failingOnce.fail) return base.exec.run(command, meta);
      failingOnce.fail = false;
      throw new VcsError('invalid', { detail: 'Validation Failed (HTTP 422): pull request target branch not found' }, { status: 422 });
    }
    return base.exec.run(command, meta);
  };
  setVcsRuntimeForTests({ ...base, exec: { run } });
}

/** The run stops blocked when the stage publishing pipeline has caught the failure; a poll the page can also wait for, so the outcome is deterministic. */
async function until(b: Boot, what: (run: Run) => boolean): Promise<Run> {
  for (let i = 0; i < 200; i++) {
    const now = b.runs.list().find(what);
    if (now) return now;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the expected state never came');
}

const autonomy = (on: string[]) => (c: WorkspaceConfig): void => {
  c.language = 'en';
  const a = { ...c.runner.autonomy };
  a.cycle = true;
  a.gates = on.includes('gates');
  a.push = on.includes('push');
  a.pullRequest = on.includes('pullRequest');
  c.runner.autonomy = a;
};

/** Every agent does its stage at once (the engineering team); a test overrides the ones it is about. */
function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: PR, pr: PR });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }], comment: commentOf([['Verified scenarios and their result', 'The thing does X: passed.']]) }));
}

describe('a run whose pull request the host refused to open', () => {
  it('stops blocked with the host answer and the branch it aimed at, after the push went out', async () => {
    const forge = makeForge({ pr: null });
    failingOnce.hit = false;
    failingOnce.fail = true;
    refusedPullRequest(forge);
    const b = await boot({ dir: ATAS, publish: true, flow: 'engineering', repo: releaseRepo(), configure: autonomy(['gates', 'push', 'pullRequest']) });
    easy(b);
    // The reviewer's stage waits until the failure has stopped the run, so the question is the deterministic outcome; the stage answer lands afterwards and is held (the run is stopped).
    b.engine.script('reviewer', async () => {
      await until(b, (r) => r.status === 'question');
      return reviewOk();
    }, reviewOk);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const run = await b.runner.start('app#101');

    const now = await until(b, (r) => r.status === 'question');
    expect(now.question).toMatchObject({ by: 'app', kind: 'pr-retry', targetBranch: 'release/0.8.0', baseGone: true, stage: 'review' });
    expect(now.question!.bases).toEqual(['release/0.8.0', 'main']);
    expect(now.question!.text).toContain('Validation Failed');
    expect(now.question!.text).toContain('release/0.8.0');
    expect(isRunBlocker(now)).toBe(true);
    const thread = b.thread(now).find((m) => m.code === 'runner.pr.failed');
    expect(thread?.code).toBe('runner.pr.failed');
    expect((thread?.params as Record<string, string> | undefined)?.branch).toBe('release/0.8.0');
    expect((thread?.params as Record<string, string> | undefined)?.reason).toContain('Validation Failed');
    expect(failingOnce.hit).toBe(true);
  });

  it('retrying from the run screen opens it against the chosen base, and the run resumes its normal flow to the end', async () => {
    const forge = makeForge({ pr: null });
    failingOnce.hit = false;
    failingOnce.fail = true;
    refusedPullRequest(forge);
    const b = await boot({ dir: ATAS, publish: true, flow: 'engineering', repo: releaseRepo(), configure: (c) => {
      autonomy(['gates', 'push', 'pullRequest'])(c);
      const ready = c.devCycle.stages.find((s) => s.id === 'ready');
      if (ready) {
        ready.type = 'wait';
        ready.waitsFor = { kind: 'pr-merged' };
      }
    } });
    easy(b);
    b.engine.script('reviewer', async () => {
      await until(b, (r) => r.status === 'question');
      // the stage's own answer waits for the retry: when the question is gone the run is working again, and the answer lands as the normal flow would
      await until(b, (r) => r.question === null);
      return reviewOk();
    });
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const run = await b.runner.start('app#101');
    const stopped = await until(b, (r) => r.status === 'question');

    const retried = await b.runner.retryPr(stopped.id, 'main');
    expect(retried.status).toBe('working');
    expect(retried.question).toBeNull();
    expect(retried.baseBranch).toBe('main');
    const waiting = await until(b, (r) => r.status === 'waiting' && r.wait?.kind === 'pr-merged');
    forge.pr!.merged = true;
    await b.runner.tick();
    await b.settle();
    const after = b.runs.list()[0];
    expect(after).toMatchObject({ status: 'done', baseBranch: 'main' });
    const thread = b.thread(after).map((m) => m.code);
    expect(thread).toContain('runner.pr.created');
    expect(thread).toContain('runner.review.posted');
    // the failed pull request must have been recorded by now: what the retry opened aims at the chosen base
    expect(forge.pr!.base).toBe('main');
  });
});

describe('the pr-merged wait never starts without a pull request recorded', () => {
  const prMergedReady = (c: ReturnType<typeof agentFlowConfig>): void => {
    const ready = c.devCycle.stages.find((s) => s.id === 'ready');
    if (ready) {
      ready.type = 'wait';
      ready.waitsFor = { kind: 'pr-merged' };
    }
  };

  it('fails closed at the transition into the wait stage, with no event to wait for', () => {
    const c = agentFlowConfig();
    prMergedReady(c);
    const d = drive(flowOf(c));
    for (let i = 0; i < 40 && d.run.stage !== 'qa'; i++) {
      if (d.run.status === 'gate') d.do((r, at0) => gateApprove(r, d.flow, at0));
      else if (d.run.status === 'working') d.do((r, at0) => stageDone(r, d.flow, { summary: 'done', handoff: '', artifacts: [] }, at0));
      else break;
    }
    expect(d.run.stage).toBe('qa');
    d.do((r, at0) => stageDone(r, d.flow, { summary: 'qa done', handoff: '', artifacts: [] }, at0));
    expect(d.run).toMatchObject({ status: 'failed', stage: 'ready', wait: null, error: { code: 'pr-open-failed', stage: 'ready' } });
    expect(d.messages.at(-1)?.code).toBe('run.stage.noPullRequest');
  });

  it('a linked pull request is recorded by the runner before the last stage ends, and the wait starts on it', async () => {
    // no pull request anywhere when the run starts; the qa stage makes a linked one appear (the person opened it by hand)
    const forge = makeForge({ pr: null });
    forge.linked = false;
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'engineering', configure: (c) => {
      autonomy(['gates', 'push'])(c);
      const ready = c.devCycle.stages.find((s) => s.id === 'ready');
      if (ready) {
        ready.type = 'wait';
        ready.waitsFor = { kind: 'pr-merged' };
      }
    } });
    easy(b);
    b.engine.script('qa', () => {
      const run = b.runs.list()[0]!;
      // the person opened one by hand against the run's branch while the qa stage was working
      forge.pr = { number: 7, branch: run.branch, head: 'aaaa111122223333aaaa111122223333aaaa1111', base: run.baseBranch ?? 'main', files: [] };
      forge.linked = true;
      return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] });
    });
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const started = await b.runner.start('app#101');
    expect(started).toBeDefined();

    const merged: Run = await until(b, (r) => r.status === 'waiting' && r.wait?.kind === 'pr-merged');
    const known = merged.comments['pr'];
    expect(known).toMatchObject({ status: 'published', noteId: 7 });
    forge.pr!.merged = true;
    await b.runner.tick();
    await b.settle();
    expect(b.runs.list()[0]).toMatchObject({ status: 'done' });
  });
});

describe('the review waits aloud once, not once per sweep', () => {
  it('two sweeps over a draft review with no pull request add one waiting line, and no more when the pull request appears', async () => {
    const forge = makeForge({ pr: null });
    forge.linked = false;
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'engineering' });
    easy(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const run = await b.runner.start('app#101');
    // the gates are gone through by hand; at the review without a pull request the thread says once that it waits
    for (let i = 0; i < 40; i++) {
      const now = b.runner.get(run.id)!;
      if (b.thread(now).some((m) => m.code === 'runner.review.waiting') || now.status === 'failed') break;
      if (now.status === 'gate') b.runner.gate(run.id, 'approve');
      await b.settle();
    }
    expect(b.thread(run).filter((m) => m.code === 'runner.review.waiting')).toHaveLength(1);

    await b.runner.sweep();
    await b.runner.sweep();
    expect(b.thread(b.runs.list()[0]).filter((m) => m.code === 'runner.review.waiting')).toHaveLength(1);

    // the person opened one by hand: the review goes out, and no further waiting line is needed
    forge.pr = { number: 7, branch: run.branch, head: 'aaaa111122223333aaaa111122223333aaaa1111', base: run.baseBranch ?? 'main', files: [] };
    forge.linked = true;
    await b.runner.sweep();
    await b.runner.sweep();
    expect(b.thread(b.runs.list()[0]).some((m) => m.code === 'runner.review.posted')).toBe(true);
    expect(b.thread(b.runs.list()[0]).filter((m) => m.code === 'runner.review.waiting')).toHaveLength(1);
  });
});

describe('when the wait failed closed, it recovers once the pull request exists', () => {
  it('the sweep records the hand-opened pull request, and one retry starts the wait', async () => {
    const forge = makeForge({ pr: null });
    forge.linked = false;
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'engineering', configure: (c) => {
      autonomy(['gates', 'push'])(c);
      const ready = c.devCycle.stages.find((s) => s.id === 'ready');
      if (ready) {
        ready.type = 'wait';
        ready.waitsFor = { kind: 'pr-merged' };
      }
    } });
    easy(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const run = await b.runner.start('app#101');
    expect(run).toBeDefined();
    try {
      await new Promise((ok0, no0) => setTimeout(() => {
        const r0 = b.runs.list()[0];
        console.error('DBG', { status: r0.status, stage: r0.stage, error: r0.error, comments: Object.fromEntries(Object.entries(r0.comments).map(([k, v]) => [k, (v as { status: string; noteId: string | number | null }).status])), thread: b.thread(r0).map((m) => m.code ?? m.text) });
        no0(new Error('debug'));
      }, 3000));
    } catch (e) {
      // only the dump
    }
    // approve the gates until something else turns up (the qa stage carries the flow on): the run fails closed at the wait stage
    const stopped: Run = await until(b, (r) => r.status === 'failed' && r.error?.code === 'pr-open-failed');
    expect(stopped.wait).toBeNull();

    // the person opened one by hand; the running sweep records it, and the run recovers by one retry of the wait stage
    forge.pr = { number: 7, branch: stopped.branch, head: 'aaaa111122223333aaaa111122223333aaaa1111', base: stopped.baseBranch ?? 'main', files: [] };
    forge.linked = true;
    let recorded: Run | null = null;
    for (let i = 0; i < 8; i++) {
      recorded = b.runs.list().find((r) => r.comments['pr']?.status === 'published' && r.comments['pr']?.noteId !== null) ?? null;
      if (recorded) break;
      await b.runner.sweep();
    }
    expect(recorded && recorded.comments['pr']!.noteId).toBe(7);
    if (!recorded) throw new Error('the sweep never recorded the hand-opened pull request');

    const retried = await b.runner.retry(recorded.id);
    expect(retried).toMatchObject({ status: 'waiting', stage: 'ready', wait: { kind: 'pr-merged' } });
  });
});
