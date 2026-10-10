import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCall } from '../src/main/agents';
import { encodePng } from '../src/main/evidence/png';
import { evidencePath } from '../src/main/evidence/store';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, fakeSandbox, issue, work } from './helpers/runner';

// A QA pass that keeps evidence and cites it: the run records it, the conversation carries the file, the scenario cites the id, and, with the workspace choice
// "also in the cycle folder", the copy goes into the stage's commit. No model, no host, no network: the engine is the routed one and the sandbox is the fake.

vi.setConfig({ testTimeout: 60_000 });

const PNG = (): Uint8Array => encodePng({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(200) });

/** Runs the whole engineering flow with the given QA answer for the other stages, and returns the boot and the run. */
async function full(configure: (c: WorkspaceConfig) => void, qa: (call: AgentCall) => Promise<unknown>): Promise<{ b: Boot; run: Run }> {
  // The evidence tools are offered to an agent with a sandbox: the QA agent is set to run its commands there, as the shipped team recommends.
  const b = await boot({
    sandbox: fakeSandbox(),
    issues: undefined,
    configure: (c) => {
      c.agents.team.find((a) => a.id === 'qa')!.shell = 'sandbox';
      configure(c);
    },
  });
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', qa as never);
  let run = await b.runner.start('101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id) as Run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.stage === 'ready' || run.status === 'done') break;
  }
  return { b, run };
}

/** Keeps one image in the stage's output folder and answers with a scenario that cites it. */
const keepAndCite = (answer: (call: AgentCall) => Promise<unknown>) => async (call: AgentCall): Promise<unknown> => {
  const stageDir = call.exec?.stageDir as string;
  mkdirSync(join(stageDir, 'out'), { recursive: true });
  writeFileSync(join(stageDir, 'out', 'shot.png'), PNG());
  await call.evidence?.save({ path: '/coxia/out/shot.png', title: 'The screen', description: 'The field' });
  return answer(call);
};

void issue;

/**
 * The same flow with the QA agent set to run its commands on this computer (`shell: host`): the folder the stage saves in is the one the session declared,
 * and, when nothing was asked to test an interface, the stage has no such folder and stays as it was.
 */
async function fullHost(configure: (c: WorkspaceConfig) => void, qa: (call: AgentCall) => Promise<unknown>, gui?: { out: string }): Promise<{ b: Boot; run: Run }> {
  const sandbox = fakeSandbox(gui ? { gui: { browsers: '/b/ms-playwright', display: 'on', out: gui.out } } : {});
  const b = await boot({
    sandbox,
    issues: undefined,
    configure: (c) => {
      c.agents.team.find((a) => a.id === 'qa')!.shell = 'host';
      configure(c);
    },
  });
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', qa as never);
  let run = await b.runner.start('101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id) as Run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.stage === 'ready' || run.status === 'done') break;
  }
  return { b, run };
}

describe('evidence in a run', () => {
  it('records the evidence, publishes it in the conversation and shows it under the scenario', async () => {
    const { b, run } = await full(
      (c) => {
        c.language = 'en';
      },
      keepAndCite(async () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', severity: 'non-blocking', detail: 'Looked', evidenceIds: ['ev-1'] }] })),
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    expect(done.evidence?.['ev-1']).toMatchObject({ id: 'ev-1', title: 'The screen', stage: 'qa', kind: 'png' });
    // The conversation carries the file as the evidence of a message.
    const message = b.thread(done).find((m) => (m.evidence ?? []).some((a) => a.id === 'ev-1'));
    expect(message).toBeDefined();
    expect(message?.evidence?.[0]).toMatchObject({ id: 'ev-1', media: 'image/png' });
    // The QA scenario cites the id.
    const qa = done.qa.at(-1);
    expect(qa?.scenarios[0].evidenceIds).toEqual(['ev-1']);
    // Citing evidence never makes a scenario `executed`.
    expect(qa?.scenarios[0].evidence ?? 'read').not.toBe('executed');
    // With the default placement, nothing of the evidence is in the cycle folder.
    expect(existsSync(join(done.worktree, done.cycleFolder, 'evidence'))).toBe(false);
  });

  it('gives each piece a stage keeps its own id, lets the stage mark one it just kept, and shows every one of them', async () => {
    const { b, run } = await full(
      (c) => {
        c.language = 'en';
      },
      async (call) => {
        const stageDir = call.exec?.stageDir as string;
        mkdirSync(join(stageDir, 'out'), { recursive: true });
        const answers: string[] = [];
        for (const [name, shade] of [['one.png', 100], ['two.png', 150], ['three.png', 220]] as const) {
          writeFileSync(join(stageDir, 'out', name), encodePng({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(shade) }));
          answers.push((await call.evidence?.save({ path: `/coxia/out/${name}`, title: `Shot ${name}` }))?.text ?? '');
        }
        // A piece kept a moment ago is already known to the tools of the same stage.
        answers.push((await call.evidence?.annotate({ source: 'ev-2', marks: [{ kind: 'rectangle', x: 0, y: 0, w: 2, h: 2, color: 'red', width: 1 }] }))?.text ?? '');
        expect(answers[0]).toContain('ev-1');
        expect(answers[1]).toContain('ev-2');
        expect(answers[2]).toContain('ev-3');
        expect(answers[3]).toContain('ev-4');
        return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', severity: 'non-blocking', detail: 'Looked', evidenceIds: ['ev-1', 'ev-2', 'ev-3', 'ev-4'] }] });
      },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    expect(Object.keys(done.evidence ?? {})).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4']);
    expect(done.evidence?.['ev-4']).toMatchObject({ from: 'ev-2' });
    expect(done.qa.at(-1)?.scenarios[0].evidenceIds).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4']);
    // Each one is published once, with its own file.
    const shown = b.thread(done).flatMap((m) => (m.evidence ?? []).map((a) => a.id));
    expect(shown).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4']);
  });

  it('copies the evidence into the cycle folder and the stage commit when the workspace chooses it', async () => {
    const { b, run } = await full(
      (c) => {
        c.language = 'en';
        c.runner.evidence = 'cycle';
      },
      keepAndCite(async () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', severity: 'non-blocking', detail: 'Looked', evidenceIds: ['ev-1'] }] })),
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const copy = join(done.worktree, done.cycleFolder, 'evidence', 'ev-1.png');
    expect(existsSync(copy)).toBe(true);
    expect(done.evidence?.['ev-1']?.inCycle).toBe(true);
    // The stage's commit took it: the file is in the branch's tree.
    const { git } = await import('./helpers/conflictRepos');
    const listed = git(done.worktree, 'ls-files', `${done.cycleFolder}/evidence`);
    expect(listed).toContain('ev-1.png');
  });

  it('removes the run\'s evidence with the person\'s action, and the file is gone', async () => {
    const { b, run } = await full(
      (c) => {
        c.language = 'en';
      },
      keepAndCite(async () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', severity: 'non-blocking', detail: 'Looked', evidenceIds: ['ev-1'] }] })),
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const record = done.evidence?.['ev-1'];
    expect(record).toBeDefined();
    const before = evidencePath(b.deps.env().dataDir, done.id, record as NonNullable<typeof record>);
    expect(before && existsSync(before)).toBe(true);
    expect(b.runner.removeEvidence(done.id, 'ev-1')).toBe(true);
    expect(b.runner.get(done.id)?.evidence?.['ev-1']).toBeUndefined();
    expect(before && existsSync(before)).toBe(false);
    expect(b.runner.evidence(done.id)).toEqual([]);
  });
});

describe('evidence of a stage whose commands run on the computer', () => {
  it('keeps what the agent saved in its own output folder and lets a scenario cite it', async () => {
    const out = mkdtempSync(join(tmpdir(), 'coxia-host-out-'));
    const { b, run } = await fullHost(
      (c) => void (c.language = 'en'),
      async (call) => {
        // The agent saves a file it made in the folder the session declared for it (the one `$COXIA_OUT` holds).
        writeFileSync(join(call.exec!.outputDir as string, 'shot.png'), PNG());
        await call.evidence!.save({ path: join(call.exec!.outputDir as string, 'shot.png'), title: 'The screen' });
        return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', severity: 'non-blocking', detail: 'Looked', evidenceIds: ['ev-1'] }] });
      },
      { out },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    expect(done.evidence?.['ev-1']).toMatchObject({ id: 'ev-1', title: 'The screen', stage: 'qa', kind: 'png' });
    expect(done.qa.at(-1)?.scenarios[0].evidenceIds).toEqual(['ev-1']);
    // The tools were offered at all: the call carried them, and the id resolved to a real file of the run.
    expect(b.engine.calls.find((c) => c.agent.id === 'qa')?.evidence).toBeDefined();
  });

  it('offers none of it to a host stage with no interface to test, as before', async () => {
    const { b, run } = await fullHost(
      (c) => void (c.language = 'en'),
      async (call) => {
        expect(call.evidence).toBeUndefined();
        expect(call.exec?.outputDir).toBeUndefined();
        return work('Checked.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'Nothing', result: 'not-run', detail: 'No display', evidence: 'read' }] });
      },
    );
    const done = b.runner.get(run.id) as NonNullable<ReturnType<typeof b.runner.get>>;
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    // Nothing to keep: no tools, no `evidence` field in the answer the agent is asked for, and no evidence recorded.
    // The schema is not looked at: a QA scenario carries the `evidence` field (`executed`/`read`) whether the stage keeps evidence or not.
    expect(qa.evidence).toBeUndefined();
    expect(Object.values(done.evidence ?? {}).filter((e) => e.stage === 'qa')).toHaveLength(0);
    expect((qa.schema as { properties?: Record<string, unknown> }).properties?.evidence).toBeUndefined();
    expect(qa.system).not.toContain('SaveEvidence');
  });

  it('tells the stage the real folder of its evidence, not a path that only exists in a sandbox', async () => {
    const out = mkdtempSync(join(tmpdir(), 'coxia-host-out-'));
    const { b } = await fullHost(
      (c) => void (c.language = 'en'),
      async (call) => {
        writeFileSync(join(call.exec!.outputDir as string, 'shot.png'), PNG());
        await call.evidence!.save({ path: join(call.exec!.outputDir as string, 'shot.png'), title: 'The screen' });
        return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'See the app', result: 'pass', severity: 'non-blocking', detail: 'Looked', evidenceIds: ['ev-1'] }] });
      },
      { out },
    );
    const qa = b.engine.calls.find((c) => c.agent.id === 'qa')!;
    expect(qa.system).toContain('SaveEvidence');
    expect(qa.system).toContain(out);
    // No `/coxia/out` in any of the texts the stage is given about its output folder: the sandbox path does not exist on this computer, so reading it there
    // sends the agent nowhere. The real folder is named by both the rules of the stage and the tool's own description.
    expect(qa.system).not.toContain('/coxia/out');
    // The wording is resolved, not left as a catalog key: a stage that was asked to keep evidence is told how, in the words of the catalog.
    expect(qa.system).not.toContain('runner.rules.evidence');
  });
});
