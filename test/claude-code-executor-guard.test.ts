import { describe, expect, it } from 'vitest';
import { claudeCodeRaised, executorRaised, refusedPaths } from '../src/main/configScope';
import { StageError, guardExecutor } from '../src/main/runner/executor';
import { neutralConfig } from '../src/shared/config/defaults';
import { flowHash, flowOf } from '../src/shared/runs/flow';
import { TEST_STAGES } from './helpers/config';

const port = (test: boolean) => ({ test: () => test, run: async () => Promise.reject(new Error('no session in a guard test')) });

const withExecutor =(executor: 'claude-code' | 'agent' | undefined) => {
  const c = structuredClone(neutralConfig());
  c.devCycle.stages = [{ ...structuredClone(TEST_STAGES[0]), executor }];
  return c;
};

describe('the guard of a stage that hands its task to a Claude Code session', () => {
  const stage = { executor: 'claude-code' as const };

  it('leaves a stage with the default executor alone, whatever the option says', () => {
    expect(() => guardExecutor({}, neutralConfig(), {})).not.toThrow();
  });

  it('refuses with the option off and never reaches a session', () => {
    expect(() => guardExecutor(stage, neutralConfig(), { claudeCode: port(false) })).toThrow(expect.objectContaining({ code: 'claude-code-off' }));
    expect(() => guardExecutor(stage, neutralConfig(), {})).toThrow(StageError);
  });

  it('refuses a test workspace even with the option on', () => {
    const c = structuredClone(neutralConfig());
    c.runner.claudeCodeTasks = true;
    expect(() => guardExecutor(stage, c, { claudeCode: port(true) })).toThrow(expect.objectContaining({ code: 'claude-code-test' }));
    expect(() => guardExecutor(stage, c, { claudeCode: port(false) })).not.toThrow();
  });
});

describe('the flow of a stage with an executor', () => {
  it('carries the executor only when it is claude-code, so the hash of other flows does not move', () => {
    const plain = withExecutor(undefined);
    const agent = withExecutor('agent');
    const code = withExecutor('claude-code');
    expect(flowOf(plain)[0]).not.toHaveProperty('executor');
    expect(flowOf(agent)[0]).not.toHaveProperty('executor');
    expect(flowOf(code)[0].executor).toBe('claude-code');
    expect(flowHash(flowOf(agent))).toBe(flowHash(flowOf(plain)));
    expect(flowHash(flowOf(code))).not.toBe(flowHash(flowOf(plain)));
  });
});

describe('what a paired browser may do with the executor', () => {
  it('refuses a stage that becomes claude-code, in the cycle and in a flow, and allows going back to the agent', () => {
    const before = withExecutor(undefined);
    const after = withExecutor('claude-code');
    expect(executorRaised(before, after)).toEqual([`devCycle.stages[${after.devCycle.stages[0].id}].executor`]);
    expect(refusedPaths(before, after).some((p) => p.endsWith('.executor') || p.startsWith('devCycle.stages'))).toBe(true);
    after.devCycle.flows = { release: [{ ...after.devCycle.stages[0] }] };
    expect(executorRaised(before, after)).toHaveLength(2);
    expect(executorRaised(after, before)).toEqual([]);
    expect(executorRaised(after, after)).toEqual([]);
  });

  it('refuses the persona turning the option on or choosing the executor, and lets it lower both', () => {
    const before = neutralConfig();
    const on = structuredClone(before);
    on.runner.claudeCodeTasks = true;
    expect(claudeCodeRaised(before, on)).toEqual(['runner.claudeCodeTasks']);
    expect(claudeCodeRaised(on, before)).toEqual([]);
    expect(claudeCodeRaised(withExecutor(undefined), withExecutor('claude-code'))).toHaveLength(1);
    expect(claudeCodeRaised(withExecutor('claude-code'), withExecutor(undefined))).toEqual([]);
  });

  it('refuses the option itself: it is not an editable path', () => {
    const before = neutralConfig();
    const after = structuredClone(before);
    after.runner.claudeCodeTasks = true;
    expect(refusedPaths(before, after)).toContain('runner.claudeCodeTasks');
  });
});
