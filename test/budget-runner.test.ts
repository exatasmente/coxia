// The operating budget (#198) at the runner: when the model category or the month is spent no stage starts and nothing starts by itself, the run waits with the reason, and it goes
// on by itself when there is room again; what a stage's model calls cost is handed to the ledger.
import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_BUDGET_WAIT } from '../src/shared/budget';
import { type Boot, boot, doc, fakeIssues, issue, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const REASON = 'Budget: model is at 5.00 of its 5.00 USD limit this month (0.00 USD left).';

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
}

describe('a spent budget at the runner', () => {
  it('starts no stage: the run waits on the budget with the reason, and no model call is made', async () => {
    const hold = { reason: REASON as string | null };
    const b = await boot({ spend: { hold: () => hold.reason, record: () => undefined } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.engine.calls).toHaveLength(0);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'waiting', wait: { kind: 'budget', provider: WORKSPACE_BUDGET_WAIT, detail: REASON } });
    expect(b.thread(run).find((m) => m.code === 'run.stage.wait.workspaceBudget')?.params).toMatchObject({ detail: REASON });
  });

  it('resumes by itself when the limit is raised, with no one touching the run', async () => {
    const hold = { reason: REASON as string | null };
    const b = await boot({ spend: { hold: () => hold.reason, record: () => undefined } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)?.status).toBe('waiting');
    // still spent: the sweep leaves it waiting and makes no call
    await b.runner.tick();
    await b.settle();
    expect(b.runner.get(run.id)?.status).toBe('waiting');
    expect(b.engine.calls).toHaveLength(0);
    hold.reason = null;
    await b.runner.tick();
    await b.settle();
    expect(b.engine.calls.length).toBeGreaterThan(0);
    expect(b.runner.get(run.id)?.wait?.kind).not.toBe('budget');
  });

  it('starts no run by itself while it is spent, and starts them when it is not', async () => {
    const issues = fakeIssues();
    for (const n of [1, 2]) issues.add(issue(n, { labels: ['coxia'] }));
    const hold = { reason: REASON as string | null };
    const b = await boot({ issues, spend: { hold: () => hold.reason, record: () => undefined } });
    easy(b);
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true, triggerLabel: 'coxia', maxConcurrentRuns: 5 } }));
    expect(await b.runner.scan()).toEqual([]);
    expect(b.runs.list()).toHaveLength(0);
    hold.reason = null;
    expect((await b.runner.scan()).length).toBeGreaterThan(0);
  });

  it('hands the ledger what a stage\'s model calls used', async () => {
    const recorded: { cost: number | null; costEstimated?: boolean; about: { run: string; stage: string } }[] = [];
    const b = await boot({ spend: { hold: () => null, record: (u, about) => void recorded.push({ cost: u.costUsd, costEstimated: u.costEstimated, about }) } });
    b.engine.script('refiner', (call) => {
      call.onUsage?.({ promptTokens: 700, completionTokens: 70, cachedTokens: 100, costUsd: 0.002, costEstimated: true });
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] });
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ cost: 0.002, costEstimated: true, about: { run: run.id } });
  });

  it('does nothing different without a budget', async () => {
    const b = await boot();
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.engine.calls.length).toBeGreaterThan(0);
    expect(b.runner.get(run.id)?.wait?.kind).not.toBe('budget');
  });
});
