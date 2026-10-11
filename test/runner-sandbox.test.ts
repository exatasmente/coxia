// The stage of an agent set to run commands in a sandbox, with a sandbox that runs nothing: when it is made and ended, what goes through it, what the thread, the audit
// log and the QA record say, and what happens on a machine that cannot make one.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { RunnerError } from '../src/main/runner/service';
import { listAudit } from '../src/main/auditoria';
import { neutralSandbox } from '../src/shared/config/defaults';
import { DATA_ROOT, WORKSPACE_ID } from '../src/main/env';
import { setTestFlag } from '../src/main/workspaces-core';
import { type Boot, boot, doc, fakeCommands, fakeSandbox, keepQaEvidence, makeRepo, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const shellOf = (c: WorkspaceConfig, id: string, shell: 'none' | 'allowlist' | 'sandbox') => {
  c.agents.team.find((a) => a.id === id)!.shell = shell;
};

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', async (call) => {
    const evidenceIds = await keepQaEvidence(call);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
  });
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

  it('opens the sandbox for the agent that works the stage, with the hosts that agent was given and none for one that was given none', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'developer', 'sandbox'); shellOf(c, 'qa', 'sandbox'); c.agents.team.find((a) => a.id === 'developer')!.allowedHosts = ['app.example.com']; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(sandbox.opened.map((o) => [o.options.agent?.allowedHosts ?? null])).toEqual([[['app.example.com']], [[]]]);
  });

  it('keeps the workspace\'s own network from an agent with hosts in a test workspace, and the thread says why', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'developer', 'sandbox'); c.agents.team.find((a) => a.id === 'developer')!.allowedHosts = ['app.example.com']; } });
    easy(b);
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    try {
      let run = await b.runner.start('app#101');
      run = await reach(b, run, 'ready');
      expect(sandbox.opened[0].options.agent?.allowedHosts).toEqual([]);
      const lines = b.thread(run).filter((m) => m.code === 'runner.screen.testWorkspace');
      expect(lines).toHaveLength(1);
      expect(lines[0].params).toMatchObject({ agent: 'developer' });
    } finally {
      setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    }
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

  it('redacts the command text in the thread, the audit log and the QA record, and keeps what the run file stores short enough to be read back', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.runner.commands = []; } });
    easy(b);
    const token = `ghp_${'a'.repeat(36)}`;
    const long = `echo ${token} ${'x'.repeat(2000)}`;
    b.engine.script('qa', async (c) => {
      await c.exec!.exec(long);
      const evidenceIds = await keepQaEvidence(c);
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'a', result: 'pass', detail: '', evidence: 'executed', commands: [1], evidenceIds }] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const said = JSON.stringify(b.thread(run).filter((m) => m.code === 'runner.exec'));
    expect(said).not.toContain(token);
    expect(JSON.stringify(listAudit().filter((e) => e.kind === 'exec'))).not.toContain(token);
    expect(run.qa[0].commands![0].command).not.toContain(token);
    expect(run.qa[0].commands![0].command.length).toBeLessThanOrEqual(300);
    // The run file reads back (a command over the length the file allows would have made it unreadable).
    expect(b.runs.get(run.id)?.qa[0].commands).toHaveLength(1);
  });

  it('tells the thread when a folder listed for the sandbox holds a repository', async () => {
    const sandbox = fakeSandbox({ repoFolders: ['/home/u/tools/nvm'] });
    const b = await boot({ sandbox, configure: (c) => shellOf(c, 'developer', 'sandbox') });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const note = b.thread(run).find((m) => m.code === 'runner.sandbox.repoFolder');
    expect(note?.params).toMatchObject({ agent: 'developer', path: '/home/u/tools/nvm' });
  });

  it('links the clone\'s dependencies before the sandbox is made, because the sandbox shares what the links lead to, and tells the thread of one that leads outside', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo.clone, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(repo.clone, '.git', 'info', 'exclude'), 'node_modules/\n');
    const seen: boolean[] = [];
    const sandbox = fakeSandbox({ depsOutside: ['node_modules'], onOpen: (o) => seen.push(existsSync(join(o.worktree, 'node_modules')) && lstatSync(join(o.worktree, 'node_modules')).isSymbolicLink()) });
    const b = await boot({ repo, sandbox, configure: (c) => { shellOf(c, 'developer', 'sandbox'); c.language = 'en'; } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(seen).toEqual([true]);
    const note = b.thread(run).find((m) => m.code === 'runner.sandbox.depsOutside');
    expect(note?.params).toMatchObject({ agent: 'developer', name: 'node_modules' });
  });

  it('runs the commands QA is given the results of inside its sandbox, numbers them, and keeps their numbers and who ran them', async () => {
    const sandbox = fakeSandbox({ table: { 'npm test': { exitCode: 1, output: 'FAIL x' } } });
    const commands = fakeCommands();
    const b = await boot({ sandbox, commandRunner: commands, configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.runner.commands = ['npm test']; c.language = 'en'; } });
    easy(b);
    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      const evidenceIds = await keepQaEvidence(c);
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'a', result: 'pass', detail: '', evidence: 'executed', commands: [2], evidenceIds }] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    // The app's own run went through the sandbox, not around it.
    expect(commands.ran).toEqual([]);
    expect(sandbox.opened[0].session.asked).toEqual(['npm test', 'node probe.js']);
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.prompt).toContain('#1 $ npm test');
    expect(qa.prompt).toContain('evidence');
    expect(qa.prompt).toContain('SaveEvidence');
    expect(qa.prompt).toContain('evidenceIds');
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
  const run = async (scenarios: Record<string, unknown>[], sandbox = true, table = {}): Promise<Run> => {
    const b = await boot({ sandbox: fakeSandbox({ table }), configure: (c) => { if (sandbox) shellOf(c, 'qa', 'sandbox'); c.runner.commands = []; } });
    easy(b);
    b.engine.script('qa', async (c) => {
      await c.exec?.exec('node probe.js');
      await c.exec?.exec('node broken.js');
      const evidenceIds = await keepQaEvidence(c);
      return work('Checked.', {
        artifacts: [doc('5_TEST_PLAN.md')],
        scenarios: scenarios.map((scenario) => ({ ...scenario, ...(evidenceIds.length ? { evidenceIds } : {}) })),
      });
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

  it('does not finish a conclusive scenario that has no evidence saved and cited', async () => {
    const b = await boot({ sandbox: fakeSandbox(), configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.runner.commands = []; } });
    easy(b);
    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      return work('Checked.', {
        artifacts: [doc('5_TEST_PLAN.md')],
        scenarios: [{ name: 'a', result: 'pass', detail: '', evidence: 'read' }],
      });
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('failed');
    expect(run.error?.detail).toMatch(/SaveEvidence/);
  });

  it('does not finish an executed scenario when its saved evidence is not cited', async () => {
    const b = await boot({ sandbox: fakeSandbox(), configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.runner.commands = []; } });
    easy(b);
    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      await keepQaEvidence(c);
      return work('Checked.', {
        artifacts: [doc('5_TEST_PLAN.md')],
        scenarios: [{ name: 'a', result: 'pass', detail: '', evidence: 'executed', commands: [1] }],
      });
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('failed');
    expect(run.error?.detail).toMatch(/evidenceIds/);
    // The stage was asked once more before failing; the round kept a second piece and still cited none.
    expect(b.engine.calls.filter((c) => c.agent.id === 'qa')).toHaveLength(2);
    expect(Object.keys(run.evidence ?? {})).toHaveLength(2);
  });

  it('finishes a retried QA that cites the evidence an earlier attempt of the stage kept, and not one citing an id the run never kept', async () => {
    const b = await boot({ sandbox: fakeSandbox(), configure: (c) => { shellOf(c, 'qa', 'sandbox'); c.runner.commands = []; } });
    easy(b);
    const scenario = (evidenceIds: string[]) => ({ name: 'a', result: 'pass' as const, detail: '', evidence: 'executed' as const, commands: [1], evidenceIds });
    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      await keepQaEvidence(c);
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [scenario([])] });
    });
    let run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('failed');
    const [earlier] = Object.keys(run.evidence ?? {});

    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [scenario(['ev-99'])] });
    });
    b.runner.retry(run.id);
    run = await reach(b, b.runner.get(run.id)!, 'ready');
    expect(run.status).toBe('failed');
    expect(run.error?.detail).toMatch(/evidenceIds/);

    b.engine.script('qa', async (c) => {
      await c.exec!.exec('node probe.js');
      return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [scenario([earlier])] });
    });
    b.runner.retry(run.id);
    run = await reach(b, b.runner.get(run.id)!, 'ready');
    expect(run.status).toBe('done');
    expect(run.qa.at(-1)!.scenarios[0].evidenceIds).toEqual([earlier]);
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

describe('a stage and the workspace test environment', () => {
  it('delivers the entries to the shell of a stage that allows them, and none to one that does not', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => {
      shellOf(c, 'developer', 'sandbox');
      shellOf(c, 'qa', 'sandbox');
      c.language = 'en';
      c.testEnvironment = { variables: [{ name: 'INTEGRATION_URL', value: 'https://staging.example.com' }], secrets: [] };
    } });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    // The developer stage is a work stage (left out of testEnv reads as no) and the QA one allows it by default; the opens come in runner order.
    expect(sandbox.opened).toHaveLength(2);
    const [dev, qa] = sandbox.opened.map((o) => o.options);
    expect(dev.testEnv).toBeUndefined();
    expect(dev.config.network).toBe(neutralSandbox().network);
    expect(qa.testEnv).toMatchObject({ vars: { INTEGRATION_URL: 'https://staging.example.com' } });
  });
});
