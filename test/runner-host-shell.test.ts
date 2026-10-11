// The stage of an agent set to `shell: host`, with a session that runs nothing: every command waits for the person on the run, the answer comes back to the agent,
// "until the stage ends" stops the asking, the thread and the audit log say it ran on this computer, and a template never hands the mode out.
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { PendingCommand, Run } from '../src/shared/runs';
import { listAudit } from '../src/main/auditoria';
import { mergeTemplateTeam } from '../src/shared/cycles/apply';
import { newAgent, shellRaised } from '../src/shared/config/team';
import { type Boot, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const hostFor = (c: WorkspaceConfig, id: string) => {
  c.agents.team.find((a) => a.id === id)!.shell = 'host';
};

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
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

/** The command the run waits for the person to allow, once the agent asked. */
async function waiting(b: Boot): Promise<{ run: Run; command: PendingCommand }> {
  for (let i = 0; i < 400; i++) {
    const run = b.runner.list().find((r) => r.command);
    if (run?.command) return { run, command: run.command };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('no command waited for the person');
}

describe('a stage with shell: host', () => {
  it('waits for the person before each command, and gives the agent what they answered', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { hostFor(c, 'developer'); c.language = 'en'; } });
    easy(b);
    const results: unknown[] = [];
    b.engine.script('developer', async (c, tools) => {
      const first = c.exec!.exec('npm test');
      const asked = await waiting(b);
      expect(asked.command).toMatchObject({ agent: 'developer', command: 'npm test' });
      // Waiting for the person is something the run needs from them.
      expect(b.runner.get(asked.run.id)!.command?.id).toBe(asked.command.id);
      b.runner.command(asked.run.id, asked.command.id, 'once');
      results.push(await first);
      const second = c.exec!.exec('rm -rf build');
      const again = await waiting(b);
      b.runner.command(again.run.id, again.command.id, 'deny', 'not the build folder');
      results.push(await second);
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(run.command).toBeUndefined();
    expect(sandbox.opened.map((o) => o.host)).toEqual([true]);
    expect(results).toMatchObject([{ exitCode: 0 }, { refused: 'denied', output: 'not the build folder' }]);
    const codes = b.thread(run).map((m) => m.code).filter((c) => c?.startsWith('runner.command') || c?.startsWith('runner.exec'));
    expect(codes).toEqual(['runner.command.ask', 'runner.command.once', 'runner.exec.host', 'runner.command.ask', 'runner.command.deny', 'runner.exec.host', 'runner.commands.list']);
    const audit = listAudit().filter((e) => e.kind === 'exec');
    expect(audit.map((e) => [e.target, e.via])).toEqual([['npm test', 'host']]);
  });

  it('stops asking for the rest of the stage after "until the stage ends"', async () => {
    const b = await boot({ sandbox: fakeSandbox(), configure: (c) => hostFor(c, 'developer') });
    easy(b);
    let asks = 0;
    b.engine.script('developer', async (c, tools) => {
      const first = c.exec!.exec('npm test');
      const asked = await waiting(b);
      asks++;
      b.runner.command(asked.run.id, asked.command.id, 'stage');
      await first;
      expect((await c.exec!.exec('npm run lint')).exitCode).toBe(0);
      expect((await c.exec!.exec('npm run build')).exitCode).toBe(0);
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('done');
    expect(asks).toBe(1);
    expect(b.thread(run).filter((m) => m.code === 'runner.command.ask')).toHaveLength(1);
  });

  it('runs the workspace commands the app runs before QA without asking, and asks for what the QA agent runs besides', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { hostFor(c, 'qa'); c.runner.commands = ['npm test']; } });
    easy(b);
    b.engine.script('developer', async (_c, tools) => {
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    b.engine.script('qa', async (c) => {
      const ran = c.exec!.exec('npm run e2e');
      const asked = await waiting(b);
      expect(asked.command.command).toBe('npm run e2e');
      b.runner.command(asked.run.id, asked.command.id, 'once');
      await ran;
      const evidenceIds = await keepQaEvidence(c);
      return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', evidence: 'executed', commands: [2], evidenceIds }] });
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('done');
    const qa = sandbox.opened.find((o) => o.options.reader)!;
    expect(qa.host).toBe(true);
    expect(qa.session.asked).toEqual(['npm test', 'npm run e2e']);
    expect(b.thread(run).filter((m) => m.code === 'runner.command.ask').map((m) => m.params?.command)).toEqual(['npm run e2e']);
  });

  it('runs every command without asking under the autonomy block, and says so in the thread and in the list the run posts at its end', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { hostFor(c, 'developer'); c.language = 'en'; c.runner.autonomy = { ...c.runner.autonomy, cycle: true, hostCommands: true }; } });
    easy(b);
    const seen: number[] = [];
    b.engine.script('developer', async (c, tools) => {
      seen.push((await c.exec!.exec('npm test')).exitCode ?? -1);
      seen.push((await c.exec!.exec('npm run build')).exitCode ?? -1);
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('done');
    expect(seen).toEqual([0, 0]);
    // never waited for the person, and the thread marks the commands as run under the cycle's autonomy
    expect(b.runner.get(run.id)!.command).toBeUndefined();
    expect(b.thread(run).filter((m) => m.code === 'runner.command.ask')).toHaveLength(0);
    const marks = b.thread(run).filter((m) => m.code === 'runner.command.autonomy');
    expect(marks).toHaveLength(1);
    expect(marks[0].params).toMatchObject({ agent: 'developer', command: 'npm test' });
    // the run ended: one message carries the list of the commands, by agent
    const list = b.thread(run).filter((m) => m.code === 'runner.commands.list');
    expect(list).toHaveLength(1);
    expect(list[0].params?.count).toBe(2);
    expect(String(list[0].params?.text)).toContain('developer (2 commands)');
    expect(String(list[0].params?.text)).toContain('npm test');
    expect(String(list[0].params?.text)).toContain('on this computer');
  });

  it('opens on a machine that cannot make a sandbox, and refuses an answer to a command that no longer waits', async () => {
    const b = await boot({ sandbox: fakeSandbox({ available: false }), configure: (c) => hostFor(c, 'developer') });
    easy(b);
    let stale = '';
    b.engine.script('developer', async (c, tools) => {
      const first = c.exec!.exec('npm test');
      const asked = await waiting(b);
      stale = asked.command.id;
      b.runner.command(asked.run.id, asked.command.id, 'once');
      await first;
      expect(() => b.runner.command(asked.run.id, stale, 'once')).toThrow();
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('done');
    expect(stale).not.toBe('');
  });
});

describe('who can hand out shell: host', () => {
  it('ranks above a sandbox, so a paired browser can never raise an agent to it', () => {
    expect(shellRaised('sandbox', 'host')).toBe(true);
    expect(shellRaised('host', 'none')).toBe(false);
  });

  it('is never given by a template: the agent gets a sandbox where one works, and less where none does', () => {
    const brought = [newAgent({ id: 'runner-up', permission: 'worktree', shell: 'host', stages: [] })];
    const cycle = { stages: [], flows: {} };
    expect(mergeTemplateTeam([], brought, cycle, { sandbox: true })[0].shell).toBe('sandbox');
    expect(mergeTemplateTeam([], brought, cycle, { sandbox: false })[0].shell).toBe('allowlist');
  });
});
