// The flow as data (schema 7): the stage fields, their defaults, the migration of the stages the agent cycle had before, and the copy a run keeps.
import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { migrateConfig } from '../src/shared/config/migrations';
import { agentFlowTeam } from '../src/shared/cycles';
import { AGENT_FLOW_STAGES } from '../src/shared/cycles/templates/agentFlow';
import { applyTemplate, parseTemplate } from '../src/shared/cycles';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { flowHash, flowOf, flowOfRun, isFlowCycle, snapshotOf, startRun } from '../src/shared/runs';
import { agentFlowConfig, agentFlowStages, startInput, AT } from './helpers/runs';

type Doc = Record<string, any>;

// The stages of the agent cycle as the app wrote them before the stages were a flow (schema 6): `human` for a gate, `artifacts` for what a stage produces.
const V6_STAGES = [
  { id: 'refine', label: 'Refine', match: ['^Refin'], kind: 'backlog', rank: 1, agentId: 'refiner', artifacts: ['1_SPEC.md'] },
  { id: 'gate1', label: 'Gate 1', match: ['^Gate 1$'], kind: 'backlog', rank: 2, human: true },
  { id: 'plan', label: 'Plan', match: ['^Plan'], kind: 'development', rank: 3, agentId: 'planner', artifacts: ['2_PLAN.md'] },
  { id: 'gate2', label: 'Gate 2', match: ['^Gate 2$'], kind: 'development', rank: 4, human: true },
  { id: 'implement', label: 'Implement', match: ['^Implement'], kind: 'development', rank: 5, agentId: 'developer', artifacts: ['3_IMPLEMENTATION.md'] },
  { id: 'review', label: 'Review', match: ['^Review'], kind: 'review', rank: 6, agentId: 'reviewer', artifacts: ['4_REVIEW.md'] },
  { id: 'qa', label: 'QA', match: ['^QA$'], kind: 'qa', rank: 7, agentId: 'qa', artifacts: ['5_TEST_PLAN.md'] },
  { id: 'ready', label: 'Ready', match: ['^Ready$'], kind: 'reviewApproved', rank: 8 },
];

const v6Doc = (stages: unknown[] = V6_STAGES): Doc => {
  const c = structuredClone(agentFlowConfig()) as unknown as Doc;
  c.schemaVersion = 6;
  c.devCycle.stages = structuredClone(stages);
  return c;
};

describe('migrating the stages of an agent cycle to a flow (schema 7)', () => {
  it('turns what the runner did by itself into fields, so a run behaves as it did', () => {
    const r = migrateConfig(v6Doc(), { legacyInstall: false });
    expect(r.fromVersion).toBe(6);
    expect(r.config.schemaVersion).toBe(7);
    expect(validateConfig(r.config).ok).toBe(true);
    // the same stages the agent cycle template brings now: gates are typed, the review and QA return to the developer's stage after two rounds
    expect(r.config.devCycle.stages).toEqual(AGENT_FLOW_STAGES);
    expect(r.notes.join(' ')).toContain('became a flow');
  });

  it('lists the stages in the order a run goes through them: they were ordered by rank', () => {
    const shuffled = [V6_STAGES[7], V6_STAGES[3], V6_STAGES[0], V6_STAGES[6], V6_STAGES[1], V6_STAGES[5], V6_STAGES[2], V6_STAGES[4]];
    const r = migrateConfig(v6Doc(shuffled), { legacyInstall: false });
    expect(r.config.devCycle.stages.map((s) => s.id)).toEqual(['refine', 'gate1', 'plan', 'gate2', 'implement', 'review', 'qa', 'ready']);
    expect(r.notes.join(' ')).toContain('ordered by rank');
  });

  it('drops the agent of the stage where the run ended: it never worked it', () => {
    const stages = V6_STAGES.map((s) => (s.id === 'ready' ? { ...s, agentId: 'qa' } : s));
    const r = migrateConfig(v6Doc(stages), { legacyInstall: false });
    expect(r.config.devCycle.stages.find((s) => s.id === 'ready')).not.toHaveProperty('agentId');
  });

  it('sends a QA failure to the first stage whose agent changes files, and leaves the return alone when there is none', () => {
    const doc = v6Doc();
    doc.agents.team = doc.agents.team.map((a: Doc) => (a.id === 'developer' ? { ...a, permission: 'read' } : a));
    const r = migrateConfig(doc, { legacyInstall: false });
    expect(r.config.devCycle.stages.find((s) => s.id === 'qa')).not.toHaveProperty('returnsTo');
    expect(r.config.devCycle.stages.find((s) => s.id === 'review')).toMatchObject({ returnsTo: 'implement', roundLimit: 2 });
  });

  it('leaves a cycle of the ceremonies alone: no stage of it has a type', () => {
    const doc = structuredClone(neutralConfig()) as unknown as Doc;
    doc.schemaVersion = 6;
    doc.devCycle.stages = [{ id: 'todo', label: 'To do', match: ['^To do$'], kind: 'backlog', rank: 1 }, { id: 'done', label: 'Done', match: ['^Done$'], kind: 'done', rank: 2 }];
    const r = migrateConfig(doc, { legacyInstall: false });
    expect(r.config.devCycle.stages).toEqual(doc.devCycle.stages);
    expect(isFlowCycle(r.config.devCycle.stages)).toBe(false);
  });

  it('reads a template file written before the stages were a flow', () => {
    const file = { id: 'old', name: 'Old', description: '', needs: [], devCycle: { templateId: 'old', stages: V6_STAGES.slice(0, 3) }, team: agentFlowTeam().slice(0, 2) };
    const r = parseTemplate(file);
    expect(r.errors).toEqual([]);
    const stages = (r.template?.devCycle.stages ?? []) as StageDef[];
    expect(stages.map((s) => [s.id, s.type, s.produces ?? null])).toEqual([['refine', 'work', ['1_SPEC.md']], ['gate1', 'gate', null], ['plan', 'work', ['2_PLAN.md']]]);
    expect(stages[0]).not.toHaveProperty('artifacts');
  });
});

describe('the fields of a stage', () => {
  const edit = (change: (stages: StageDef[]) => void): WorkspaceConfig => {
    const c = agentFlowConfig();
    change(c.devCycle.stages);
    return c;
  };

  it('are accepted when they say something and refused when they say nonsense', () => {
    const c = edit((s) => {
      s[0].reads = [];
      s[0].next = 'gate1';
      s[2].roundLimit = 3;
      s[7] = { ...s[7], type: 'wait', waitsFor: { kind: 'time', minutes: 30 }, comment: null, trackerStatus: 'coxia-ready' };
    });
    expect(validateConfig(c).errors).toEqual([]);
    for (const bad of [{ roundLimit: 0 }, { type: 'stop' }, { waitsFor: { kind: 'rain' } }, { waitsFor: { kind: 'time', minutes: 0 } }, { next: 'Not An Id' }, { reads: ['../x'] }]) {
      expect(validateConfig(edit((s) => Object.assign(s[0], bad))).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('are filled with their defaults when a flow is read: the next in the list, the work stage nearest before, the stage id as the comment key, two rounds', () => {
    const flow = agentFlowStages();
    expect(flow.map((s) => [s.id, s.type, s.next])).toEqual([
      ['refine', 'work', 'gate1'],
      ['gate1', 'gate', 'plan'],
      ['plan', 'work', 'gate2'],
      ['gate2', 'gate', 'implement'],
      ['implement', 'work', 'review'],
      ['review', 'work', 'qa'],
      ['qa', 'work', 'ready'],
      ['ready', 'work', null],
    ]);
    expect(flow.map((s) => [s.id, s.returnsTo])).toEqual([['refine', null], ['gate1', 'refine'], ['plan', 'refine'], ['gate2', 'plan'], ['implement', 'plan'], ['review', 'implement'], ['qa', 'implement'], ['ready', 'qa']]);
    expect(flow.every((s) => s.roundLimit === 2 && s.reads === null && s.waitsFor === null && s.trackerStatus === null)).toBe(true);
    expect(flow.find((s) => s.id === 'review')?.comment).toBe('review');
  });

  it('can end the run in the middle, name another next stage and name another comment, or none', () => {
    const c = edit((s) => {
      s[1].next = 'implement';
      s[4].next = null;
      s[0].comment = 'plan';
      s[2].comment = '';
    });
    const flow = flowOf(c);
    expect(flow.find((s) => s.id === 'gate1')?.next).toBe('implement');
    expect(flow.find((s) => s.id === 'implement')?.next).toBeNull();
    expect(flow.find((s) => s.id === 'refine')?.comment).toBe('plan');
    expect(flow.find((s) => s.id === 'plan')?.comment).toBeNull();
  });

  it('a stage with no type is work, and a gate or a wait has no agent', () => {
    const c = edit((s) => {
      delete s[2].type;
      s[1].agentId = 'refiner';
    });
    const flow = flowOf(c);
    expect(flow.find((s) => s.id === 'plan')).toMatchObject({ type: 'work', agent: 'planner' });
    expect(flow.find((s) => s.id === 'gate1')).toMatchObject({ type: 'gate', agent: null });
  });
});

describe('the copy of the flow a run keeps', () => {
  const started = () => startRun(startInput(), agentFlowStages(), AT).run;

  it('is made when the run starts, with a version that says which flow it is', () => {
    const run = started();
    expect(run.flow?.stages.map((s) => s.id)).toEqual(agentFlowStages().map((s) => s.id));
    expect(run.flow?.hash).toBe(flowHash(agentFlowStages()));
    expect(run.flow?.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('has a version that changes with the stages and not with what an agent is set to do', () => {
    const a = agentFlowConfig();
    const hash = snapshotOf(flowOf(a)).hash;
    a.agents.team.find((x) => x.id === 'planner')!.autonomous = false;
    expect(snapshotOf(flowOf(a)).hash).toBe(hash);
    a.devCycle.stages[5].roundLimit = 5;
    expect(snapshotOf(flowOf(a)).hash).not.toBe(hash);
  });

  it('is what the run follows after the cycle is edited, with the agents as they are now', () => {
    const run = started();
    const c = agentFlowConfig();
    c.devCycle.stages.splice(3, 1); // gate 2 removed
    c.agents.team.find((x) => x.id === 'developer')!.autonomous = false;
    const flow = flowOfRun(run, c);
    expect(flow.map((s) => s.id)).toContain('gate2');
    expect(flow.find((s) => s.id === 'implement')).toMatchObject({ agent: 'developer', autonomous: false });
    expect(flowOf(c).map((s) => s.id)).not.toContain('gate2');
  });

  it('puts the agent the cycle names today in the place of one that left the team', () => {
    const run = started();
    const c = agentFlowConfig();
    c.agents.team = c.agents.team.filter((x) => x.id !== 'planner');
    c.devCycle.stages.find((s) => s.id === 'plan')!.agentId = 'refiner';
    expect(flowOfRun(run, c).find((s) => s.id === 'plan')?.agent).toBe('refiner');
    c.devCycle.stages.find((s) => s.id === 'plan')!.agentId = 'ghost';
    expect(flowOfRun(run, c).find((s) => s.id === 'plan')?.agent).toBeNull();
  });

  it('is absent from a run written before: that run follows the current flow', () => {
    const { flow: _gone, ...old } = started();
    expect(old).not.toHaveProperty('flow');
    const c = agentFlowConfig();
    c.devCycle.stages.splice(3, 1);
    expect(flowOfRun({}, c).map((s) => s.id)).not.toContain('gate2');
  });
});
