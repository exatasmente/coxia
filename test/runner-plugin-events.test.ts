import { describe, expect, it, vi } from 'vitest';
import { type Run } from '../src/shared/runs';
import { type Boot, boot, doc, work } from './helpers/runner';

// The runner calls a plugin where an event of the fixed catalog already happens: a stage was entered or finished, a gate was decided, the run
// finished. Here the hook is a fake that records the events, so nothing of the plugin service or of a sandbox is involved.

vi.setConfig({ testTimeout: 30_000 });

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

describe('the events a run hands to the plugins', () => {
  it('says a stage entered, a stage finished and the run finished, in that order, as the run goes through the cycle', async () => {
    const seen: { event: string; issue: number }[] = [];
    const b = await boot({ pluginEvent: (event, { run }) => void seen.push({ event, issue: run.issue.iid }) });
    easy(b);
    const run = await b.runner.start('app#101');
    await reach(b, run, 'ready');
    expect(b.runner.get(run.id)!.status).toBe('done');
    const events = seen.map((s) => s.event);
    expect(events).toContain('stage-entered');
    expect(events).toContain('stage-finished');
    expect(events).toContain('run-finished');
    expect(seen.every((s) => s.issue === 101)).toBe(true);
    // the run is entered before its first stage finishes, and the run's end is the last thing said
    expect(events.indexOf('stage-entered')).toBeLessThan(events.indexOf('stage-finished'));
    expect(events.at(-1)).toBe('run-finished');
  });

  it('says a gate was decided, whatever the decision, and nothing when there is no gate', async () => {
    const seen: string[] = [];
    const b = await boot({ pluginEvent: (event) => void seen.push(event) });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('gate');
    await Promise.resolve();
    expect(seen).not.toContain('gate-decided');
    b.runner.gate(run.id, 'skip', 'Trivial change.');
    await Promise.resolve();
    expect(seen).toContain('gate-decided');
  });

  it('says the run finished only once, when the run is cancelled after it ended', async () => {
    const seen: string[] = [];
    const b = await boot({ pluginEvent: (event) => void seen.push(event) });
    easy(b);
    const run = await b.runner.start('app#101');
    await reach(b, run, 'ready');
    expect(seen.filter((e) => e === 'run-finished')).toHaveLength(1);
  });

  it('runs exactly as before without the hook', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    await reach(b, run, 'ready');
    expect(b.runner.get(run.id)).toMatchObject({ status: 'done' });
  });

  it('does not let a hook that throws stop the run', async () => {
    const b = await boot({
      pluginEvent: () => {
        throw new Error('the plugin service is broken');
      },
    });
    easy(b);
    const run = await b.runner.start('app#101');
    await reach(b, run, 'ready');
    expect(b.runner.get(run.id)).toMatchObject({ status: 'done' });
  });
});
