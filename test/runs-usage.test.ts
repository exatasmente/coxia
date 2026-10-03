import { describe, expect, it } from 'vitest';
import { addReport, emptyUsage, hasUsage, mergeUsage, recordUsage } from '../src/shared/runs';
import { neutralConfig } from '../src/shared/config';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { flowOf, parseRun, startRun } from '../src/shared/runs';

const AT = '2026-10-03T11:00:00.000Z';

describe('the use of a stage', () => {
  it('adds the reports of its model calls, counting a call only when it had tokens, and keeps the cost null until somebody says one', () => {
    let u = emptyUsage();
    u = addReport(u, { promptTokens: 1000, completionTokens: 100, cachedTokens: 400 });
    expect(u).toEqual({ promptTokens: 1000, completionTokens: 100, cachedTokens: 400, calls: 1, costUsd: null });
    u = addReport(u, { promptTokens: 500, completionTokens: 50, cachedTokens: 0, costUsd: 0.002 });
    u = addReport(u, { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0.001 });
    expect(u).toEqual({ promptTokens: 1500, completionTokens: 150, cachedTokens: 400, calls: 2, costUsd: 0.003 });
    expect(addReport(emptyUsage(), { promptTokens: -5, completionTokens: Number.NaN, cachedTokens: 3, costUsd: -1 })).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 3, calls: 0, costUsd: null });
    expect(hasUsage(emptyUsage())).toBe(false);
    expect(hasUsage(u)).toBe(true);
    expect(hasUsage(undefined)).toBe(false);
  });

  it('merges the attempts of a stage', () => {
    const a = { promptTokens: 10, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: null };
    const b = { promptTokens: 20, completionTokens: 2, cachedTokens: 5, calls: 2, costUsd: 0.5 };
    expect(mergeUsage(undefined, b)).toEqual(b);
    expect(mergeUsage(a, b)).toEqual({ promptTokens: 30, completionTokens: 3, cachedTokens: 5, calls: 3, costUsd: 0.5 });
    expect(mergeUsage(a, a).costUsd).toBeNull();
  });

  it('is recorded on the stage record in any status, and survives the file check', () => {
    const c = applyTemplate(neutralConfig(), agentFlowEngineering);
    const flow = flowOf(c);
    const run = startRun({ id: 'r-abc-0001', issue: { ref: 'app#1', iid: 1, title: 'T', url: null }, repo: 'app', branch: 'cycle/1-t', worktree: '/w', cycleFolder: 'docs/cycles/1-t', cycleId: 'agent-flow' }, flow, AT).run;
    const first = recordUsage(run, run.stage, { promptTokens: 10, completionTokens: 2, cachedTokens: 0, calls: 1, costUsd: null }, AT).run;
    const second = recordUsage(first, run.stage, { promptTokens: 5, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: 0.01 }, AT).run;
    expect(second.stages.find((s) => s.stage === run.stage)?.usage).toEqual({ promptTokens: 15, completionTokens: 3, cachedTokens: 0, calls: 2, costUsd: 0.01 });
    expect(recordUsage(run, 'nowhere', { promptTokens: 1, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: null }, AT).run.stages).toEqual(run.stages);
    expect(parseRun(JSON.parse(JSON.stringify(second))).ok).toBe(true);
    expect(parseRun(JSON.parse(JSON.stringify(run))).ok).toBe(true);
  });
});
