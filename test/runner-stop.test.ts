// The runner when the process is going (#206): a stage gets its deadline to end, is then interrupted and left working, and the next start takes it over as after a kill.
import { describe, expect, it, vi } from 'vitest';
import { installSignalHandlers } from '../src/main/signals';
import { boot, doc, fakeEngine, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const never = (): Promise<never> => new Promise(() => undefined);
const spec = () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' });

describe('stopping the runner', () => {
  it('interrupts a stage that outlives the deadline, leaves the run working and starts nothing more', async () => {
    const b = await boot();
    let aborted = false;
    b.engine.script('refiner', (call) => {
      call.abort?.signal.addEventListener('abort', () => (aborted = true));
      return never();
    });
    const run = await b.runner.start('app#101');
    await vi.waitFor(() => expect(b.engine.calls).toHaveLength(1));

    await b.runner.stop(20);

    expect(aborted).toBe(true);
    // Neither failed nor cancelled: the state the app resumes from after it was closed.
    expect(b.runner.get(run.id)).toMatchObject({ status: 'working', stage: 'refine' });
    expect(b.thread(run).some((m) => m.code === 'run.failed' || m.code === 'run.cancelled')).toBe(false);
    expect(b.runner.get(run.id)!.history.map((h) => h.type)).not.toContain('failed');
    expect(b.engine.calls).toHaveLength(1);
    // The run is not driven after the stop, whatever pokes it.
    b.runner.resume();
    await b.settle();
    expect(b.engine.calls).toHaveLength(1);
  });

  it('lets a stage that ends within the deadline settle, and stops there', async () => {
    const b = await boot();
    let release: () => void = () => undefined;
    b.engine.script('refiner', async () => {
      await new Promise<void>((r) => (release = r));
      return spec();
    });
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
    const run = await b.runner.start('app#101');
    await vi.waitFor(() => expect(b.engine.calls).toHaveLength(1));

    const stopped = b.runner.stop(10_000);
    release();
    await stopped;

    // The stage ended by itself: its result is kept, and nothing was interrupted.
    expect(b.runner.get(run.id)!.stages.find((s) => s.stage === 'refine')).toMatchObject({ status: 'done' });
    expect(b.runner.get(run.id)!.history.map((h) => h.type)).not.toContain('interrupted');
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['refiner']);
  });

  it('returns at once when nothing runs', async () => {
    const b = await boot();
    const started = Date.now();
    await b.runner.stop(10_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('a SIGTERM during a run stops it cleanly and the run resumes at the next start', async () => {
    const first = await boot();
    first.engine.script('refiner', () => never());
    const run = await first.runner.start('app#101');
    await vi.waitFor(() => expect(first.engine.calls).toHaveLength(1));

    // The headless host's path: the signal calls the core's stop, which stops the runner; the exit is the host's.
    const exits: number[] = [];
    const signals = installSignalHandlers({ stop: (o) => first.runner.stop(o?.deadlineMs ?? 0) }, { deadlineMs: 20, exit: (code) => void exits.push(code) });
    try {
      await signals.deliver('SIGTERM');
    } finally {
      signals.dispose();
    }
    expect(exits).toEqual([0]);
    expect(first.runner.get(run.id)).toMatchObject({ status: 'working', stage: 'refine' });

    // The next start: a new runner on the same folders takes the stage over.
    const engine = fakeEngine();
    engine.script('refiner', spec);
    const second = await boot({ repo: first.repo, dir: first.dir, engine, issues: first.issues });
    second.runner.resume();
    await second.settle();
    const resumed = second.runner.get(run.id)!;
    expect(resumed).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(resumed.stages.find((s) => s.stage === 'refine')).toMatchObject({ attempts: 2, status: 'done' });
    expect(resumed.history.map((h) => h.type)).toContain('interrupted');
    expect(second.thread(run).some((m) => m.code === 'run.stage.restarted')).toBe(true);
  });
});
