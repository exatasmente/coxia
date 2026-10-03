// The stage of an agent set to run commands in a sandbox, with a sandbox that runs nothing: when it is made and ended, what goes through it, what the thread, the audit
// log and the QA record say, and what happens on a machine that cannot make one.
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { RunnerError } from '../src/main/runner/service';
import { listAudit } from '../src/main/auditoria';
import { type Boot, boot, doc, fakeCommands, fakeSandbox, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const shellOf = (c: WorkspaceConfig, id: string, shell: 'none' | 'allowlist' | 'sandbox') => {
  c.agents.team.find((a) => a.id === id)!.shell = shell;
};

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

describe('a stage with a sandbox', () => {
  it('makes the sandbox for the agents set to it and for no one else, a reader in a copy and an agent that writes in the worktree', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'developer', 'sandbox'); shellOf(c, 'qa', 'sandbox'); } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(sandbox.opened.map((o) => [o.options.reader, o.options.worktree === run.worktree])).toEqual([[false, true], [true, true]]);
    expect(sandbox.opened.every((o) => o.session.closed)).toBe(true);
    const dev = b.engine.calls.find((c) => c.agent.id === 'developer')!;
    expect(dev.exec).toBe(sandbox.opened[0].session);
    expect(b.engine.calls.filter((c) => !['developer', 'qa'].includes(c.agent.id)).every((c) => c.exec === undefined)).toBe(true);
  });

  it('does not make one for an agent with no commands or with the list, which runs as it always did', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'developer', 'allowlist'); c.runner.commands = ['npm test']; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(sandbox.opened).toEqual([]);
    const dev = b.engine.calls.find((c) => c.agent.id === 'developer')!;
    expect(dev.exec).toBeUndefined();
    expect(dev.confine).toBeDefined();
  });

  it('gives an agent that writes no commands of the list when its shell is none, and the commands of the list when it is allowlist', async () => {
    const none = await boot({ configure: (c) => { shellOf(c, 'developer', 'none'); c.runner.commands = ['npm test']; } });
    easy(none);
    await reach(none, await none.runner.start('app#101'), 'ready');
    const bash = await toolsDenied(none);
    expect(bash).toBeTruthy();
    const some = await boot({ configure: (c) => { shellOf(c, 'developer', 'allowlist'); c.runner.commands = ['npm test']; } });
    easy(some);
    await reach(some, await some.runner.start('app#101'), 'ready');
    expect(await toolsDenied(some)).toBeNull();
  });

  it('ends the sandbox before the app commits what the agent changed', async () => {
    const heads: string[] = [];
    let worktree = '';
    const sandbox = fakeSandbox({ onClose: () => void heads.push(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree }).toString().trim()) });
    const b = await boot({ sandbox, configure: (c) => shellOf(c, 'developer', 'sandbox') });
    easy(b);
    const developer = b.engine.script.bind(b.engine);
    developer('developer', async (c, tools) => {
      worktree = c.cwd;
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const final = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: run.worktree }).toString().trim();
    // When the sandbox ended the commit of the stage did not exist yet.
    expect(heads[0]).not.toBe(final);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: run.worktree }).toString()).toContain('add the feature');
  });

  it('tells the thread, the live activity and the audit log about every command, with its exit code', async () => {
    const sandbox = fakeSandbox({ table: { 'npm test': { exitCode: 1, output: 'FAIL slug accents' } } });
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'developer', 'sandbox'); c.language = 'en'; } });
    easy(b);
    b.engine.script('developer', async (c, tools) => {
      await c.exec!.exec('npm test');
      await c.exec!.exec('ls');
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const said = b.thread(run).filter((m) => m.code === 'runner.exec');
    expect(said.map((m) => [m.params?.agent, m.params?.n, m.params?.command, m.params?.result])).toEqual([['developer', 1, 'npm test', 'exit code 1'], ['developer', 2, 'ls', 'exit code 0']]);
    expect(said[0].params?.tail).toBe('FAIL slug accents');
    const audit = listAudit().filter((e) => e.kind === 'exec');
    expect(audit.map((e) => [e.target, e.code, e.ok, e.by, e.via])).toEqual(expect.arrayContaining([['ls', 0, true, 'developer', 'sandbox'], ['npm test', 1, false, 'developer', 'sandbox']]));
    expect(audit[0].origin.kind).toBe('run-exec');
  });

  it('runs the commands QA is given the results of inside its sandbox, numbers them, and keeps their numbers and who ran them', async () => {
    const sandbox = fakeSandbox({ table: { 'npm test': { exitCode: 1, output: 'FAIL x' } } });
    const commands = fakeCommands();
    const b = await boot({ sandbox, commandRunner: commands, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.runner.commands = ['npm test']; c.language = 'en'; } });
    easy(b);
    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'a', result: 'pass', detail: '', evidence: 'executed', commands: [2] }] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    // The app's own run went through the sandbox, not around it.
    expect(commands.ran).toEqual([]);
    expect(sandbox.opened[0].session.asked).toEqual(['npm test', 'node probe.js']);
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.prompt).toContain('#1 $ npm test');
    expect(qa.prompt).toContain('evidence');
    expect(qa.system).toContain('throwaway copy');
    expect(run.qa[0].commands).toEqual([
      { command: 'npm test', exitCode: 1, timedOut: false, n: 1, by: 'app' },
      { command: 'node probe.js', exitCode: 0, timedOut: false, n: 2, by: 'agent' },
    ]);
    expect(run.qa[0].scenarios[0]).toMatchObject({ evidence: 'executed', commands: [2] });
    expect(run.qa[0].scenarios[0].unbacked).toBeUndefined();
  });
});

async function toolsDenied(b: Boot): Promise<string | null> {
  const call = b.engine.calls.find((c) => c.agent.id === 'developer')!;
  const { toolsFor } = await import('./helpers/runner');
  return toolsFor(call).bash('npm test');
}

describe('what QA claims to have executed', () => {
  const run = async (scenarios: unknown[], sandbox = true, table = {}): Promise<Run> => {
    const b = await boot({ sandbox: fakeSandbox({ table }), configure: (c) => { if (sandbox) shellOf(c, 'qa', 'sandbox'); c.runner.commands = []; } });
    easy(b);
    b.engine.script('qa', async (c) => {
      await c.exec?.exec('node probe.js');
      await c.exec?.exec('node broken.js');
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios });
    });
    const started = await b.runner.start('app#101');
    return reach(b, started, 'ready');
  };

  it('stands when a command of the stage backs it, and is labelled when nothing does', async () => {
    const r = await run([
      { name: 'backed', result: 'pass', detail: '', evidence: 'executed', commands: [1] },
      { name: 'cites nothing', result: 'pass', detail: '', evidence: 'executed', commands: [] },
      { name: 'cites a command that never ran', result: 'pass', detail: '', evidence: 'executed', commands: [9] },
      { name: 'only read', result: 'pass', detail: '', evidence: 'read' },
      { name: 'says nothing', result: 'pass', detail: '' },
    ], true, { 'node broken.js': { exitCode: 2 } });
    expect(r.qa[0].scenarios.map((s) => [s.name, s.evidence, s.unbacked ?? false])).toEqual([
      ['backed', 'executed', false],
      ['cites nothing', 'read', true],
      ['cites a command that never ran', 'read', true],
      ['only read', 'read', false],
      ['says nothing', 'read', false],
    ]);
  });

  it('needs a pass to rest on a command that ended with exit code 0, and a failure on one that ran to an end', async () => {
    const r = await run([
      { name: 'pass on a failing command', result: 'pass', detail: '', evidence: 'executed', commands: [2] },
      { name: 'fail on a failing command', result: 'fail', severity: 'non-blocking', detail: 'broke', evidence: 'executed', commands: [2] },
    ], true, { 'node broken.js': { exitCode: 2 } });
    expect(r.qa[0].scenarios.map((s) => [s.evidence, s.unbacked ?? false])).toEqual([['read', true], ['executed', false]]);
  });

  it('is "only read" for every scenario of a QA agent with no sandbox', async () => {
    const r = await run([{ name: 'a', result: 'pass', detail: '', evidence: 'executed', commands: [1] }, { name: 'b', result: 'fail', severity: 'non-blocking', detail: 'x' }], false);
    expect(r.qa[0].scenarios.map((s) => [s.evidence, s.unbacked ?? false])).toEqual([['read', false], ['read', false]]);
  });
});

describe('a computer that cannot make a sandbox', () => {
  it('refuses to start a run whose team has an agent set to a sandbox, and says which and why, before a worktree exists', async () => {
    const b = await boot({ sandbox: fakeSandbox({ available: false }), configure: (c) => { shellOf(c, 'developer', 'sandbox'); c.language = 'en'; } });
    await expect(b.runner.start('app#101')).rejects.toBeInstanceOf(RunnerError);
    await expect(b.runner.start('app#101')).rejects.toThrow(/developer.*bubblewrap/s);
    expect(b.runner.list()).toEqual([]);
  });

  it('refuses the same with no sandbox service at all', async () => {
    const b = await boot({ configure: (c) => shellOf(c, 'developer', 'sandbox') });
    await expect(b.runner.start('app#101')).rejects.toBeInstanceOf(RunnerError);
  });

  it('fails the stage, closed, when the sandbox goes away between the start and the stage, and runs nothing', async () => {
    let up = true;
    const real = fakeSandbox();
    const flaky = { ...real, status: async () => real.status(), open: async (o: Parameters<typeof real.open>[0]) => (up ? real.open(o) : fakeSandbox({ available: false }).open(o)) };
    const commands = fakeCommands();
    const b = await boot({ sandbox: flaky, commandRunner: commands, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.language = 'en'; } });
    easy(b);
    let started = await b.runner.start('app#101');
    up = false;
    started = await reach(b, started, 'qa');
    await b.settle();
    const now = b.runner.get(started.id)!;
    expect(now.status).toBe('failed');
    expect(now.error?.detail).toMatch(/qa.*sandbox/is);
    // Nothing fell back to running the commands outside.
    expect(commands.ran).toEqual([]);
  });
});
