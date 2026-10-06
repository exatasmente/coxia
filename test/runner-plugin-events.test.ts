import { describe, expect, it, vi } from 'vitest';
import { type Run } from '../src/shared/runs';
import { runThreadId } from '../src/shared/forum';
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

describe('a run held by a plugin request', () => {
  it('does not start the next stage while a request of the run waits, and goes on once it is answered', async () => {
    let waiting = false;
    const b = await boot({
      pluginEvent: (event) => {
        // The plugin asks the person for something when the first stage finishes.
        if (event === 'stage-finished') waiting = true;
      },
      pluginHold: () => (waiting ? { plugin: 'Web search', need: 'network' } : null),
    });
    easy(b);
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'plan');
    expect(run.status).toBe('waiting');
    expect(run.wait).toMatchObject({ kind: 'plugin', plugin: 'Web search', detail: 'network' });
    // Answered: nothing left holds the run, and the held stage starts.
    waiting = false;
    b.runner.pluginSettled(run.id, { code: 'run.plugin.refused.network', params: { plugin: 'Web search' } });
    await b.settle();
    const after = b.runner.get(run.id)!;
    expect(after.wait).toBeNull();
    expect(after.stage).not.toBe('refine');
    expect(b.forum.read(runThreadId(run.id))?.messages.some((m) => m.code === 'run.plugin.refused.network')).toBe(true);
  });

  it('stays waiting while another request of the run is still open', async () => {
    let open = 2;
    const b = await boot({ pluginEvent: () => undefined, pluginHold: () => (open > 0 ? { plugin: 'Web search', need: 'write' } : null) });
    easy(b);
    let run = await b.runner.start('app#101');
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run.status).toBe('waiting');
    open = 1;
    b.runner.pluginSettled(run.id, null);
    expect(b.runner.get(run.id)!.status).toBe('waiting');
    open = 0;
    b.runner.pluginSettled(run.id, null);
    expect(b.runner.get(run.id)!.status).not.toBe('waiting');
  });

  it('is not let go by the host: a comment on the issue is not the answer, and the sweep only lets it go when no request is left', async () => {
    let open = true;
    const b = await boot({ pluginEvent: () => undefined, pluginHold: () => (open ? { plugin: 'Web search', need: 'network' } : null) });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)!.wait?.kind).toBe('plugin');
    // A host that would say "someone commented" must not be asked about this wait.
    const waitOver = vi.fn(async () => ({ over: true, reply: 'Any news?' }));
    b.deps.publisher = { waitOver } as never;
    expect(await b.runner.tick()).toEqual([]);
    expect(waitOver).not.toHaveBeenCalled();
    expect(b.runner.get(run.id)!.status).toBe('waiting');
    // The answer was given but the release never reached the runner (the app closed in between): the sweep lets the run go.
    open = false;
    b.deps.publisher = undefined;
    expect(await b.runner.tick()).toHaveLength(1);
    expect(b.runner.get(run.id)!.wait).toBeNull();
  });

  it('goes on without answering: the requests are released and no longer hold the run', async () => {
    const released = new Set<string>();
    const b = await boot({ pluginEvent: () => undefined, pluginHold: (id) => (released.has(id) ? null : { plugin: 'Web search', need: 'write' }), pluginRelease: (id) => void released.add(id) });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)!.wait?.kind).toBe('plugin');
    b.runner.skipWait(run.id, 'The search can wait.');
    await b.settle();
    expect(released.has(run.id)).toBe(true);
    expect(b.runner.get(run.id)!.wait?.kind).not.toBe('plugin');
  });
});

describe('what the plugins tell the agents', () => {
  it('reaches every stage of the run as the plugin\'s words, fenced as material', async () => {
    const prompts: string[] = [];
    const b = await boot({ pluginNotes: () => [{ name: 'Web search', note: 'write your questions in SEARCH_REQUESTS.md' }] });
    easy(b);
    b.engine.script('refiner', (call) => (prompts.push(call.prompt), work('Spec.', { artifacts: [doc('1_SPEC.md')] })));
    await b.runner.start('app#101');
    await b.settle();
    expect(prompts[0]).toContain('Web search: write your questions in SEARCH_REQUESTS.md');
    expect(prompts[0]).toMatch(/<data>\nWeb search: write your questions/);
  });

  it('adds nothing when no plugin says anything', async () => {
    const prompts: string[] = [];
    const b = await boot({ pluginNotes: () => [] });
    easy(b);
    b.engine.script('refiner', (call) => (prompts.push(call.prompt), work('Spec.', { artifacts: [doc('1_SPEC.md')] })));
    await b.runner.start('app#101');
    await b.settle();
    expect(prompts[0]).not.toContain('Plugins');
  });
});

