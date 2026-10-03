// The check of a flow: every error and warning it can give, with its code, the stage or agent it is about and the field to mark; the same check in the
// config validator, and what a stored config with a problem in its flow may and may not do.
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/shared/config';
import type { AgentDef, StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { createTranslator } from '../src/shared/i18n';
import { FLOW_ERRORS, FLOW_WARNINGS, type FlowIssue, checkFlow, flowErrors, flowIssueText } from '../src/shared/runs';
import { agentFlowConfig } from './helpers/runs';

const config = (edit: (c: WorkspaceConfig) => void = () => undefined): WorkspaceConfig => {
  const c = agentFlowConfig();
  edit(c);
  return c;
};
const check = (edit: (c: WorkspaceConfig) => void = () => undefined, asFlow = false): FlowIssue[] => {
  const c = config(edit);
  return checkFlow({ stages: c.devCycle.stages, team: c.agents.team }, { asFlow });
};
const codes = (issues: FlowIssue[]): string[] => issues.map((i) => `${i.severity === 'error' ? 'E' : 'W'}:${i.code}:${i.stage ?? i.agent ?? ''}`);
const stage = (id: string, over: Partial<StageDef> = {}): StageDef => ({ id, label: id, match: [], kind: 'development', rank: 0, type: 'work', ...over });
const byId = (c: WorkspaceConfig, id: string): StageDef => c.devCycle.stages.find((s) => s.id === id) as StageDef;
const agent = (c: WorkspaceConfig, id: string): AgentDef => c.agents.team.find((a) => a.id === id) as AgentDef;
/** The stage loses its agent: it names none, and no agent lists it. */
const orphan = (c: WorkspaceConfig, id: string): void => {
  delete byId(c, id).agentId;
  for (const a of c.agents.team) a.stages = a.stages.filter((s) => s !== id);
};
/** The end stage gets an agent, so the stages a test adds after it are the only thing it is about. */
const staffed = (c: WorkspaceConfig): void => {
  byId(c, 'ready').agentId = 'qa';
};

describe('a flow that is fine', () => {
  it('has nothing to say: the agent cycle, and a cycle of the ceremonies with no flow at all', () => {
    expect(check()).toEqual([]);
    expect(checkFlow({ stages: [{ id: 'todo', label: 'To do', match: [], kind: 'backlog', rank: 1 }], team: [] })).toEqual([]);
  });

  it('says an empty list is a problem only when asked to check it as a flow', () => {
    expect(checkFlow({ stages: [], team: [] })).toEqual([]);
    expect(codes(checkFlow({ stages: [], team: [] }, { asFlow: true }))).toEqual(['E:no-stages:']);
  });
});

describe('the errors', () => {
  it('a work stage with no agent: the stage and the field to mark', () => {
    const issues = check((c) => orphan(c, 'plan'));
    expect(issues).toContainEqual({ severity: 'error', code: 'work-no-agent', stage: 'plan', agent: null, field: 'agentId', params: { stage: 'Plan' } });
    // an agent that lists the stage works it, though the stage does not name it
    expect(check((c) => { delete byId(c, 'plan').agentId; })).toEqual([]);
  });

  it('an agent that is not in the team, and an agent on a gate', () => {
    expect(codes(check((c) => (byId(c, 'plan').agentId = 'ghost')))).toEqual(['E:agent-unknown:plan']);
    expect(codes(check((c) => (byId(c, 'gate1').agentId = 'planner')))).toEqual(['E:agent-on-non-work:gate1']);
  });

  it('a next and a returns-to that point nowhere, and a return to something that is not work', () => {
    expect(check((c) => (byId(c, 'plan').next = 'ghost'))).toContainEqual(expect.objectContaining({ code: 'next-nowhere', stage: 'plan', field: 'next', params: { stage: 'Plan', target: 'ghost' } }));
    expect(check((c) => (byId(c, 'review').returnsTo = 'ghost'))).toContainEqual(expect.objectContaining({ code: 'returns-nowhere', stage: 'review', field: 'returnsTo' }));
    expect(codes(check((c) => (byId(c, 'review').returnsTo = 'gate2')))).toEqual(['E:returns-to-non-work:review']);
  });

  it('a stage nothing reaches', () => {
    const fix = (c: WorkspaceConfig): void => {
      byId(c, 'ready').next = null;
      c.devCycle.stages.push(stage('fix', { agentId: 'developer', next: 'review' }));
    };
    expect(codes(check((c) => { byId(c, 'plan').next = 'implement'; }))).toEqual(['E:unreachable:gate2']);
    expect(codes(check(fix))).toEqual(['E:unreachable:fix']);
    // a stage that only a return reaches is reached
    expect(check((c) => { fix(c); byId(c, 'review').returnsTo = 'fix'; })).toEqual([]);
  });

  it('a flow with no end: every stage goes on to another', () => {
    const issues = check((c) => { staffed(c); byId(c, 'ready').next = 'refine'; });
    expect(codes(issues)).toEqual(['E:no-end:']);
    expect(check((c) => (byId(c, 'ready').next = null))).toEqual([]);
  });

  it('a gate first', () => {
    const issues = check((c) => c.devCycle.stages.unshift(stage('gate0', { type: 'gate' })));
    expect(codes(issues)).toEqual(['E:gate-first:gate0']);
  });

  it('an artifact that is read and not produced by an earlier stage, and a file two stages produce', () => {
    expect(codes(check((c) => (byId(c, 'plan').reads = ['9_NOPE.md'])))).toEqual(['E:artifact-unproduced:plan']);
    // produced by a later stage is not enough
    expect(codes(check((c) => (byId(c, 'plan').reads = ['3_IMPLEMENTATION.md'])))).toEqual(['E:artifact-unproduced:plan']);
    expect(check((c) => (byId(c, 'plan').reads = ['1_SPEC.md', '0_ISSUE.md']))).toEqual([]);
    const dup = check((c) => (byId(c, 'plan').produces = ['1_SPEC.md']));
    expect(dup).toContainEqual(expect.objectContaining({ code: 'artifact-duplicate', stage: 'plan', field: 'produces', params: { stage: 'Plan', file: '1_SPEC.md', other: 'Refine' } }));
  });

  it('a wait with no event, or with half of one', () => {
    const wait = (waitsFor?: StageDef['waitsFor']) => (c: WorkspaceConfig) => {
      Object.assign(byId(c, 'ready'), { type: 'wait', waitsFor });
    };
    expect(codes(check(wait()))).toEqual(['E:wait-no-event:ready']);
    expect(codes(check(wait({ kind: 'label' })))).toEqual(['E:wait-no-event:ready']);
    expect(codes(check(wait({ kind: 'time' })))).toEqual(['E:wait-no-event:ready']);
    expect(check(wait({ kind: 'time', minutes: 5 }))).toEqual([]);
    expect(check(wait({ kind: 'pr-merged' }))).toEqual([]);
    expect(check(wait({ kind: 'label', label: 'shipped' }))).toEqual([]);
  });

  it('a gate or a review with no work stage before it to go back to', () => {
    const issues = check((c) => c.devCycle.stages.splice(0, 1, stage('wait0', { type: 'wait', waitsFor: { kind: 'time', minutes: 1 } })));
    expect(codes(issues)).toContain('E:no-return-target:gate1');
  });

  it('a loop of turnsTo, an agent that turns to itself, and one that turns to nobody', () => {
    const issues = check((c) => {
      agent(c, 'refiner').turnsTo = 'planner';
      agent(c, 'planner').turnsTo = 'developer';
      agent(c, 'developer').turnsTo = 'refiner';
    });
    expect(issues).toContainEqual({ severity: 'error', code: 'turns-loop', stage: null, agent: 'refiner', field: 'turnsTo', params: { agent: 'refiner', agents: 'refiner → planner → developer → refiner' } });
    expect(issues.filter((i) => i.code === 'turns-loop')).toHaveLength(1);
    expect(codes(check((c) => (agent(c, 'qa').turnsTo = 'qa')))).toEqual(['E:turns-self:qa']);
    expect(codes(check((c) => (agent(c, 'qa').turnsTo = 'ghost')))).toEqual(['E:turns-unknown:qa']);
    // a chain that ends at the person, and one that ends at an agent that turns to nobody, are fine
    expect(check((c) => { agent(c, 'refiner').turnsTo = 'planner'; agent(c, 'planner').turnsTo = null; })).toEqual([]);
  });
});

describe('the warnings', () => {
  it('an autonomous agent that works no stage, until a stage names it', () => {
    const idle = (c: WorkspaceConfig) => c.agents.team.push({ ...agent(c, 'qa'), id: 'idle', stages: [] });
    expect(codes(check(idle))).toEqual(['W:agent-idle:idle']);
    expect(check((c) => { idle(c); byId(c, 'qa').agentId = 'idle'; })).toEqual([]);
  });

  it('a gate after the last work stage', () => {
    expect(codes(check((c) => { staffed(c); c.devCycle.stages.push(stage('gate3', { type: 'gate' })); }))).toEqual(['W:gate-last:gate3']);
  });

  it('an end stage that was meant to produce something and has no agent, and no word for a plain end', () => {
    const end = (c: WorkspaceConfig) => { staffed(c); c.devCycle.stages.push(stage('communicate', { produces: ['6_NOTE.md'] })); };
    expect(codes(check(end))).toEqual(['W:end-no-agent:communicate']);
    expect(check((c) => { staffed(c); c.devCycle.stages.push(stage('last')); })).toEqual([]);
  });
});

describe('what the check hands to the editor', () => {
  it('lists only the errors on request', () => {
    const c = config((x) => { orphan(x, 'plan'); staffed(x); x.devCycle.stages.push(stage('gate3', { type: 'gate' })); });
    const input = { stages: c.devCycle.stages, team: c.agents.team };
    expect(checkFlow(input).map((i) => i.severity)).toEqual(['error', 'warning', 'warning']);
    expect(flowErrors(input).map((i) => i.code)).toEqual(['work-no-agent']);
  });

  it('has a message, in both languages, for every code it can give', () => {
    for (const lang of ['en', 'pt-BR'] as const) {
      const t = createTranslator(lang);
      for (const code of [...FLOW_ERRORS, ...FLOW_WARNINGS]) {
        const text = flowIssueText({ code, params: { stage: 'S', target: 'T', file: 'f', other: 'O', agent: 'a', agents: 'a → b' } }, t);
        expect(text, `${lang} ${code}`).not.toContain('flow.check.');
        expect(text, `${lang} ${code}`).not.toMatch(/\{\w+\}/);
      }
    }
    expect(flowIssueText({ code: 'work-no-agent', params: { stage: 'Plan' } }, createTranslator('en'))).toBe('Plan is a work stage with no agent: pick one.');
  });
});

describe('in the config', () => {
  it('an error of the flow is an error of the config with the path of the field, and a warning is a warning', () => {
    const c = config((x) => { byId(x, 'plan').next = 'ghost'; agent(x, 'qa').turnsTo = 'ghost'; });
    const r = validateConfig(c);
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({ path: 'devCycle.stages[2].next', message: 'Plan goes on to "ghost", which is not a stage of the flow.' });
    expect(r.errors.map((e) => e.path)).toContain(`agents.team[${c.agents.team.findIndex((a) => a.id === 'qa')}].turnsTo`);
    expect(validateConfig(config((x) => { staffed(x); x.devCycle.stages.push(stage('gate3', { type: 'gate' })); })).warnings.map((w) => w.path)).toContain('devCycle.stages[8].type');
  });

  it('a stored config is opened with the problem of its flow as a warning, so it is never reset to the defaults', () => {
    const c = config((x) => orphan(x, 'plan'));
    expect(validateConfig(c).ok).toBe(false);
    const stored = validateConfig(c, { tolerateFlow: true });
    expect(stored.ok).toBe(true);
    expect(stored.warnings.map((w) => w.path)).toContain('devCycle.stages[2].agentId');
  });
});

describe('saving a config whose flow has a problem', () => {
  it('is refused when the change is to the flow, and allowed when it is to something else', async () => {
    const { getConfig, reloadConfig, saveConfig, updateConfig } = await import('../src/main/workspaceConfig');
    const { writeConfigFile } = await import('../src/main/config-bootstrap');
    const { ATAS } = await import('../src/main/env');
    saveConfig(config());
    // a change to the flow is held to the checks
    expect(() => updateConfig((c) => { orphan(c, 'plan'); return c; })).toThrow(/no agent/i);
    expect(byId(getConfig(), 'plan').agentId).toBe('planner');
    // a flow that already had the problem when the app opened it is kept, and does not make an unrelated change unsavable
    writeConfigFile(ATAS, config((x) => orphan(x, 'plan')));
    reloadConfig();
    expect(byId(getConfig(), 'plan').agentId).toBeUndefined();
    expect(agent(getConfig(), 'planner').stages).toEqual([]);
    expect(updateConfig((c) => { c.appearance.theme = 'dark'; return c; }).appearance.theme).toBe('dark');
    expect(() => updateConfig((c) => { byId(c, 'review').roundLimit = 3; return c; })).toThrow(/no agent/i);
  });
});
