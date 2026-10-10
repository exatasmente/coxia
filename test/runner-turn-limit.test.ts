// A stage that uses its last turn leaves a question instead of failing (#246), through the runner with a scripted engine: the record, the lines of the conversation, the
// two answers, the clocks that stand still while it waits, a cancel during the wait, and a question next to a host command that waits too. The loop's own part is in
// engine-open-turn-limit.test.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCall } from '../src/main/agents';
import { MaxTurnsError } from '../src/main/engine/contract';
import { createTurnAsks } from '../src/main/turnAsks-core';
import { listAudit } from '../src/main/auditoria';
import type { TurnDecision, TurnStop } from '../src/main/engine/contract';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, fakeSandbox, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const stageStop = (over: Partial<TurnStop> = {}): TurnStop => ({ of: 'stage', role: 'refiner', kind: null, name: null, task: '', used: 2, round: 2, granted: 0, canContinue: true, ...over });

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
}

const lines = (b: Boot, run: Run | string): string[] => b.thread(run).map((m) => m.code ?? '').filter((c) => c.startsWith('runner.turns'));

/** What a stage's agent does at its limit: asks, and stops with the failure of running out of turns when the person finishes it. */
const atLimit = (stop: TurnStop = stageStop()) => async (c: AgentCall) => {
  // The model takes a moment before its last turn: the clocks of the stage are running by then.
  await new Promise((r) => setTimeout(r, 40));
  const decision: TurnDecision = await c.turnLimit!.ask(stop, c.abort?.signal);
  if (decision === 'finish') throw new MaxTurnsError('s', []);
  return work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' });
};

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const store = () => createTurnAsks({ changed: () => undefined });

describe('a stage that uses its last turn', () => {
  it('stops at its limit as before when nobody wired the question', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    await b.runner.start('app#101');
    await b.settle();
    expect(b.engine.calls[0].turnLimit).toBeUndefined();
  });

  it('leaves one question and the run keeps working; continue lets it finish normally', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks });
    easy(b);
    b.engine.script('refiner', atLimit());
    const run = await b.runner.start('app#101');
    await until(() => turnAsks.list().length === 1);
    const [ask] = turnAsks.list();
    expect(ask).toMatchObject({ of: 'stage', run: run.id, thread: `run-${run.id}`, ref: 'app#101', issue: 101, stage: 'refine', agent: 'refiner', kind: null, used: 2, round: 2, granted: 0, canContinue: true });
    expect(b.engine.calls[0].turnLimit?.own).toBe(true);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'working', stage: 'refine' });
    expect(lines(b, run)).toEqual(['runner.turns.ask.stage']);
    expect(turnAsks.answer(ask.id, 'continue', 'window')).toEqual({ ok: true });
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1', error: null });
    expect(lines(b, run)).toEqual(['runner.turns.ask.stage', 'runner.turns.continue.stage']);
    expect(turnAsks.list()).toEqual([]);
    expect(listAudit().find((e) => e.kind === 'turn-limit' && e.origin.key === ask.id)).toBeUndefined();
  });

  it('ends with the failure of running out of turns on finish now, which the person retries, and the conversation says it was their answer', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks });
    easy(b);
    b.engine.script('refiner', atLimit(), () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    const run = await b.runner.start('app#101');
    await until(() => turnAsks.list().length === 1);
    turnAsks.answer(turnAsks.list()[0].id, 'finish', 'paired');
    await b.settle();
    const failed = b.runner.get(run.id)!;
    expect(failed).toMatchObject({ status: 'failed', stage: 'refine', error: { code: 'stage-failed', stage: 'refine' } });
    expect(failed.error?.detail).toMatch(/passos|turns/);
    expect(lines(b, run)).toEqual(['runner.turns.ask.stage', 'runner.turns.finish.stage']);
    b.runner.retry(run.id);
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1', error: null });
  });

  it('is still working long after both clocks would have tripped, and finishes within its remaining time after the answer', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks, limits: { idleMs: 150, maxMs: 500 } });
    easy(b);
    b.engine.script('refiner', atLimit());
    const run = await b.runner.start('app#101');
    await until(() => turnAsks.list().length === 1);
    await new Promise((r) => setTimeout(r, 1000));
    expect(b.runner.get(run.id)).toMatchObject({ status: 'working', stage: 'refine', error: null });
    expect(turnAsks.list()).toHaveLength(1);
    turnAsks.answer(turnAsks.list()[0].id, 'continue', 'window');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1', error: null });
  });

  it('ends as cancelled when the run is cancelled during the wait, with no question left and no answer line', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks });
    easy(b);
    b.engine.script('refiner', atLimit());
    const run = await b.runner.start('app#101');
    await until(() => turnAsks.list().length === 1);
    expect(b.runner.cancel(run.id).status).toBe('cancelled');
    await b.settle();
    expect(turnAsks.list()).toEqual([]);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'cancelled' });
    expect(lines(b, run)).toEqual(['runner.turns.ask.stage']);
  });

  it('holds no trace of the question in the run\'s file', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks });
    easy(b);
    b.engine.script('refiner', atLimit(stageStop({ task: 'secret-task-words' })));
    const run = await b.runner.start('app#101');
    await until(() => turnAsks.list().length === 1);
    const id = turnAsks.list()[0].id;
    const files = readdirSync(join(b.dir, 'runs')).filter((f) => f.includes(run.id));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(b.dir, 'runs', f), 'utf8');
      expect(text, f).not.toContain(id);
      expect(text, f).not.toContain('canContinue');
      expect(text, f).not.toContain('secret-task-words');
    }
    turnAsks.answer(id, 'finish', 'window');
    await b.settle();
  });

  it('names the sub-agent in the question of a sub-agent of the stage, with the run and the stage', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks });
    easy(b);
    b.engine.script('refiner', atLimit(stageStop({ of: 'sub', role: 'refiner:explore', kind: 'explore', task: 'map the tests of X', used: 12, round: 12 })));
    const run = await b.runner.start('app#101');
    await until(() => turnAsks.list().length === 1);
    expect(turnAsks.list()[0]).toMatchObject({ of: 'sub', run: run.id, stage: 'refine', agent: 'refiner', kind: 'explore', task: 'map the tests of X', used: 12, round: 12 });
    const asked = b.thread(run).find((m) => m.code === 'runner.turns.ask.sub');
    expect(asked?.params).toMatchObject({ what: 'explore: map the tests of X', used: 12, round: 12 });
    turnAsks.answer(turnAsks.list()[0].id, 'continue', 'window');
    await b.settle();
    expect(lines(b, run)).toEqual(['runner.turns.ask.sub', 'runner.turns.continue.sub']);
  });

  it('waits next to a host command that waits for the person, and neither answer touches the other', async () => {
    const turnAsks = store();
    const b = await boot({ turnAsks, sandbox: fakeSandbox(), configure: (c) => { c.agents.team.find((a) => a.id === 'developer')!.shell = 'host'; } });
    easy(b);
    let finished = false;
    b.engine.script('developer', async (c, tools) => {
      const command = c.exec!.exec('npm test');
      await new Promise((r) => setTimeout(r, 40));
      const decision = await c.turnLimit!.ask(stageStop({ role: 'developer' }), c.abort?.signal);
      expect(decision).toBe('continue');
      const result = await command;
      expect(result).toMatchObject({ exitCode: 0 });
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      finished = true;
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const started = await b.runner.start('app#101');
    await until(() => {
      const r = b.runner.get(started.id)!;
      if (r.status === 'gate') b.runner.gate(r.id, 'approve');
      return turnAsks.list().length === 1 && !!b.runner.get(started.id)!.command;
    }, 20_000);
    const run = b.runner.get(started.id)!;
    // the turn question answered first: the command still waits
    turnAsks.answer(turnAsks.list()[0].id, 'continue', 'window');
    await new Promise((r) => setTimeout(r, 50));
    expect(b.runner.get(run.id)!.command).toBeTruthy();
    expect(finished).toBe(false);
    b.runner.command(run.id, b.runner.get(run.id)!.command!.id, 'once');
    await until(() => finished);
  });
});
