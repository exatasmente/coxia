// A run whose pull request the code host refused to open. A fake host with a memory stands behind the real provider: the write that creates the pull
// request answers a validation failure, as a release branch that left the host does, and the tests check that the run stops blocked where the person
// can see it, retries against a base chosen on the screen, and says it waits for the pull request at most once per round. No network, no real host.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { stageDone } from '../src/shared/runs';
import type { Forge } from './helpers/fakeForge';
import { makeForge } from './helpers/fakeForge';
import { git } from './helpers/conflictRepos';
import { type Boot, boot, doc, makeRepo, work } from './helpers/runner';

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { VcsError } = await import('../src/main/vcs/errors');
const { isRunBlocker } = await import('../src/shared/runs/view');
const { onRunnerActionDone } = await import('../src/main/runner/door');
const { flowOf } = await import('../src/shared/runs/flow');
const { applyTemplate } = await import('../src/shared/cycles');
const { agentFlow } = await import('../src/shared/cycles/templates/agentFlow');
const { neutralConfig } = await import('../src/shared/config');

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
const comment = (sections: [string, string][]) => ({ sections: sections.map(([h, b]) => sectionOf(h, b)), technical: 'Touches `src/feature.ts`.' });
const PR = { title: 'Add the thing', ...comment([['What changes for the person using it', 'The thing does X.'], ['How to verify', 'Use it.']]) };
const reviewOk = () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Beyond the lines of the code', 'None.']]) });
const CREATED_MR = 'POST repos/group/project/pulls';

/** Every agent does its stage at once (the business team); a test overrides the ones it is about. */
function script(b: Boot): void {
  b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
  b.engine.script('product-owner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }], comment: comment([['Verified scenarios and their result', 'The thing does X: passed.']]) }));
  b.engine.script('customer-success', () => work('Told.', { artifacts: [doc('6_RELEASE_NOTE.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Built.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: PR, pr: PR });
  });
  b.engine.script('tech-lead', () => work('Planned.', { artifacts: [doc('2_PLAN.md')] }), reviewOk);
}

/** A repository whose runs are cut from an open release branch, as the reported runs were. */
function releaseRepo() {
  const repo = makeRepo();
  git(repo.clone, 'fetch', '-q', 'origin');
  git(repo.clone, 'branch', 'release/0.8.0', 'origin/main');
  git(repo.clone, 'push', '-q', 'origin', 'release/0.8.0');
  return repo;
}

/** Wraps the fake host: only the first write that creates the pull request is refused, with a validation failure and a 422. */
function failingOnce(underForge: Forge, under: Forge['runtime'] extends never ? never: ReturnType<Forge['runtime']>): void {
  const base = under;
  const fail = { ok: false };
  const run = async (command: VcsCommand, meta?: { code?: number; response?: unknown }): Promise<string> => {
    if (command.method === 'POST' && command.endpoint === CREATED_MR) {
      if (fail.ok) return base.exec.run(command, meta);
      fail.ok = true;
      throw new VcsError('invalid', { host: 'example.test', reason: 'Validation Failed (HTTP 422): pull request target branch not found' }, { status: 422 });
    }
    return base.exec.run(command, meta);
  };
  setVcsRuntimeForTests({ ...under, exec: { run } });
}

/** The run stops blocked when the stage publishing pipeline has caught the failure; the reviewer's answer waits for it, so the outcome is deterministic. */
async function until(b: Boot, what: (run: Run) => boolean): Promise<Run> {
  for (let i = 0; i < 200; i++) {
    const now = b.runs.list().find(what);
    if (now) return now;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the expected state never came');
}

async function start(b: Boot): Promise<Run> {
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const run = await b.runner.start('app#101');
  await b.settle();
  return run;
}

const autonomy = (c: import('../src/shared/config/types').WorkspaceConfig, on: string[]): void => {
  c.language = 'en';
  const a = { ...c.runner.autonomy };
  a.cycle = true;
  a.gates = on.includes('gates');
  a.push = on.includes('push');
  a.pullRequest = on.includes('pullRequest');
  c.runner.autonomy = a;
};

describe('a run whose pull request the host refused to open', () => {
  it('stops blocked with the host answer and the branch it aimed at, after the push went out', async () => {
    const forge = makeForge({ pr: null });
    failingForge(forge, () => true);
    const b = await boot({ dir: ATAS, publish: true, flow: 'business', repo: releaseRepo(), configure: (c) => autonomy(c, ['gates', 'push', 'pullRequest']) });
    script(b);
    let run: Run | null = null;
    const opened = new Promise<void>((r) => (openTheGate = r));
    b.engine.script(
      'tech-lead',
      () => work('Planned.', { artifacts: [doc('2_PLAN.md')] }),
      async () => {
        // the reviewer's stage waits for the failure to have stopped the run, so the question is the deterministic outcome
        let ref = openTheGate; // set below
        await opened;
        return reviewOk();
      },
    );
    run = await start(b);
    openTheGate();

    const now = await until(b, (r) => r.status === 'question');
    expect(now.question).toMatchObject({ by: 'app', kind: 'pr-retry', targetBranch: 'release/0.8.0', baseGone: true, stage: 'review' });
    expect(now.question!.bases).toEqual(['release/0.8.0', 'main']);
    expect(now.question!.text).toContain('Validation Failed');
    expect(now.question!.text).toContain('release/0.8.0');
    expect(isRunBlocker(now)).toBe(true);
    expect(b.thread(now).some((m) => m.code === 'runner.pr.failed')).toBe(true);
    expect(forge.writes.some((w) => `${w.method} ${w.endpoint}` === CREATED_MR)).toBe(true);
  });

  it('retrying from the run screen opens it against the chosen base, and the run resumes its normal flow to the end', async () => {
    ...
  });
});
