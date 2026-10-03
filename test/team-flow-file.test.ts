import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { addAgent } from '../src/shared/config/team';
import type { AgentDef, StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, agentFlowEngineering, applyTemplate, BUILT_IN_TEMPLATES } from '../src/shared/cycles';
import { checkFlow } from '../src/shared/runs';
import { flowDiagram } from '../src/renderer/src/screens/team/flowDiagram';
import { applyFlows, checkFlows, draftOfFlows, patchStage, renumber } from '../src/renderer/src/screens/team/flowEdit';
import { applyBundle, exportFlowText, readFlowText, STARTERS } from '../src/renderer/src/screens/team/flowFile';

const engineering = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlowEngineering);
const words = { returns: 'returns' };
const label = (a: AgentDef): string => a.id;

describe('the diagram of a flow', () => {
  const c = engineering();
  const code = flowDiagram(c.devCycle.stages, c.agents.team, label, words);

  it('draws every stage as a node, a gate as a hexagon and a wait as a pill', () => {
    const lines = code.split('\n');
    expect(lines[0]).toBe('flowchart TD');
    expect(lines.filter((l) => /^ {2}n\d+[[{(]/.test(l))).toHaveLength(8);
    expect(code).toContain('n1{{"Gate 1"}}');
    const business = applyTemplate(neutralConfig(), agentFlow);
    expect(flowDiagram(business.devCycle.stages, business.agents.team, label, words)).toContain('(["Ready');
  });

  it('puts the agent under the name of a stage that has one', () => {
    expect(code).toContain('n0["Refine<br/>refiner"]');
    expect(code).toContain('n7["Ready"]');
  });

  it('draws the forward arrows solid and the returns dashed, from a gate, a review and a QA pass', () => {
    expect(code).toContain('n0 --> n1');
    expect(code).toContain('n6 --> n7');
    expect(code).not.toContain('n7 -->');
    expect(code).toContain('n1 -.->|"returns"| n0');
    expect(code).toContain('n5 -.->|"returns"| n4');
    expect(code).toContain('n6 -.->|"returns"| n4');
    expect(code.match(/-\.->/g)).toHaveLength(4);
  });

  it('follows an explicit next and leaves out an arrow that points nowhere', () => {
    const stages = patchStage(patchStage(c.devCycle.stages, 'refine', { next: 'plan' }), 'plan', { next: 'gone' });
    const out = flowDiagram(stages, c.agents.team, label, words);
    expect(out).toContain('n0 --> n2');
    expect(out).not.toContain('n2 -->');
  });

  it('cannot be broken by what a person types in a name', () => {
    const stages = patchStage(c.devCycle.stages, 'refine', { label: 'A "quoted" <b>name</b>\n# and more' });
    const out = flowDiagram(stages, c.agents.team, label, words);
    expect(out).toContain('n0["A quoted bname/b #35; and more<br/>refiner"]');
    expect(out.split('\n')).toHaveLength(code.split('\n').length);
  });
});

describe('the starting flows', () => {
  it('are the two agent cycles and a short one, all of them clean', () => {
    expect(STARTERS.map((s) => s.id)).toEqual(['agent-flow', 'agent-flow-engineering', 'agent-flow-short']);
    for (const s of STARTERS) {
      const b = s.bundle();
      expect(checkFlow({ stages: b.stages, team: [...neutralConfig().agents.team, ...b.team] }, { asFlow: true }), s.id).toEqual([]);
    }
  });

  it('the two built in ones are the template flows, by name', () => {
    for (const id of ['agent-flow', 'agent-flow-engineering']) {
      const starter = STARTERS.find((s) => s.id === id)!;
      const template = BUILT_IN_TEMPLATES.find((t) => t.id === id)!;
      expect(starter.name).toBe(template.name);
      expect(starter.bundle().stages).toEqual(template.devCycle.stages);
    }
  });

  it('the short one is the engineering flow without gates, and no stage waits for a person', () => {
    const stages = STARTERS[2].bundle().stages;
    expect(stages.map((s) => s.id)).toEqual(['refine', 'plan', 'implement', 'review', 'qa', 'ready']);
    expect(stages.some((s) => s.type === 'gate')).toBe(false);
    expect(stages.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('applying one replaces the flow, brings the agents the workspace lacks and leaves the ones it has', () => {
    const c = engineering();
    c.agents.team = c.agents.team.map((a) => (a.id === 'developer' ? { ...a, name: 'My developer' } : a));
    const d = applyBundle(draftOfFlows(c), c, null, STARTERS[0].bundle());
    expect(d.workspace.map((s) => s.id)[0]).toBe('triage');
    expect(d.newAgents.map((a) => a.id).sort()).toEqual(['customer-success', 'product-owner', 'support', 'tech-lead']);
    const next = applyFlows(c, d);
    expect(next.agents.team.find((a) => a.id === 'developer')?.name).toBe('My developer');
    expect(checkFlows(c, d, null).errors).toBe(0);
    expect(validateConfig(next).errors).toEqual([]);
  });

  it('comments come only for stages that have none', () => {
    const c = engineering();
    const own = { title: 'mine', status: 'mine', sections: [], technicalDetail: false };
    c.devCycle.comments = { ...c.devCycle.comments, refine: own };
    const d = applyBundle(draftOfFlows(c), c, null, STARTERS[0].bundle());
    expect(d.comments.refine).toBeUndefined();
    expect(d.comments.triage).toBeDefined();
    expect(applyFlows(c, d).devCycle.comments.refine).toEqual(own);
  });
});

describe('the flow file', () => {
  const NOW = new Date('2026-10-03T10:00:00Z');
  const withExtra = (): WorkspaceConfig => {
    let c = engineering();
    c = addAgent(c, { id: 'security', name: 'Security', job: 'Looks for holes', instructions: 'be paranoid', model: { role: null, provider: 'private-gateway', model: 'secret-model' }, stages: ['sec'] });
    c.devCycle.stages = renumber(patchStage([...c.devCycle.stages.slice(0, 5), { id: 'sec', label: 'Security', match: [], kind: 'development', rank: 6, type: 'work', agentId: 'security', produces: ['4b_SEC.md'], returnsTo: 'implement' }, ...c.devCycle.stages.slice(5)], 'sec', {}));
    return c;
  };

  it('holds the flow, the agents of the team that work it and the comments, and nothing about this machine', () => {
    const c = withExtra();
    const text = exportFlowText(c, c.devCycle.stages, { id: 'my-flow', name: 'My flow' }, NOW);
    const file = JSON.parse(text);
    expect(file.format).toBe('coxia-cycle-template');
    expect(file.template.devCycle.stages.map((s: StageDef) => s.id)).toContain('sec');
    expect(file.template.team.map((a: AgentDef) => a.id)).toEqual(['refiner', 'planner', 'developer', 'reviewer', 'qa', 'security']);
    expect(file.template.team.find((a: AgentDef) => a.id === 'security').model).toEqual({ role: 'deep', provider: '', model: '' });
    expect(text).not.toMatch(/private-gateway|secret-model|squad/);
    expect(Object.keys(file.template.devCycle.comments)).toContain('refine');
  });

  it('exported then imported on another workspace gives the same flow', () => {
    const c = withExtra();
    const text = exportFlowText(c, c.devCycle.stages, { id: 'my-flow', name: 'My flow' }, NOW);
    const read = readFlowText(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const other = engineering();
    other.devCycle.stages = [];
    const d = applyBundle({ ...draftOfFlows(other), workspace: [] }, other, null, read.bundle);
    expect(d.workspace).toEqual(c.devCycle.stages);
    expect(d.newAgents.map((a) => a.id)).toEqual(['security']);
    expect(validateConfig(applyFlows(other, d)).errors).toEqual([]);
  });

  it('refuses what is not JSON, not a template, not a flow, or a flow with an error', () => {
    expect(readFlowText('{nope')).toMatchObject({ ok: false });
    expect(readFlowText('[]')).toMatchObject({ ok: false });
    const ceremonies = JSON.stringify({ id: 'x', name: 'X', devCycle: { stages: [{ id: 'a', label: 'A', match: [], kind: 'backlog', rank: 1 }] } });
    expect(readFlowText(ceremonies)).toEqual({ ok: false, errors: [], notFlow: true });
    const c = engineering();
    const text = exportFlowText(c, patchStage(c.devCycle.stages, 'plan', { returnsTo: 'ghost', agentId: 'nobody' }), { id: 'bad', name: 'Bad' }, NOW);
    const bad = readFlowText(text);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toMatch(/ghost|nobody/);
  });

  it('refuses a file that names a built-in agent as its own', () => {
    const c = engineering();
    const file = JSON.parse(exportFlowText(c, c.devCycle.stages, { id: 'x', name: 'X' }, NOW));
    file.template.team = [{ ...c.agents.team[0] }];
    expect(readFlowText(JSON.stringify(file)).ok).toBe(false);
  });
});
