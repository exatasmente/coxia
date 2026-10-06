// The ways a run can stop, wait and be redirected: refusals at the start, a stage that fails, times out or is cancelled, the person sending work
// back, agents that wait for the person, the review limit, a restart in the middle of a stage and the runs the app starts by itself.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyTemplate, kanban } from '../src/shared/cycles';
import { messageText } from '../src/shared/forum';
import { RunError, type Run } from '../src/shared/runs';
import { activityLog } from '../src/main/activity';
import { RunnerError } from '../src/main/runner/service';
import { git, withMachineIdentity } from './helpers/conflictRepos';
import { type Boot, boot, doc, fakeCommands, fakeEngine, fakeIssues, issue, makeRepo, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const finding = (body = 'Wrong.') => ({ path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body, suggestion: null });

/** Scripts every agent of the cycle to do its stage at once, so a test only overrides what it is about. */
function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
}

/** Runs the run until it is waiting at the stage `id` (approving gates on the way). */
async function reach(b: Boot, run: Run, id: string): Promise<Run> {
  for (let i = 0; i < 20; i++) {
    await b.settle();
    run = b.runner.get(run.id)!;
    if (run.stage === id && run.status !== 'working') return run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else break;
  }
  return run;
}

const never = (): Promise<never> => new Promise(() => undefined);

describe('starting a run', () => {
  it('is refused, touching nothing, when the cycle is not the agent cycle', async () => {
    const b = await boot();
    b.deps.updateConfig((c) => applyTemplate(c, kanban));
    await expect(b.runner.start('app#101')).rejects.toMatchObject({ code: 'not-agent-flow' });
    expect(b.issues.reads).toEqual([]);
    expect(git(b.repo.clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('is refused for a closed issue, a ref that is not one, an issue already being run and a flow with a stage that has no agent', async () => {
    const b = await boot();
    easy(b);
    b.issues.add(issue(7, { state: 'closed' }));
    await expect(b.runner.start('app#7')).rejects.toMatchObject({ code: 'issue-closed' });
    for (const bad of ['', 'abc', 'app#', 'app#0', 'other#5', '12x']) await expect(b.runner.start(bad), bad).rejects.toBeInstanceOf(RunnerError);
    const first = await b.runner.start('app#101');
    await expect(b.runner.start('101')).rejects.toMatchObject({ code: 'duplicate' });
    await b.settle();
    expect(b.runs.list()).toHaveLength(1);
    expect(first.issue.ref).toBe('app#101');

    const c = await boot();
    // a flow the app opened with a stage that lost its agent (saving one is refused, a stored one is kept as it was)
    const stored = structuredClone(c.deps.config());
    stored.agents.team = stored.agents.team.filter((a) => a.id !== 'developer');
    delete stored.devCycle.stages.find((s) => s.id === 'implement')!.agentId;
    const { writeConfigFile } = await import('../src/main/config-bootstrap');
    const { reloadConfig } = await import('../src/main/workspaceConfig');
    const { ATAS } = await import('../src/main/env');
    writeConfigFile(ATAS, stored);
    reloadConfig();
    await expect(c.runner.start('app#101')).rejects.toMatchObject({ code: 'no-agent' });
    await expect(c.runner.start('app#101')).rejects.toThrow(/Implement/);
    expect(existsSync(join(c.repo.worktrees))).toBe(false);
  });

  it('is refused when the repository has no identity and the runner has none, whatever the machine has, and uses the repository\'s own when it has one', async () => {
    const b = await boot();
    easy(b);
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, identity: { name: '', email: '' } } }));
    await withMachineIdentity(async () => {
      await expect(b.runner.start('app#101')).rejects.toMatchObject({ code: 'no-identity' });
      expect(existsSync(b.repo.worktrees)).toBe(false);
      expect(git(b.repo.clone, 'branch', '--list', 'cycle/*')).toBe('');
      // the repository's own configuration, written the way a person would have: the app never writes it
      appendFileSync(join(b.repo.clone, '.git', 'config'), '[user]\n\tname = Repo Owner\n\temail = owner@example.test\n');
      const run = await b.runner.start('app#101');
      await b.settle();
      expect(git(run.worktree, 'log', '-1', '--format=%an <%ae>')).toBe('Repo Owner <owner@example.test>');
      // every commit of the run, author and committer
      expect(new Set(git(run.worktree, 'log', '--format=%ae|%ce', `${run.base}..HEAD`).split('\n'))).toEqual(new Set(['owner@example.test|owner@example.test']));
    });
    expect(readFileSync(join(b.repo.clone, '.git', 'config'), 'utf8')).not.toContain('Runner Test');
  });

  it('refuses a branch that already exists and leaves it and the clone alone', async () => {
    const b = await boot();
    easy(b);
    git(b.repo.clone, 'branch', 'cycle/101-add-the-thing-101');
    await expect(b.runner.start('app#101')).rejects.toMatchObject({ code: 'branch-exists' });
    expect(git(b.repo.clone, 'branch', '--list', 'cycle/*')).toContain('cycle/101-add-the-thing-101');
    expect(existsSync(b.repo.worktrees)).toBe(false);
    expect(b.runs.list()).toEqual([]);
  });

  it('cuts the branch from the default branch of the remote, fetching it first', async () => {
    const b = await boot();
    easy(b);
    // somebody pushes to the remote after the clone was made
    const other = join(b.repo.root, 'other');
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['clone', '-q', b.repo.origin, other], { stdio: 'ignore' });
    git(other, 'checkout', '-q', 'main');
    appendFileSync(join(other, 'src/app.ts'), 'export const later = 2;\n');
    git(other, '-c', 'user.name=Other', '-c', 'user.email=other@example.test', 'commit', '-q', '-am', 'later');
    git(other, 'push', '-q', 'origin', 'main');
    const run = await b.runner.start('app#101');
    expect(run.base).toBe(git(b.repo.origin, 'rev-parse', 'main'));
    expect(readFileSync(join(run.worktree, 'src/app.ts'), 'utf8')).toContain('later');
    await b.settle();
  });
});

describe('a stage that goes wrong', () => {
  it('fails with the reason, tells the person, and goes on when it is tried again', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => {
      throw new Error('provider said no: Bearer abc.def.ghi');
    }, () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    let run = await b.runner.start('app#101');
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'failed', stage: 'refine', error: { code: 'stage-failed', stage: 'refine' } });
    expect(run.error?.detail).toContain('provider said no');
    expect(run.error?.detail).not.toContain('abc.def.ghi');
    expect(b.notices.at(-1)?.title).toContain('a etapa falhou');
    b.runner.retry(run.id);
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1', error: null });
    expect(b.runner.get(run.id)!.stages.find((s) => s.stage === 'refine')?.attempts).toBe(2);
  });

  it('fails when the agent ran past the limit, stopping it', async () => {
    const b = await boot({ timeoutMs: 40 });
    easy(b);
    let aborted = false;
    b.engine.script('refiner', (call) => {
      call.abort?.signal.addEventListener('abort', () => (aborted = true));
      return never();
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'failed', error: { code: 'stage-failed' } });
    expect(b.runner.get(run.id)!.error?.detail).toMatch(/1 min/);
    expect(b.runner.get(run.id)!.error?.detail).toMatch(/sem dar sinal/);
    expect(aborted).toBe(true);
  });

  it('gives an agent the turns the workspace allows: 30 to one that reads and 80 to one that writes, unless the config says otherwise', async () => {
    const b = await boot();
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const turns = Object.fromEntries(b.engine.calls.map((c) => [c.agent.id, c.maxTurns]));
    expect(turns).toEqual({ refiner: 30, planner: 30, developer: 80, reviewer: 30, qa: 30 });
    const c = await boot({ configure: (cfg) => (cfg.runner.turns = { read: 7, write: 11 }) });
    easy(c);
    const second = await c.runner.start('app#101');
    await reach(c, second, 'ready');
    expect(Object.fromEntries(c.engine.calls.map((x) => [x.agent.id, x.maxTurns]))).toEqual({ refiner: 7, planner: 7, developer: 11, reviewer: 7, qa: 7 });
  });

  it('records what each stage\'s model calls used, over its attempts, and keeps what a stage that failed had used', async () => {
    const b = await boot({ timeoutMs: 60 });
    easy(b);
    b.engine.script('refiner', (call) => {
      call.onUsage?.({ promptTokens: 700, completionTokens: 70, cachedTokens: 100, costUsd: 0.002 });
      return never();
    }, (call) => {
      call.onUsage?.({ promptTokens: 300, completionTokens: 30, cachedTokens: 0 });
      call.onUsage?.({ promptTokens: 200, completionTokens: 20, cachedTokens: 0, costUsd: 0.001 });
      return work('Spec.', { artifacts: [doc('1_SPEC.md')] });
    });
    let run = await b.runner.start('app#101');
    await b.settle();
    // the first attempt was stopped for silence, and its use is kept
    expect(b.runner.get(run.id)).toMatchObject({ status: 'failed' });
    expect(b.runner.get(run.id)!.stages[0].usage).toEqual({ promptTokens: 700, completionTokens: 70, cachedTokens: 100, calls: 1, costUsd: 0.002, costEstimated: false });
    b.runner.retry(run.id);
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run.stages[0]).toMatchObject({ attempts: 2, usage: { promptTokens: 1200, completionTokens: 120, cachedTokens: 100, calls: 3, costUsd: 0.003, costEstimated: false } });
    // a stage whose engine reported nothing has no usage
    expect(run.stages.find((s) => s.stage === 'gate1')?.usage).toBeUndefined();
  });

  it('keeps what a stage whose cost was only an estimate used, marked as an estimate over its attempts', async () => {
    const b = await boot({ timeoutMs: 60 });
    easy(b);
    b.engine.script('refiner', (call) => {
      call.onUsage?.({ promptTokens: 700, completionTokens: 70, cachedTokens: 100, costUsd: 0.002, costEstimated: true });
      return never();
    }, (call) => {
      call.onUsage?.({ promptTokens: 300, completionTokens: 30, cachedTokens: 0, costUsd: 0.001, costEstimated: true });
      return work('Spec.', { artifacts: [doc('1_SPEC.md')] });
    });
    let run = await b.runner.start('app#101');
    await b.settle();
    run = b.runner.get(run.id)!;
    // the stopped attempt alone leaves the stage estimated
    expect(run.stages[0].usage).toEqual({ promptTokens: 700, completionTokens: 70, cachedTokens: 100, calls: 1, costUsd: 0.002, costEstimated: true });
    b.runner.retry(run.id);
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run.stages[0].usage).toMatchObject({ promptTokens: 1000, completionTokens: 100, cachedTokens: 100, calls: 2, costUsd: 0.003, costEstimated: true });
  });

  it('runs the workspace\'s commands in the worktree before QA and gives QA the results, and keeps the exit codes', async () => {
    const commands = fakeCommands({ 'npm test': { exitCode: 1, output: 'FAIL slug accents' } });
    const b = await boot({ commandRunner: commands, configure: (c) => (c.runner.commands = ['npm test', 'npm run typecheck']) });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    // only QA is given them, once per pass, in the run's worktree, after the developer and the review
    expect(commands.ran).toEqual([{ cwd: run.worktree, command: 'npm test' }, { cwd: run.worktree, command: 'npm run typecheck' }]);
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.prompt).toContain('$ npm test  (saiu com 1)\nFAIL slug accents');
    expect(qa.prompt).toContain('$ npm run typecheck  (saiu com 0)\nok');
    expect(qa.prompt).toContain('você não roda nada');
    expect(b.engine.calls.filter((c) => c.agent.id !== 'qa').every((c) => !c.prompt.includes('npm run typecheck  (saiu'))).toBe(true);
    // QA stays a reader
    expect(qa.confine).toBeUndefined();
    expect(qa.agent.permission).toBe('read');
    expect(run.qa[0].commands).toEqual([{ command: 'npm test', exitCode: 1, timedOut: false }, { command: 'npm run typecheck', exitCode: 0, timedOut: false }]);
    expect(JSON.stringify(run.qa[0])).not.toContain('FAIL slug accents');
    expect(b.thread(run).find((m) => m.code === 'runner.qa.commands')?.params).toEqual({ list: 'npm test (1), npm run typecheck (0)' });
  });

  it('says a command the environment could not start is not a result of the code: recorded as not run, told in the thread, and QA is told not to pass what depends on it', async () => {
    const commands = fakeCommands({ 'npm test': { exitCode: 127, output: 'sh: 1: vitest: not found', notRun: 'exit' }, 'npm run typecheck': { exitCode: null, output: '', notRun: 'enoent' } });
    const b = await boot({ commandRunner: commands, configure: (c) => (c.runner.commands = ['npm test', 'npm run typecheck', 'npm run lint']) });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.prompt).toContain('$ npm test  (não pôde rodar');
    expect(qa.prompt).toContain('$ npm run typecheck  (não pôde rodar');
    expect(qa.prompt).toContain('$ npm run lint  (saiu com 0)');
    expect(qa.prompt).toContain('não marque como pass nenhum cenário que dependa deles');
    // a pass in which every command ran has no such warning
    expect(run.qa[0].commands).toEqual([
      { command: 'npm test', exitCode: 127, timedOut: false, notRun: true },
      { command: 'npm run typecheck', exitCode: null, timedOut: false, notRun: true },
      { command: 'npm run lint', exitCode: 0, timedOut: false },
    ]);
    const told = b.thread(run).find((m) => m.code === 'runner.qa.notRun');
    expect(told?.params?.list).toContain('npm test: ele disse: sh: 1: vitest: not found');
    expect(told?.params?.list).toContain('npm run typecheck: npm não foi encontrado pelo app');
    expect(told?.params?.list).not.toContain('npm run lint');
    const clean = await boot({ commandRunner: fakeCommands() });
    easy(clean);
    const ok = await reach(clean, await clean.runner.start('app#101'), 'ready');
    expect(clean.engine.calls.find((c) => c.agent.id === 'qa')!.prompt).not.toContain('não pôde rodar');
    expect(clean.thread(ok).some((m) => m.code === 'runner.qa.notRun')).toBe(false);
  });

  it('falls back to the scripts the repository declares, and tells QA when the workspace lists none', async () => {
    const declared = fakeCommands();
    const b = await boot({ commandRunner: declared });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(declared.ran.map((r) => r.command)).toEqual(['npm test', 'npm run typecheck']);
    const none = fakeCommands();
    const c = await boot({ commandRunner: none, configure: (cfg) => (cfg.runner.commands = []) });
    easy(c);
    const second = await c.runner.start('app#101');
    await reach(c, second, 'ready');
    expect(none.ran).toEqual([]);
    expect(c.engine.calls.find((x) => x.agent.id === 'qa')!.prompt).toContain('não rodou nenhum comando');
    expect(c.runner.get(second.id)!.qa[0].commands).toEqual([]);
    expect(c.thread(second).some((m) => m.code === 'runner.qa.commands')).toBe(false);
  });

  it('tells every agent to state only what its stage verified, and gives the comment sections guidance that says the same', async () => {
    const b = await boot({ configure: (c) => (c.language = 'en') });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    for (const call of b.engine.calls) expect(call.system, call.agent.id).toContain('Say only what you verified in this stage');
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.prompt).toContain('what this stage verified (read, exercised or saw working)');
    expect(qa.prompt).toContain('A scenario that was only read in the code says it was only read');
    expect(qa.prompt).toContain('Do not leave it empty when nothing was exercised');
    const dev = b.engine.calls.find((c) => c.agent.id === 'developer')!;
    expect(dev.prompt).toContain('Say what this pass ran or saw working, and what it did not run');
  });

  it('tells an agent to look around with Read, Glob and Grep instead of ls, find and pwd', async () => {
    const b = await boot({ configure: (c) => (c.language = 'en') });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const dev = b.engine.calls.find((c) => c.agent.id === 'developer')!;
    expect(dev.system).toContain('To look around use the Read, Glob and Grep tools, not ls, find or pwd: those commands are not on the list');
    expect(b.engine.calls.find((c) => c.agent.id === 'refiner')!.system).toContain('To look around use the Read, Glob and Grep tools, not ls, find or pwd.');
  });

  it('writes the documents of a stage without the head of the issue record, and asks the agent not to repeat it', async () => {
    const b = await boot({ configure: (c) => (c.language = 'en') });
    easy(b);
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md', '# Functional specification — app#101 Add the thing 101\n\n- Address: https://example.com/group/project/issues/101\n- Author: ana\n\n## What is asked\n\nX.\n')], handoff: 'Plan it.' }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'gate1');
    expect(readFileSync(join(run.worktree, run.cycleFolder, '1_SPEC.md'), 'utf8')).toBe('# Functional specification\n\n## What is asked\n\nX.\n');
    expect(b.engine.calls[0].prompt).toContain('opens with a title of its own');
    expect(b.engine.calls[0].prompt).toContain('with no internal reference');
  });

  it('stops at a question for the person when an agent marks a decision as theirs and writes no question, instead of taking the stage for done', async () => {
    const b = await boot({ configure: (c) => (c.language = 'en') });
    easy(b);
    b.engine.script('refiner', () => work('The scope is unclear: it could mean A or B.', { artifacts: [doc('1_SPEC.md')], question: null, needsPerson: true }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const now = b.runner.get(run.id)!;
    expect(now).toMatchObject({ status: 'question', stage: 'refine', question: { by: 'refiner', holder: null, kind: 'agent' } });
    expect(now.question!.text).toContain('did not write the question');
    expect(now.question!.text).toContain('The scope is unclear: it could mean A or B.');
    // the person answers, and the same stage goes on with the answer
    b.runner.answer(run.id, 'A.');
    expect(b.runner.get(run.id)).toMatchObject({ status: 'working', stage: 'refine' });
  });

  it('does not stop an agent that keeps showing signs of life, however long it works, until the cap', async () => {
    const b = await boot({ limits: { idleMs: 90, maxMs: 5_000 } });
    easy(b);
    b.engine.script('refiner', async (call) => {
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 40));
        call.beat?.();
      }
      return work('Spec.', { artifacts: [doc('1_SPEC.md')] });
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    // 320 ms in all, more than three times the idle limit, and no failure
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
  });

  it('fails an agent that goes silent for the idle limit, even long before the cap, and stops it', async () => {
    const b = await boot({ limits: { idleMs: 80, maxMs: 60_000 } });
    easy(b);
    let aborted = false;
    b.engine.script('refiner', async (call) => {
      call.abort?.signal.addEventListener('abort', () => (aborted = true));
      call.beat?.();
      return never();
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'failed', error: { code: 'stage-failed' } });
    expect(b.runner.get(run.id)!.error?.detail).toMatch(/sem dar sinal/);
    expect(aborted).toBe(true);
  });

  it('fails an agent that never finishes with the wall-clock cap, though it keeps talking', async () => {
    const b = await boot({ limits: { idleMs: 5_000, maxMs: 150 } });
    easy(b);
    b.engine.script('refiner', async (call) => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 20));
        if (call.abort?.signal.aborted) return never();
        call.beat?.();
      }
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'failed' });
    expect(b.runner.get(run.id)!.error?.detail).toMatch(/no total/);
  });

  it('fails, without taking a half answer for a finished stage, when the documents are missing, the answer is empty or the turns ran out', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => work('No document.'), () => ({ summary: '', question: null }), async () => {
      const { MaxTurnsError } = await import('../src/main/engine/contract');
      throw new MaxTurnsError('s', []);
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)!.error?.detail).toContain('1_SPEC.md');
    b.runner.retry(run.id);
    await b.settle();
    expect(b.runner.get(run.id)!.error?.detail).toMatch(/sem dizer o que fez/);
    b.runner.retry(run.id);
    await b.settle();
    expect(b.runner.get(run.id)!.error?.detail).toMatch(/passos/);
    expect(git(run.worktree, 'log', '--format=%s', 'main..HEAD')).toBe('feat: add the issue record #101');
  });

  it('ignores a document the stage does not produce and says so in the thread', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('9_EXTRA.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(existsSync(join(run.worktree, run.cycleFolder, '9_EXTRA.md'))).toBe(false);
    expect(b.thread(run).find((m) => m.code === 'runner.artifactIgnored')?.params).toMatchObject({ agent: 'refiner', name: '9_EXTRA.md' });
  });
});

describe('cancelling', () => {
  it('stops the agent, keeps the run as cancelled, and deletes nothing', async () => {
    const b = await boot();
    easy(b);
    let aborted = false;
    b.engine.script('refiner', (call) => {
      call.abort?.signal.addEventListener('abort', () => (aborted = true));
      return never();
    });
    let run = await b.runner.start('app#101');
    await vi.waitFor(() => expect(b.engine.calls).toHaveLength(1));
    run = b.runner.cancel(run.id);
    expect(run.status).toBe('cancelled');
    expect(aborted).toBe(true);
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'cancelled', rev: run.rev });
    expect(existsSync(run.worktree)).toBe(true);
    expect(git(b.repo.clone, 'branch', '--list', run.branch)).toContain(run.branch);
    expect(b.thread(run).some((m) => m.code === 'run.cancelled')).toBe(true);
    expect(() => b.runner.cancel(run.id)).toThrow(RunError);
  });
});

describe('the person sends work back', () => {
  it('rejecting a gate sends the run to the stage that produced it, with the reason as what that agent reads', async () => {
    const b = await boot();
    easy(b);
    let run = await b.runner.start('app#101');
    await b.settle();
    b.runner.gate(run.id, 'reject', 'The spec leaves out the Y case.');
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(b.engine.calls[1].prompt).toContain('The spec leaves out the Y case.');
    expect(b.engine.calls[1].prompt).toMatch(/tentativa 2/);
    expect(run.stages.find((s) => s.stage === 'refine')?.attempts).toBe(2);
    expect(() => b.runner.gate(run.id, 'reject', '')).toThrow(RunError);
    expect(() => b.runner.gate(run.id, 'bogus' as never)).toThrow(RunnerError);
  });

  it('skipping a gate with a reason goes on to the next stage and records it', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.runner.gate(run.id, 'skip', 'Trivial change.');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate2' });
    expect(b.thread(run).find((m) => m.code === 'gate.skipped')).toMatchObject({ kind: 'decision', text: 'Trivial change.' });
  });
});

describe('agents that wait for the person', () => {
  it('start only when told to, hand their result over only when it is accepted, and redo it when sent back with a note', async () => {
    const b = await boot();
    easy(b);
    b.runner.setAutonomous('refiner', false);
    let run = await b.runner.start('app#101');
    // the person who starts a run starts its first stage too
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'to-accept', stage: 'refine' });
    expect(b.engine.calls).toHaveLength(1);
    expect(b.thread(run).some((m) => m.kind === 'handoff')).toBe(false);
    b.runner.returnStage(run.id, 'Add the Z case.');
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'to-accept', stage: 'refine' });
    expect(b.engine.calls[1].prompt).toContain('Add the Z case.');
    expect(() => b.runner.returnStage(run.id, ' ')).toThrow(RunError);
    b.runner.accept(run.id, 'good');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(b.thread(run).filter((m) => m.kind === 'handoff').map((m) => m.to)).toEqual(['refiner', 'person']);
  });

  it('wait to start in the middle of a run, with nothing run and the person told', async () => {
    const b = await boot();
    easy(b);
    b.runner.setAutonomous('planner', false);
    let run = await b.runner.start('app#101');
    await b.settle();
    b.runner.gate(run.id, 'approve');
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'to-start', stage: 'plan' });
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['refiner']);
    expect(b.notices.at(-1)?.title).toContain('esperando para começar');
    // switching the agent back on does not touch a stage that has not started: it applies to the next one
    b.runner.setAutonomous('planner', true);
    expect(b.runner.get(run.id)!.status).toBe('to-start');
    b.runner.startStage(run.id);
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate2' });
  });

  it('can be switched only for an agent of the team', async () => {
    const b = await boot();
    expect(() => b.runner.setAutonomous('ghost', true)).toThrow(RunnerError);
    expect(b.runner.setAutonomous('qa', false).agents.team.find((a) => a.id === 'qa')?.autonomous).toBe(false);
  });
});

describe('the review limit and QA', () => {
  it('stops after two review passes with findings and asks the person; the answer goes to the developer with a fresh budget', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('reviewer', () => work('Still wrong.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', findings: [finding('Still wrong.')] }), () => work('Still wrong.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', findings: [finding('Still wrong.')] }), () => work('Fine now.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved' }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'review');
    expect(run).toMatchObject({ status: 'question', stage: 'review', returns: { review: 2 } });
    expect(run.question).toMatchObject({ by: 'app', kind: 'review-limit' });
    // a readable account of the rounds, not the reviewer's text: what was asked, what the developer did, what is still open
    const text = run.question!.text;
    expect(text).toContain('devolveu o trabalho 2 vezes');
    expect(text).toMatch(/O que se pediu para mudar na última rodada:\n- src\/feature\.ts:1 — Still wrong\./);
    expect(text).toMatch(/O que o desenvolvimento fez:\nDone\./);
    expect(text).toMatch(/O que continua em aberto:\n- src\/feature\.ts:1 — Still wrong\./);
    expect(text).not.toContain('[bloqueia]');
    expect(b.thread(run).find((m) => m.code === 'review.limit')?.text).toBe(text);
    expect(b.engine.calls.map((c) => c.agent.id).filter((a) => a === 'developer')).toHaveLength(2);
    b.runner.answerPost(`run-${run.id}`, 'Accept it as it is, the finding is a style choice.');
    run = await reach(b, b.runner.get(run.id)!, 'ready');
    expect(run).toMatchObject({ status: 'done', returns: { review: 0 } });
    expect(run.reviews).toHaveLength(3);
  });

  it('sends the work back to the developer when a QA scenario fails', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('qa', () => work('One broke.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'fail', detail: 'a 500 on login' }] }), () => work('Passes now.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'pass', detail: '' }] }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['refiner', 'planner', 'developer', 'reviewer', 'qa', 'developer', 'reviewer', 'qa']);
    expect(b.engine.calls[5].prompt).toContain('login');
    expect(b.engine.calls[5].prompt).toContain('a 500 on login');
    expect(run.qa.map((q) => q.scenarios[0].result)).toEqual(['fail', 'pass']);
    expect(run.returns).toEqual({ qa: 1 });
  });

  it('gives the review of round two what the earlier round found and says not to promote a suggestion without a new fact', async () => {
    const b = await boot({ configure: (c) => (c.language = 'en') });
    easy(b);
    const suggestion = { ...finding('Consider a clearer name.'), severity: 'suggestion' };
    b.engine.script('reviewer', () => work('One thing.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', findings: [finding('The constant must be 2.'), suggestion] }), () => work('Fine now.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved' }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const reviews = b.engine.calls.filter((c) => c.agent.id === 'reviewer');
    expect(reviews[0].prompt).not.toContain('The review passes before this one');
    expect(reviews[0].prompt).not.toContain('This is round');
    expect(reviews[1].prompt).toContain('The review passes before this one');
    expect(reviews[1].prompt).toContain('Round 1, verdict changes. One thing.');
    expect(reviews[1].prompt).toContain('[blocks] src/feature.ts:1: The constant must be 2.');
    expect(reviews[1].prompt).toContain('[suggestion] src/feature.ts:1: Consider a clearer name.');
    expect(reviews[1].prompt).toContain('This is round 2 of the review');
    expect(reviews[1].prompt).toContain('does not become blocking because you look again');
  });

  it('says so when a developer pass changes no code, and the commit does not claim the fix', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('developer', async () => work('Fixed the constant.', { commit: 'fix the constant', artifacts: [doc('3_IMPLEMENTATION.md')] }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const noted = b.thread(run).filter((m) => m.code === 'runner.noCodeChange');
    expect(noted).toHaveLength(1);
    expect(noted[0]).toMatchObject({ stage: 'implement', params: { agent: 'developer' } });
    expect(messageText(noted[0])).toContain('sem mudar nenhum código');
    const subjects = git(run.worktree, 'log', '--format=%s').split('\n');
    expect(subjects).toContain('feat: add the implement documents #101');
    expect(subjects.join('\n')).not.toContain('fix the constant');
  });

  it('commits code with an English subject without a type or an issue reference, and documents with the stage fallback', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('developer', async (_c, tools) => {
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'fix(slug): add accent folding (app#101) #101', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    // the readers describe what they read, in Portuguese or not: their commits hold documents, so the agent's text is not used
    b.engine.script('reviewer', () => work('Fine.', { commit: 'aprova a revisão do código', artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    b.engine.script('refiner', () => work('Spec.', { commit: 'feat: write the spec', artifacts: [doc('1_SPEC.md')] }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const subjects = git(run.worktree, 'log', '--format=%s').split('\n');
    expect(subjects).toContain('feat: add accent folding #101');
    expect(subjects).toContain('feat: add the review documents #101');
    expect(subjects).toContain('feat: add the refine documents #101');
    expect(subjects.filter((x) => /app#|aprova|write the spec/.test(x))).toEqual([]);
  });

  it('does not say so for a pass that changes code, nor for an agent that only reads', async () => {
    const b = await boot();
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(b.thread(run).filter((m) => m.code === 'runner.noCodeChange')).toEqual([]);
    expect(git(run.worktree, 'log', '--format=%s').split('\n')).toContain('feat: add the feature #101');
  });

  it('asks the person at the limit of QA with its own account: the scenarios that failed, not the agent text', async () => {
    const b = await boot();
    easy(b);
    const fails = () => work('Broke again.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'fail', detail: 'a 500 on login' }] });
    b.engine.script('qa', fails, fails);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'qa');
    expect(run).toMatchObject({ status: 'question', stage: 'qa', returns: { qa: 2 } });
    expect(run.question!.text).toMatch(/O que continua em aberto:\n- login — a 500 on login/);
    expect(run.question!.text).not.toContain('Cenário que falhou');
  });

  it('does not send the work back for a QA failure that does not block: it is reported in the thread and the run goes on', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('qa', () => work('Passes, with a remark.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'pass', detail: '' }, { name: 'punctuation between letters', result: 'fail', severity: 'non-blocking', detail: 'the spec does not cover it' }] }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['refiner', 'planner', 'developer', 'reviewer', 'qa']);
    expect(run.returns).toEqual({});
    expect(run.qa[0].scenarios[1].severity).toBe('non-blocking');
    const post = b.thread(run).find((m) => m.kind === 'post' && m.stage === 'qa');
    expect(post?.text).toContain('Passes, with a remark.');
    expect(post?.text).toContain('punctuation between letters');
  });

  it('records the findings of an approving review that only suggests, and goes on', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('reviewer', () => work('Good, with a thought.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [{ ...finding('Could be named better.'), severity: 'suggestion' }] }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.reviews[0]).toMatchObject({ verdict: 'approved', findings: [{ severity: 'suggestion' }] });
    // what the reviewer looked at: the branch before the commit of its own review document
    const reviewCommit = git(run.worktree, 'log', '--format=%H', '--grep=add the review documents', '-1');
    expect(run.reviews[0].head).toBe(git(run.worktree, 'rev-parse', `${reviewCommit}~1`));
    expect(b.thread(run).find((m) => m.kind === 'post' && m.text.includes('Could be named better.'))).toBeDefined();
  });
});

describe('after the app is reopened', () => {
  it('starts over the stage that was in the middle of an agent, leaves the others where they were, and finishes', async () => {
    const first = await boot();
    first.engine.script('refiner', () => never());
    let run = await first.runner.start('app#101');
    await vi.waitFor(() => expect(first.engine.calls).toHaveLength(1));
    expect(first.runner.get(run.id)!.status).toBe('working');

    // a second process on the same folders: a new runner, a new engine that answers
    const engine = fakeEngine();
    engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
    const second = await boot({ repo: first.repo, dir: first.dir, engine, issues: first.issues });
    second.runner.resume();
    await second.settle();
    run = second.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(run.stages.find((s) => s.stage === 'refine')).toMatchObject({ attempts: 2, status: 'done' });
    expect(second.thread(run).some((m) => m.code === 'run.stage.restarted')).toBe(true);
    expect(run.history.map((h) => h.type)).toContain('interrupted');

    // a run waiting at a gate is not touched by another reopening
    const third = await boot({ repo: first.repo, dir: first.dir, engine: fakeEngine(), issues: first.issues });
    const rev = run.rev;
    third.runner.resume();
    await third.settle();
    expect(third.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1', rev });
  });

  it('goes on with a stage that was answered while the app was closed', async () => {
    const first = await boot();
    first.engine.script('refiner', () => work('Needs a decision.', { question: 'Which one?' }));
    let run = await first.runner.start('app#101');
    await first.settle();
    expect(first.runner.get(run.id)!.status).toBe('question');
    const engine = fakeEngine();
    engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    const second = await boot({ repo: first.repo, dir: first.dir, engine, issues: first.issues });
    second.runner.resume();
    second.runner.answer(run.id, 'The first.');
    await second.settle();
    run = second.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(engine.calls[0].prompt).toContain('Which one?');
    expect(engine.calls[0].prompt).toContain('The first.');
  });
});

describe('runs the app starts by itself', () => {
  const triggered = (n: number[]) => {
    const issues = fakeIssues();
    for (const iid of n) issues.add(issue(iid, { labels: ['bug', 'Coxia'] }));
    issues.add(issue(900, { labels: ['bug'] }));
    issues.add(issue(901, { labels: ['coxia'], state: 'closed' }));
    return issues;
  };

  it('does nothing while the runner is off, or for a workspace that does not use the agent cycle', async () => {
    const b = await boot({ issues: triggered([1, 2]) });
    easy(b);
    expect(await b.runner.scan()).toEqual([]);
    b.deps.updateConfig((c) => ({ ...applyTemplate(c, kanban), runner: { ...c.runner, enabled: true } }));
    expect(await b.runner.scan()).toEqual([]);
    expect(b.issues.reads).toEqual([]);
  });

  it('starts runs for the issues that carry the label, up to the number allowed at a time, oldest first', async () => {
    const b = await boot({ issues: triggered([3, 1, 2]) });
    easy(b);
    b.engine.script('refiner', () => never());
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true, maxConcurrentRuns: 2 } }));
    const started = await b.runner.scan();
    expect(started.map((r) => r.issue.ref)).toEqual(['app#1', 'app#2']);
    // both are working: nothing more is started, and an issue without the label or closed never is
    expect(await b.runner.scan()).toEqual([]);
    expect(b.runs.list().map((r) => r.issue.ref).sort()).toEqual(['app#1', 'app#2']);
  });

  it('starts the next one when a run stops working, and never again an issue that already had a run', async () => {
    const b = await boot({ issues: triggered([1, 2]) });
    easy(b);
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true, maxConcurrentRuns: 1 } }));
    const one = await b.runner.scan();
    expect(one.map((r) => r.issue.ref)).toEqual(['app#1']);
    await b.settle();
    // app#1 waits at a gate: it is no longer working, so there is room
    const two = await b.runner.scan();
    expect(two.map((r) => r.issue.ref)).toEqual(['app#2']);
    b.runner.cancel(one[0].id);
    await b.settle();
    expect(await b.runner.scan()).toEqual([]);
    expect(b.runs.list()).toHaveLength(2);
  });

  it('tries an issue it cannot start once, not at every pass', async () => {
    const b = await boot({ issues: triggered([5]) });
    easy(b);
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true, identity: { name: '', email: '' } } }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await b.runner.scan()).toEqual([]);
    expect(b.issues.reads).toEqual([5]);
    expect(await b.runner.scan()).toEqual([]);
    expect(b.issues.reads).toEqual([5]);
  });
});

describe('the thread', () => {
  it('has an agent answer a mention, read only, whatever its own permission, and only a person\'s', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('developer', (call) => (call.confine ? work('done', { artifacts: [doc('3_IMPLEMENTATION.md')] }) : { text: 'The scope is the Y case only.' }));
    b.engine.script('refiner', (call) => (call.prompt.includes('mention-text') ? { text: 'The scope is the X case.' } : work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' })), (call) => ({ text: `Answer to: ${call.prompt.includes('What is the scope?')}` }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const thread = `run-${run.id}`;
    const [posted] = b.forum.append(thread, { kind: 'post', author: { type: 'person' }, text: '@refiner What is the scope?', mentions: ['refiner'] });
    b.runner.onMessage(posted);
    // an agent's own message, even naming another agent, never calls anyone
    const [fromAgent] = b.forum.append(thread, { kind: 'post', author: { type: 'agent', id: 'planner' }, text: '@developer please', mentions: ['developer'] });
    b.runner.onMessage(fromAgent);
    await b.settle();
    const answer = b.thread(run).find((m) => m.kind === 'post' && m.author.type === 'agent' && m.text.startsWith('Answer to'));
    expect(answer).toMatchObject({ author: { type: 'agent', id: 'refiner' }, text: 'Answer to: true', public: false });
    expect(b.engine.calls.filter((c) => c.agent.id === 'developer')).toHaveLength(0);

    // the developer writes, but when a person names it it only reads
    const [d] = b.forum.append(thread, { kind: 'post', author: { type: 'person' }, text: '@developer why that file?', mentions: ['developer'] });
    b.runner.onMessage(d);
    await b.settle();
    const call = b.engine.calls.find((c) => c.agent.id === 'developer');
    expect(call?.confine).toBeUndefined();
    expect(call?.agent.permission).toBe('read');
    expect(b.thread(run).some((m) => m.text === 'The scope is the Y case only.')).toBe(true);
  });

  it('says in the thread when the agent could not answer', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.engine.script('qa', () => {
      throw new Error('model unavailable');
    });
    const [m] = b.forum.append(`run-${run.id}`, { kind: 'post', author: { type: 'person' }, text: '@qa ready?', mentions: ['qa'] });
    b.runner.onMessage(m);
    await b.settle();
    expect(b.thread(run).find((x) => x.code === 'runner.mentionFailed')?.params).toMatchObject({ agent: 'qa', reason: 'model unavailable' });
  });

  it('opens a line for every agent named, and says the one that waits its turn', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.engine.script('refiner', () => ({ text: 'The scope is the X case.' }));
    b.engine.script('qa', () => ({ text: 'Looks fine.' }));
    const before = b.engine.calls.length;
    const thread = `run-${run.id}`;
    const [first] = b.forum.append(thread, { kind: 'post', author: { type: 'person' }, text: '@refiner what is the scope?', mentions: ['refiner'] });
    b.runner.onMessage(first);
    const [second] = b.forum.append(thread, { kind: 'post', author: { type: 'person' }, text: '@qa and you?', mentions: ['qa'] });
    b.runner.onMessage(second);
    // Both lines exist before the engine got to run: the second names the agent and says it waits.
    const lines = activityLog.get(`run:${run.id}`).filter((e) => e.call);
    expect(lines.map((e) => [e.call?.agent, e.call?.message, e.call?.thread, e.state])).toEqual([
      ['refiner', first.seq, thread, 'started'],
      ['qa', second.seq, thread, 'queued'],
    ]);
    await b.settle();
    // The engine ran each call under the very activity the line belongs to, one after the other.
    expect(b.engine.calls.slice(before).map((c) => [c.agent.id, c.activity?.id])).toEqual([
      ['refiner', lines[0].runId],
      ['qa', lines[1].runId],
    ]);
    expect(b.thread(run).some((m) => m.author.type === 'agent' && m.text === 'Looks fine.')).toBe(true);
  });

  it('takes a post that answers the question of the run as the answer, but not one that names an agent, nor one when nothing is asked', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => work('Hm.', { question: 'Which one?' }), () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const thread = `run-${run.id}`;
    expect(b.runner.answerPost(thread, '@planner what do you think?')).toBeNull();
    expect(b.runner.answerPost(thread, '   ')).toBeNull();
    expect(b.runner.answerPost('general', 'x')).toBeNull();
    expect(b.runner.get(run.id)!.status).toBe('question');
    expect(b.runner.answerPost(thread, 'The first one.')).toMatchObject({ kind: 'answer' });
    await b.settle();
    expect(b.runner.answerPost(thread, 'late')).toBeNull();
  });
});

describe('a run that hits the budget of the provider key', () => {
  /** Issues carrying the trigger label, so `scan` finds work to start. */
  const labeled = (n: number[]) => {
    const issues = fakeIssues();
    for (const iid of n) issues.add(issue(iid, { labels: ['bug', 'coxia'] }));
    return issues;
  };

  /** What a stage's engine throws when the provider refuses the call for want of budget. */
  const budgetRefusal = async (provider: string) => {
    const { ProviderBudgetError } = await import('../src/main/engine/contract');
    throw new ProviderBudgetError(provider, 'claude-sdk', 'API Error: 403 Key limit exceeded (monthly limit)');
  };

  it('waits with the reason instead of failing, offers no retry, and says so in the thread', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => budgetRefusal('anthropic'), () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const waited = b.runner.get(run.id)!;
    expect(waited.status).toBe('waiting');
    expect(waited.error).toBeNull();
    expect(waited.wait).toMatchObject({ kind: 'budget', provider: 'anthropic' });
    expect(waited.wait?.detail).toContain('Key limit exceeded');
    // the stage is waiting, so the person is offered "go on without waiting", never a retry
    const { runActions } = await import('../src/shared/runs/view');
    const ids = runActions(waited).map((a: { id: string }) => a.id);
    expect(ids).toContain('skipWait');
    expect(ids).not.toContain('retry');
    expect(b.thread(run).some((m) => m.code === 'run.stage.wait.budget')).toBe(true);
    expect(b.notices.some((n) => n.title.includes('falhou'))).toBe(false);
    // the run goes on by hand from the wait, as from any other
    b.runner.skipWait(run.id, 'Sigo assim mesmo.');
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('working');
  });

  it('reads back from its file, unchanged, and is not turned into a stage to restart', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => budgetRefusal('anthropic'));
    const run = await b.runner.start('app#101');
    await b.settle();
    const { parseRun } = await import('../src/shared/runs/schema');
    const raw = JSON.parse(readFileSync(join(b.dir, 'runs', `${run.id}.json`), 'utf8'));
    const parsed = parseRun(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.run.wait).toMatchObject({ kind: 'budget', provider: 'anthropic' });
    b.runner.resume();
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('waiting');
    expect(b.engine.calls).toHaveLength(1);
  });

  it('holds a new stage of the same run and a new run while a provider is out', async () => {
    const b = await boot({ issues: labeled([1, 2]) });
    easy(b);
    b.engine.script('refiner', () => budgetRefusal('anthropic'));
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true } }));
    const started = await b.runner.scan();
    await b.settle();
    expect(started.map((r) => r.issue.ref)).toEqual(['app#1']);
    expect(b.runner.get(started[0].id)).toMatchObject({ status: 'waiting', wait: { kind: 'budget' } });
    // the provider is out: no other run starts on it
    expect(await b.runner.scan()).toEqual([]);
    expect(b.runs.list()).toHaveLength(1);
  });

  it('holds a mention instead of spending a call on the provider that is out', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => budgetRefusal('anthropic'));
    const run = await b.runner.start('app#101');
    await b.settle();
    const [m] = b.forum.append(`run-${run.id}`, { kind: 'post', author: { type: 'person' }, text: '@refiner e agora?', mentions: ['refiner'] });
    b.runner.onMessage(m);
    await b.settle();
    expect(b.engine.calls.filter((c) => c.agent.id === 'refiner')).toHaveLength(1);
    expect(b.thread(run).find((x) => x.code === 'runner.mention.budget')?.params).toMatchObject({ agent: 'refiner', provider: 'anthropic' });
  });

  it('probes the provider once and sends every run that waited on it on', async () => {
    const probes: string[] = [];
    const b = await boot({
      issues: labeled([1, 2]),
      probeBudget: async (provider) => {
        probes.push(provider);
        return { state: 'ok' as const, detail: '' };
      },
    });
    easy(b);
    // The first attempt hits the budget; once the provider answers again (the probe says so), the stage is retried and finishes.
    b.engine.script('refiner', () => budgetRefusal('anthropic'), () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true, maxConcurrentRuns: 5 } }));
    const started = await b.runner.scan();
    await b.settle();
    // The first run waits on the provider; the second never spends a call on it (the hold stops it before its stage).
    expect(started).toHaveLength(2);
    const waiting = b.runs.list().filter((r) => r.status === 'waiting');
    expect(waiting).toHaveLength(1);
    expect(waiting[0].wait).toMatchObject({ kind: 'budget', provider: 'anthropic' });
    expect(probes).toEqual([]);
    // one sweep: one probe for the provider, and the run goes on
    await b.runner.tick();
    await b.settle();
    expect(probes).toEqual(['anthropic']);
    expect(b.runs.list().some((r) => r.wait?.kind === 'budget')).toBe(false);
  });

  it('keeps waiting when the probe still refuses, or when it cannot tell', async () => {
    const probes: string[] = [];
    const b = await boot({
      probeBudget: async (provider) => {
        probes.push(provider);
        return { state: 'out' as const, detail: 'API Error: 403 Key limit exceeded (monthly limit)' };
      },
    });
    easy(b);
    b.engine.script('refiner', () => budgetRefusal('anthropic'));
    const run = await b.runner.start('app#101');
    await b.settle();
    await b.runner.tick();
    await b.settle();
    expect(probes).toHaveLength(1);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'waiting', wait: { kind: 'budget' } });
    expect(b.engine.calls).toHaveLength(1);
  });
});
