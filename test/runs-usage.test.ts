import { describe, expect, it } from 'vitest';
import { type StageUsage, addReport, emptyUsage, hasUsage, mergeUsage, recordUsage } from '../src/shared/runs';
import { neutralConfig } from '../src/shared/config';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { flowOf, parseRun, startRun } from '../src/shared/runs';

const AT = '2026-10-03T11:00:00.000Z';

describe('the use of a stage', () => {
  it('adds the reports of its model calls, counting a call only when it had tokens, and keeps the cost null until somebody says one', () => {
    let u = emptyUsage();
    u = addReport(u, { promptTokens: 1000, completionTokens: 100, cachedTokens: 400 });
    expect(u).toEqual({ promptTokens: 1000, completionTokens: 100, cachedTokens: 400, calls: 1, costUsd: null, costEstimated: undefined });
    u = addReport(u, { promptTokens: 500, completionTokens: 50, cachedTokens: 0, costUsd: 0.002 });
    u = addReport(u, { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.001 });
    expect(u).toEqual({ promptTokens: 1500, completionTokens: 150, cachedTokens: 400, calls: 2, costUsd: 0.003, costEstimated: false });
    expect(addReport(emptyUsage(), { promptTokens: -5, completionTokens: Number.NaN, cachedTokens: 3, costUsd: -1 })).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 3, calls: 0, costUsd: null, costEstimated: undefined });
    expect(hasUsage(emptyUsage())).toBe(false);
    expect(hasUsage(u)).toBe(true);
    expect(hasUsage(undefined)).toBe(false);
  });

  it('keeps a cost the provider did not report marked as an estimate, and a charged value over it', () => {
    const estimated = addReport(emptyUsage(), { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.5, costEstimated: true });
    expect(estimated).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, calls: 0, costUsd: 0.5, costEstimated: true });
    // a charged value in the same stage makes the whole stage charged, whatever an estimate added before
    expect(addReport(estimated, { promptTokens: 10, completionTokens: 1, cachedTokens: 0, costUsd: 0.2 }).costEstimated).toBe(false);
    // a report with no cost never changes what the total means
    expect(addReport(estimated, { promptTokens: 10, completionTokens: 1, cachedTokens: 0 })).toMatchObject({ costUsd: 0.5, costEstimated: true });
    expect(emptyUsage().costEstimated).toBeUndefined();
  });

  it('merges the attempts of a stage', () => {
    const a = { promptTokens: 10, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: null };
    const b = { promptTokens: 20, completionTokens: 2, cachedTokens: 5, calls: 2, costUsd: 0.5 };
    expect(mergeUsage(undefined, b)).toEqual(b);
    expect(mergeUsage(a, b)).toEqual({ promptTokens: 30, completionTokens: 3, cachedTokens: 5, calls: 3, costUsd: 0.5, costEstimated: false });
    expect(mergeUsage(a, a).costUsd).toBeNull();
    expect(mergeUsage(a, a).costEstimated).toBeUndefined();
  });

  it('marks an attempt whose only cost was an estimate as estimated, and any charged value as charged', () => {
    const cost = (costUsd: number, costEstimated?: boolean): StageUsage => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, calls: 0, costUsd, ...(costEstimated === undefined ? {} : { costEstimated }) });
    const attempts = [cost(0.01, true), cost(0.02, true)];
    expect(mergeUsage(attempts[0], attempts[1])).toMatchObject({ costUsd: 0.03, costEstimated: true });
    expect(mergeUsage(attempts[0], cost(0.02))).toMatchObject({ costUsd: 0.03, costEstimated: false });
    expect(mergeUsage(cost(0.01), cost(0.02, true))).toMatchObject({ costUsd: 0.03, costEstimated: false });
    // two attempts with no cost at all leave the stage with no cost, and nothing to say about its provenance
    expect(mergeUsage(cost(0.01, true), { promptTokens: 5, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: null })).toMatchObject({ costUsd: 0.01, costEstimated: true });
  });

  it('is recorded on the stage record in any status, and survives the file check', () => {
    const c = applyTemplate(neutralConfig(), agentFlowEngineering);
    const flow = flowOf(c);
    const run = startRun({ id: 'r-abc-0001', issue: { ref: 'app#1', iid: 1, title: 'T', url: null }, repo: 'app', branch: 'cycle/1-t', worktree: '/w', cycleFolder: 'docs/cycles/1-t', cycleId: 'agent-flow' }, flow, AT).run;
    const first = recordUsage(run, run.stage, { promptTokens: 10, completionTokens: 2, cachedTokens: 0, calls: 1, costUsd: null }, AT).run;
    const second = recordUsage(first, run.stage, { promptTokens: 5, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: 0.01 }, AT).run;
    expect(second.stages.find((s) => s.stage === run.stage)?.usage).toEqual({ promptTokens: 15, completionTokens: 3, cachedTokens: 0, calls: 2, costUsd: 0.01, costEstimated: false });
    expect(recordUsage(run, 'nowhere', { promptTokens: 1, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: null }, AT).run.stages).toEqual(run.stages);
    expect(parseRun(JSON.parse(JSON.stringify(second))).ok).toBe(true);
    expect(parseRun(JSON.parse(JSON.stringify(run))).ok).toBe(true);
  });

  it('reads a run written with no provenance as charged, and one written with the estimate as estimated', () => {
    const c = applyTemplate(neutralConfig(), agentFlowEngineering);
    const run = startRun({ id: 'r-abc-0002', issue: { ref: 'app#1', iid: 1, title: 'T', url: null }, repo: 'app', branch: 'cycle/1-t', worktree: '/w', cycleFolder: 'docs/cycles/1-t', cycleId: 'agent-flow' }, flowOf(c), AT).run;
    const withUsage = recordUsage(run, run.stage, { promptTokens: 1, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: 0.02, costEstimated: true }, AT).run;
    const parsed = parseRun(JSON.parse(JSON.stringify(withUsage)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.run.stages.find((s) => s.stage === run.stage)?.usage).toMatchObject({ costUsd: 0.02, costEstimated: true });
    // a record written before the field existed has no provenance and stands for the value that was charged then
    const legacy = JSON.parse(JSON.stringify(withUsage)) as { stages: { usage?: Record<string, unknown> }[] };
    delete legacy.stages[0].usage?.costEstimated;
    const read = parseRun(legacy);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.run.stages[0].usage?.costEstimated).toBeUndefined();
  });
});
