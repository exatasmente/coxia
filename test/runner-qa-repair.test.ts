import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCall } from '../src/main/agents';
import { encodePng } from '../src/main/evidence/png';
import { EVIDENCE_MAX_BYTES } from '../src/shared/evidence';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { backEvidence, testPlanWithResults } from '../src/shared/runs';
import { type Boot, boot, doc, fakeSandbox, fakeEngine, work } from './helpers/runner';

// A QA stage with a sandbox: a claim of execution nothing backs is asked back once (the repair round), and the test plan and the comment say what the run
// recorded; the images the agent looked at and did not keep are kept as evidence of the stage, or said as looked and not kept. No model, no host, no network.

vi.setConfig({ testTimeout: 60_000 });

const PNG = (): Uint8Array => encodePng({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(200) });

/** Runs the whole flow with the QA agent in a sandbox and a script for it; returns the boot, the final run, and the QA calls. */
async function qaRun(configure: (c: WorkspaceConfig) => void, ...responses: ((call: AgentCall) => Promise<unknown>)[]): Promise<{ b: Boot; run: Run }> {
  const engine = fakeEngine();
  const b = await boot({
    sandbox: fakeSandbox(),
    engine,
    configure: (c) => {
      c.agents.team.find((a) => a.id === 'qa')!.shell = 'sandbox';
      c.runner.commands = [];
      configure(c);
    },
  });
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', ...(responses as never[]));
  let run = await b.runner.start('101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id) as Run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.stage === 'ready' || run.status === 'done') break;
  }
  return { b, run };
}

const qaComments = (b: Boot, run: Run) => b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.qa.repair');

/** The minimal tool context the engines pass to a tool (the same shape the ViewImage tests use). */
const lookCtx = { cwd: '/', roots: ['/'], isSecret: () => false, secretGlobs: [], outputMax: 1000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, seesImages: () => true };

describe('the repair round of a QA scenario with no backing', () => {
  it('asks the agent once and keeps the command it then points at', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        await call.exec?.exec('node probe.js');
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', detail: 'Opened it', evidence: 'executed', commands: [] }] });
      },
      async () => work('Fixed the note.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', detail: 'Opened it', evidence: 'executed', commands: [1] }] }),
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    // One repair round: the QA agent was called twice.
    const replies = b.engine.calls.filter((c) => c.agent.id === 'qa');
    expect(replies).toHaveLength(2);
    // The round continues the session of the answer it is about: the same dialog, not a fresh call that lost what the agent read.
    expect(replies[0].resume).toBeUndefined();
    expect(replies[1].resume).toEqual({ session: 'session-5', engine: 'claude-sdk' });
    // The repair prompt names the scenario and the commands of the stage.
    expect(replies[1].prompt).toContain('See the app');
    expect(replies[1].prompt).toContain('node probe.js');
    // The command it then pointed at backs the scenario: it stays executed, and nothing is downgraded.
    expect(done.qa[0].scenarios[0]).toMatchObject({ evidence: 'executed', commands: [1] });
    expect(done.qa[0].scenarios[0].unbacked).toBeUndefined();
    expect(qaComments(b, done)).toHaveLength(1);
    expect(b.thread(done).some((m) => m.code === 'runner.qa.unbacked')).toBe(false);
  });

  it('records the scenario as read when the round does not back it, and says so once', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        await call.exec?.exec('node probe.js');
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', detail: 'Opened it', evidence: 'executed', commands: [] }] });
      },
      async () => work('Still claim it.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', detail: 'Opened it', evidence: 'executed', commands: [] }] }),
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    // One round only: a second answer that still claims execution is downgraded without another question.
    expect(b.engine.calls.filter((c) => c.agent.id === 'qa')).toHaveLength(2);
    expect(done.qa[0].scenarios[0]).toMatchObject({ evidence: 'read', unbacked: true });
    const said = b.thread(done).filter((m) => m.code === 'runner.qa.unbacked');
    expect(said).toHaveLength(1);
    expect(said[0].params?.name).toBe('See the app');
  });

  it('leaves a QA stage without a sandbox as it was: everything read, no round', async () => {
    const engine = fakeEngine();
    const b = await boot({ engine, configure: (c) => void (c.language = 'en') });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
    b.engine.script('developer', () => work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
    b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    b.engine.script('qa', () => work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', detail: '', evidence: 'executed', commands: [1] }] }));
    let run = await b.runner.start('101');
    for (let i = 0; i < 40; i++) {
      await b.settle();
      run = b.runner.get(run.id) as Run;
      if (run.status === 'gate') b.runner.gate(run.id, 'approve');
      else if (run.stage === 'ready' || run.status === 'done') break;
    }
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    expect(b.engine.calls.filter((c) => c.agent.id === 'qa')).toHaveLength(1);
    expect(done.qa[0].scenarios[0].evidence).toBe('read');
    expect(b.thread(done).some((m) => m.code === 'runner.qa.repair')).toBe(false);
  });
});

describe('the test plan and the comment say what the run recorded', () => {
  it('writes the plan from the record: a downgraded scenario reads as read, a not-run one as not run', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        await call.exec?.exec('node probe.js');
        return work('Checked.', {
          artifacts: [doc('5_TEST_PLAN.md', '# Test plan\n\n## Scenarios\n\n- The app opened: passed (executed)\n')],
          scenarios: [
            { name: 'The app opened', result: 'pass', detail: 'Opened it', evidence: 'executed', commands: [] },
            { name: 'The import', result: 'not-run', detail: 'No display', evidence: 'read' },
          ],
        });
      },
      async () => work('Checked.', {
        artifacts: [doc('5_TEST_PLAN.md', '# Test plan\n\n## Scenarios\n\n- The app opened: passed (executed)\n')],
        scenarios: [
          { name: 'The app opened', result: 'pass', detail: 'Opened it', evidence: 'executed', commands: [] },
          { name: 'The import', result: 'not-run', detail: 'No display', evidence: 'read' },
        ],
      }),
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const { readFileSync } = await import('node:fs');
    const plan = readFileSync(join(done.worktree, done.cycleFolder, '5_TEST_PLAN.md'), 'utf8');
    // The scenario recorded as read is never called executed in the document, and it is written once.
    expect(plan).not.toContain('passed (executed)');
    expect(plan).toContain('The app opened: passed (read)');
    expect(plan).toContain('The import: not run');
  });
});

describe('what the agent looked at is not lost', () => {
  it('keeps an image the agent viewed and did not keep as evidence of the stage', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        const stageDir = call.exec?.stageDir as string;
        mkdirSync(join(stageDir, 'out'), { recursive: true });
        writeFileSync(join(stageDir, 'out', 'shot.png'), PNG());
        // The agent looks at it through the same tool the engines use, which is what tells the app it was looked at; it never keeps it.
        const { viewImageToolImpl } = await import('../src/main/sandbox/engineTool');
        await viewImageToolImpl(call.exec!, call.evidence, call.onLooked).run({ source: '/coxia/out/shot.png' }, lookCtx);
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'The app', result: 'pass', detail: '', evidence: 'read' }] });
      },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const kept = Object.values(done.evidence ?? {}).filter((e) => e.stage === 'qa');
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept[0]).toMatchObject({ title: expect.stringContaining('app'), kind: 'png' });
    // The conversation says how many were kept.
    const said = b.thread(done).filter((m) => m.code === 'runner.qa.lookKept');
    expect(said).toHaveLength(1);
  });

  it('says "looked at, not kept" with the reason when the file goes away before the stage ends', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        const stageDir = call.exec?.stageDir as string;
        mkdirSync(join(stageDir, 'out'), { recursive: true });
        writeFileSync(join(stageDir, 'out', 'shot.png'), PNG());
        const { viewImageToolImpl } = await import('../src/main/sandbox/engineTool');
        await viewImageToolImpl(call.exec!, call.evidence, call.onLooked).run({ source: '/coxia/out/shot.png' }, lookCtx);
        // The file is gone by the time the stage concludes: there is nothing left to keep, and the app must say so instead of dropping it silently.
        rmSync(join(stageDir, 'out', 'shot.png'), { force: true });
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'The app', result: 'pass', detail: '', evidence: 'read' }] });
      },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const said = b.thread(done).filter((m) => m.code === 'runner.qa.lookNotKept');
    expect(said).toHaveLength(1);
    expect(said[0].params?.name).toBe('shot.png');
    expect(b.thread(done).filter((m) => m.code === 'runner.qa.lookKept')).toHaveLength(0);
    expect(Object.values(done.evidence ?? {}).filter((e) => e.stage === 'qa')).toHaveLength(0);
  });

  it('says "looked at, not kept" for a link out of the folder and for a path outside it, and keeps no such thing', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        const stageDir = call.exec?.stageDir as string;
        mkdirSync(join(stageDir, 'out'), { recursive: true });
        // A link the sandbox left in the output folder, and a path of another folder of this machine: the app was told it looked at both and keeps neither.
        symlinkSync(tmpdir(), join(stageDir, 'out', 'elsewhere'));
        const seen = [join(stageDir, 'out', 'elsewhere'), '/etc/hostname'];
        for (const one of seen) call.onLooked?.(one);
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'The app', result: 'pass', detail: '', evidence: 'read' }] });
      },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const said = b.thread(done).filter((m) => m.code === 'runner.qa.lookNotKept');
    const names = said.map((m) => m.params?.name).sort();
    // Both are said with the reason, and the path outside the folder is never followed: no piece of evidence comes out of it.
    expect(names).toEqual(['elsewhere', 'hostname']);
    expect(Object.values(done.evidence ?? {}).filter((e) => e.stage === 'qa')).toHaveLength(0);
    expect(String(said.find((m) => m.params?.name === 'elsewhere')?.params?.reason)).toMatch(/link/i);
    expect(String(said.find((m) => m.params?.name === 'hostname')?.params?.reason)).toMatch(/output folder/i);
    expect(b.thread(done).filter((m) => m.code === 'runner.qa.lookKept')).toHaveLength(0);
  });

  it('keeps a picture looked at by name whatever it is called, and never reads outside the stage folder', async () => {
    const { b, run } = await qaRun(
      (c) => void (c.language = 'en'),
      async (call) => {
        const stageDir = call.exec?.stageDir as string;
        mkdirSync(join(stageDir, 'out'), { recursive: true });
        // A picture whose name says it is text, and a text file of the folder above the stage folder (never the stage's own output).
        writeFileSync(join(stageDir, 'out', 'shot.txt'), PNG());
        writeFileSync(join(stageDir, '..', 'notes-outside.md'), '# notes\n');
        const { viewImageToolImpl } = await import('../src/main/sandbox/engineTool');
        const tool = viewImageToolImpl(call.exec!, call.evidence, call.onLooked);
        await tool.run({ source: '/coxia/out/shot.txt' }, lookCtx);
        await call.onLooked?.(join(stageDir, '..', 'notes-outside.md'));
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'The app', result: 'pass', detail: '', evidence: 'read' }] });
      },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    // What the stage looked at is kept: the kind is read from the bytes, never from the name, and the piece keeps the name the file has.
    const kept = Object.values(done.evidence ?? {}).filter((e) => e.stage === 'qa');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ kind: 'png', name: 'shot.txt', title: expect.stringContaining('app') });
    const said = b.thread(done).filter((m) => m.code === 'runner.qa.lookNotKept');
    expect(said.map((m) => m.params?.name)).toEqual(['notes-outside.md']);
    expect(String(said[0].params?.reason)).toMatch(/output folder/i);
  });
});

describe('the pure test plan', () => {
  it('replaces the app\'s own results section and writes one line per recorded scenario', () => {
    const out = testPlanWithResults('# Plan\n\n## Scenarios\n\n- a: passed (executed)\n\n## Other\n\nWords.\n', [
      { name: 'a', result: 'pass', detail: '', evidence: 'read', unbacked: true },
      { name: 'b', result: 'not-run', detail: 'No display' },
    ], 'en');
    expect(out).toContain('a: passed (read)');
    expect(out).toContain('b: not run (read)');
    expect(out).toContain('## Other');
    expect(out).not.toContain('passed (executed)');
    expect(out.match(/a: passed/g)).toHaveLength(1);
  });
});

describe('backEvidence', () => {
  it('downgrades a claim nothing backs and leaves a backed one alone, as before', () => {
    const log = [{ n: 1, exitCode: 0, timedOut: false }, { n: 2, exitCode: 1, timedOut: false }];
    const s = (commands: number[]) => ({ name: 'x', result: 'pass' as const, detail: '', evidence: 'executed' as const, commands });
    expect(backEvidence([s([1])], log, true)[0]).toMatchObject({ evidence: 'executed', commands: [1] });
    expect(backEvidence([s([])], log, true)[0]).toMatchObject({ evidence: 'read', unbacked: true });
  });
});
