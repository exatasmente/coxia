// The app's own recording of a QA stage's screen (#157) inside a run: what the agent cannot do with it and where it never goes. The recording is the app's piece of
// evidence: not citeable, not copied into the cycle folder, not sent to the code host. No model, no host, no network: the engine is scripted and the sandbox is the fake.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { putRecording } from '../src/main/evidence/recording';
import { recordEvidence } from '../src/shared/runs';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';
import { webmHead } from './helpers/webm';

vi.setConfig({ testTimeout: 30_000 });

/** A run that already holds a recording of an earlier attempt of the QA stage, and a QA pass that cites it beside its own evidence. */
async function withEarlierRecording(configure: (b: Boot) => void = () => undefined): Promise<{ b: Boot; run: Run; cited: string[] }> {
  const b = await boot({
    sandbox: fakeSandbox(),
    configure: (c) => {
      c.language = 'en';
      c.agents.team.find((a) => a.id === 'qa')!.shell = 'sandbox';
      c.runner.evidence = 'cycle';
    },
  });
  configure(b);
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => {
    // The earlier attempt of QA left a recording; it is on the run before QA starts.
    const run = b.runner.list()[0];
    const put = putRecording(b.deps.env().dataDir, run, { bytes: webmHead(64), stage: 'qa', by: 'qa', title: 'Screen recording', meta: { durationMs: 1000, width: 8, height: 4, marks: [] }, at: '2026-10-08T12:00:00.000Z' });
    if (!put.ok) throw new Error('not kept');
    b.runs.update(run.id, (r) => recordEvidence(r, put.record, '2026-10-08T12:00:00.000Z'));
    return work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  const cited: string[] = [];
  b.engine.script('qa', async (call) => {
    const own = await keepQaEvidence(call);
    // The agent names the recording as its proof, together with its own piece.
    cited.push(...own);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], evidence: ['ev-1', ...own], scenarios: [{ name: 's', result: 'pass', detail: '', evidenceIds: ['ev-1', ...own] }] });
  });
  let run = await b.runner.start('app#101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id) as Run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.stage === 'ready' || run.status === 'done') break;
  }
  return { b, run, cited };
}

describe('the recording of an earlier attempt', () => {
  it('cannot be cited by the agent: the id is unknown, said in the conversation, and dropped from the scenario', async () => {
    const { b, run, cited } = await withEarlierRecording();
    expect(run.status).toBe('done');
    expect(cited).toEqual(['ev-2']);
    const qa = run.qa.at(-1);
    expect(qa?.scenarios[0].evidenceIds).toEqual(['ev-2']);
    const unknown = b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.evidence.unknown');
    expect(unknown.map((m) => m.params.id)).toEqual(['ev-1']);
  });

  it('is never copied into the cycle folder, not even when the workspace chooses to keep evidence there', async () => {
    const { run } = await withEarlierRecording();
    const folder = join(run.worktree, run.cycleFolder, 'evidence');
    expect(readdirSync(folder)).toEqual(['ev-2.txt']);
    expect(existsSync(join(folder, 'ev-1.webm'))).toBe(false);
    expect(run.evidence?.['ev-1']?.inCycle).toBeUndefined();
    expect(run.evidence?.['ev-2']?.inCycle).toBe(true);
  });
});
