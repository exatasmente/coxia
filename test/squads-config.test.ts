// The squad model: the fields in the config, what validation says about them (every code, with the field to mark), the chain of who turns to whom
// inside a squad, and the pure edits. Nothing here starts a run.
import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { addSquad, flowStagesOf, hasSquads, liaisonFor, membersOf, newSquad, removeSquad, scopedTeam, setAgentSquad, squadView, turnTarget, updateSquad } from '../src/shared/config/squads';
import { addAgent, removeAgent } from '../src/shared/config/team';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import { agentFlowEngineering, applyTemplate, templateFromConfig } from '../src/shared/cycles';
import { createTranslator } from '../src/shared/i18n';
import { SQUAD_ERRORS, SQUAD_WARNINGS, checkSquads, flowOf, squadErrors, squadIssueText, type SquadIssue } from '../src/shared/runs';
import { withSquads } from './helpers/squads';

const config = (edit: (c: WorkspaceConfig) => void = () => undefined): WorkspaceConfig => withSquads(neutralConfig(), edit);
const input = (c: WorkspaceConfig) => ({ squads: c.squads ?? [], team: c.agents.team, stages: c.devCycle.stages, flows: c.devCycle.flows });
const check = (edit: (c: WorkspaceConfig) => void = () => undefined): SquadIssue[] => checkSquads(input(config(edit)), { checkSharedFlow: true });
const codes = (issues: SquadIssue[]): string[] => issues.map((i) => `${i.severity === 'error' ? 'E' : 'W'}:${i.code}:${i.agent ?? i.squad ?? ''}`);
const agent = (c: WorkspaceConfig, id: string): AgentDef => c.agents.team.find((a) => a.id === id) as AgentDef;

describe('the squads in the config', () => {
  it('a workspace with none has an empty list and no flows of its own, and validates', () => {
    const c = withConfigDefaults({});
    expect(c.squads).toEqual([]);
    expect(c.devCycle.flows).toEqual({});
    expect(hasSquads(c)).toBe(false);
    expect(validateConfig(c).errors).toEqual([]);
    // an older file that has neither field reads the same
    const { squads: _s, ...older } = neutralConfig();
    const { flows: _f, ...cycle } = older.devCycle;
    expect(validateConfig({ ...older, devCycle: cycle }).errors).toEqual([]);
  });

  it('a squad is completed with its defaults, and the example workspace validates without errors', () => {
    expect(newSquad({ id: 'x' })).toEqual({ id: 'x', name: 'x', mission: '', scope: { repos: [], labels: [], paths: [], unclaimed: false }, liaison: null, autonomy: true, label: null });
    const partial = withConfigDefaults({ squads: [{ id: 'x', name: 'X' }] } as never);
    expect(partial.squads?.[0].scope).toEqual({ repos: [], labels: [], paths: [], unclaimed: false });
    const r = validateConfig(config());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('an agent belongs to one squad at most: the field is one id, so a list is refused by the schema', () => {
    const c = config();
    (agent(c, 'dev-a') as unknown as { squad: unknown }).squad = ['a', 'b'];
    expect(validateConfig(c).errors.map((e) => e.path)).toContain('agents.team[' + c.agents.team.findIndex((a) => a.id === 'dev-a') + '].squad');
  });

  it('describes every squad field in the schema', () => {
    const squads = CONFIG_SCHEMA.properties?.squads;
    expect(Object.keys(squads?.items?.properties ?? {})).toEqual(['id', 'name', 'mission', 'scope', 'liaison', 'autonomy', 'label']);
    expect(squads?.items?.required).toEqual(['id', 'name']);
    expect(Object.keys(squads?.items?.properties?.scope.properties ?? {})).toEqual(['repos', 'labels', 'paths', 'unclaimed']);
    expect(CONFIG_SCHEMA.properties?.devCycle.properties?.flows?.description).toBeTruthy();
  });

  it('reads the members, the shared agents and the flow of a squad', () => {
    const c = config();
    expect(membersOf(c, 'a').map((a) => a.id)).toEqual(['dev-a', 'lead-a']);
    expect(scopedTeam(c, 'b').map((a) => a.id)).toEqual([...c.agents.team.filter((a) => a.system || a.id === 'support').map((a) => a.id), 'dev-b', 'sec-b', 'lead-b'].sort((x, y) => c.agents.team.findIndex((a) => a.id === x) - c.agents.team.findIndex((a) => a.id === y)));
    expect(flowStagesOf(c, 'a')).toBe(c.devCycle.stages);
    expect(flowStagesOf(c, 'b').map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(flowStagesOf(c, null)).toBe(c.devCycle.stages);
  });

  it('resolves a squad\'s flow with its own stages and only its members and the shared agents as workers', () => {
    const c = config();
    const a = flowOf(squadView(c, 'a'), squadView(c, 'a').devCycle.stages);
    const b = flowOf(squadView(c, 'b'), squadView(c, 'b').devCycle.stages);
    expect(a.map((s) => [s.id, s.agent])).toEqual([['triage', 'support'], ['implement', 'dev-a'], ['ready', null]]);
    expect(b.map((s) => [s.id, s.agent])).toEqual([['triage', 'support'], ['implement', 'dev-b'], ['security', 'sec-b'], ['ready', null]]);
  });
});

describe('what validation says', () => {
  it('has nothing to say about the example workspace but the idle liaisons', () => {
    expect(codes(check())).toEqual([]);
  });

  it('an agent in a squad that is not there', () => {
    const issues = check((c) => (agent(c, 'dev-a').squad = 'ghost'));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'agent-squad-missing', agent: 'dev-a', field: 'squad', params: { agent: 'dev-a', target: 'ghost' } }));
  });

  it('a squad with members and no liaison; a liaison that is not a member or not in the team', () => {
    expect(codes(check((c) => ((c.squads ?? [])[0].liaison = null)))).toContain('E:no-liaison:a');
    expect(codes(check((c) => ((c.squads ?? [])[0].liaison = 'lead-b')))).toContain('E:liaison-not-member:lead-b');
    expect(codes(check((c) => ((c.squads ?? [])[0].liaison = 'ghost')))).toContain('E:liaison-unknown:a');
    // a squad with no members needs no liaison, and says it has no members
    expect(codes(check((c) => { c.squads?.push(newSquad({ id: 'empty', name: 'Empty' })); }))).toEqual(['W:squad-empty:empty', 'W:scope-empty:empty']);
  });

  it('overlapping scopes are allowed and reported as a warning', () => {
    const issues = check((c) => {
      (c.squads ?? [])[1].scope.repos = ['app', 'web'];
      (c.squads ?? [])[0].scope.labels = ['Billing'];
      (c.squads ?? [])[1].scope.labels = ['billing'];
    });
    const overlap = issues.filter((i) => i.code === 'scope-overlap');
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toMatchObject({ severity: 'warning', squad: 'b', field: 'scope' });
    expect(overlap[0].params.what).toBe('app, #Billing');
    expect(squadErrors(input(config((c) => ((c.squads ?? [])[1].scope.repos = ['app']))))).toEqual([]);
    // folders of one repository overlap when one is inside the other
    const paths = check((c) => {
      (c.squads ?? [])[0].scope = { repos: [], labels: [], paths: [{ repo: 'mono', prefix: 'services' }], unclaimed: false };
      (c.squads ?? [])[1].scope = { repos: [], labels: [], paths: [{ repo: 'mono', prefix: 'services/billing/' }], unclaimed: false };
    });
    expect(paths).toContainEqual(expect.objectContaining({ code: 'scope-overlap', params: expect.objectContaining({ what: 'mono:services' }) }));
  });

  it('a scope that is empty, one that names a repository the workspace lacks, and two squads that take what nobody claims', () => {
    expect(codes(check((c) => ((c.squads ?? [])[0].scope = newSquad({ id: 'x' }).scope)))).toContain('W:scope-empty:a');
    const c = config((x) => ((x.squads ?? [])[0].scope.paths = [{ repo: 'mono', prefix: 'a' }]));
    const known = checkSquads({ ...input(c), repos: ['app', 'web'] });
    expect(known).toContainEqual(expect.objectContaining({ code: 'scope-repo-unknown', squad: 'a', params: expect.objectContaining({ what: 'mono' }) }));
    const both = check((x) => (x.squads ?? []).forEach((s) => (s.scope.unclaimed = true)));
    expect(both).toContainEqual(expect.objectContaining({ code: 'several-unclaimed', squad: 'b', params: { squad: 'Squad B', other: 'Squad A' } }));
  });

  it('a squad id used twice and a flow for something that is not a squad', () => {
    expect(codes(check((c) => c.squads?.push(newSquad({ id: 'a', name: 'Again' }))))).toContain('E:squad-duplicate:a');
    const issues = check((c) => ((c.devCycle.flows ?? {}).ghost = c.devCycle.stages));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'flow-unknown-squad', field: 'flows', params: { squad: 'ghost' } }));
  });

  it('each squad flow passes the flow check with the squad\'s members and the shared agents', () => {
    // B's own flow names an agent of A: it is not one B may use
    const named = check((c) => ((c.devCycle.flows ?? {}).b.find((s) => s.id === 'implement') as { agentId?: string }).agentId = 'dev-a');
    expect(named).toContainEqual(expect.objectContaining({ severity: 'error', code: 'agent-unknown', squad: 'b', stage: 'implement', flow: true, ownFlow: true }));
    // a stage no member of the squad works
    const orphan = check((c) => (agent(c, 'dev-b').stages = []));
    expect(orphan).toContainEqual(expect.objectContaining({ severity: 'error', code: 'work-no-agent', squad: 'b', stage: 'implement' }));
    // the workspace flow, followed by a squad that has none of its own, is checked for that squad too
    const shared = check((c) => (agent(c, 'dev-a').stages = []));
    expect(shared).toContainEqual(expect.objectContaining({ code: 'work-no-agent', squad: 'a', stage: 'implement', ownFlow: false }));
    // an own flow with a broken return
    const broken = check((c) => ((c.devCycle.flows ?? {}).b.find((s) => s.id === 'security') as { returnsTo?: string }).returnsTo = 'nowhere');
    expect(broken).toContainEqual(expect.objectContaining({ code: 'returns-nowhere', squad: 'b', stage: 'security', field: 'returnsTo' }));
  });

  it('a question between squads goes through the liaisons: an agent cannot turn to a member of another squad', () => {
    expect(check((c) => (agent(c, 'dev-a').turnsTo = 'dev-b'))).toContainEqual(expect.objectContaining({ severity: 'error', code: 'turns-other-squad', squad: 'a', agent: 'dev-a', field: 'turnsTo' }));
    // a shared agent in the chain is fine
    expect(codes(check((c) => (agent(c, 'lead-a').turnsTo = 'support')))).toEqual([]);
  });

  it('the chain inside a squad ends at its liaison and then the person', () => {
    // the liaison turning to its own member would send the question back to the liaison
    expect(codes(check((c) => (agent(c, 'lead-a').turnsTo = 'dev-a')))).toContain('E:liaison-turns-inside:lead-a');
    // a member that leaves for a shared agent skips the liaison
    expect(check((c) => (agent(c, 'dev-a').turnsTo = 'support'))).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'chain-skips-liaison', agent: 'dev-a', squad: 'a' }));
    // through a member to the liaison is fine, whether or not the person is the explicit end
    expect(codes(check((c) => (agent(c, 'dev-a').turnsTo = 'lead-a')))).toEqual([]);
    // a circle that exists only because the runtime adds the liaison hop: liaison to shared agent, shared agent to a member
    const circle = check((c) => {
      agent(c, 'lead-a').turnsTo = 'support';
      agent(c, 'support').turnsTo = 'dev-a';
    });
    expect(circle).toContainEqual(expect.objectContaining({ severity: 'error', code: 'chain-loop' }));
  });

  it('is the same check in the config validator, with a path to the field', () => {
    const c = config((x) => {
      (x.squads ?? [])[0].liaison = null;
      agent(x, 'dev-b').squad = 'ghost';
      (x.devCycle.flows ?? {}).b.find((s) => s.id === 'security')!.returnsTo = 'nowhere';
    });
    const r = validateConfig(c);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['squads[0].liaison', `agents.team[${c.agents.team.findIndex((a) => a.id === 'dev-b')}].squad`, 'devCycle.flows.b[2].returnsTo']));
    expect(r.ok).toBe(false);
    // a stored config is never refused for them (the runner will not start on them, the editor shows them), as for the flow
    const tolerated = validateConfig(c, { tolerateFlow: true });
    expect(tolerated.errors).toEqual([]);
    expect(tolerated.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['squads[0].liaison']));
  });

  it('knows an agent that works a stage of a squad\'s own flow only: not idle, and the stage is one an agent may list', () => {
    const c = config();
    expect(agent(c, 'sec-b').stages).toEqual(['security']);
    expect(validateConfig(c).errors).toEqual([]);
    expect(validateConfig(c).warnings.map((w) => w.message).filter((m) => m.includes('sec-b'))).toEqual([]);
  });

  it('words every code in both languages, with the squad and the stage named', () => {
    const en = createTranslator('en');
    const pt = createTranslator('pt-BR');
    const sample = { squad: 'Squad A', other: 'Squad B', agent: 'dev-a', target: 'x', what: 'app', agents: 'a → b → a', detail: '' };
    for (const code of [...SQUAD_ERRORS, ...SQUAD_WARNINGS]) {
      for (const tr of [en, pt]) expect(squadIssueText({ code, params: sample, flow: false }, tr), code).not.toBe(`squad.check.${code}`);
    }
    const flowText = squadIssueText({ code: 'work-no-agent', params: { stage: 'Plan', squad: 'Squad A' }, flow: true }, en);
    expect(flowText).toBe('Flow of Squad A: Plan is a work stage with no agent: pick one.');
    expect(squadIssueText({ code: 'work-no-agent', params: { stage: 'Plan', squad: 'Squad A' }, flow: true }, pt)).toContain('Fluxo de Squad A');
  });
});

describe('the runtime chain of a squad', () => {
  const view = (c: WorkspaceConfig) => c;

  it('a member that turns to the person goes through its liaison first; the liaison and a shared agent go to the person', () => {
    const c = config();
    expect(turnTarget(view(c), agent(c, 'dev-a'))).toBe('lead-a');
    expect(turnTarget(view(c), agent(c, 'lead-a'))).toBeNull();
    expect(turnTarget(view(c), agent(c, 'support'))).toBeNull();
    expect(liaisonFor(c, agent(c, 'dev-b'))).toBe('lead-b');
    expect(liaisonFor(c, agent(c, 'lead-b'))).toBeNull();
  });

  it('an explicit turnsTo wins, and a workspace with no squads is exactly as before', () => {
    const c = config((x) => (agent(x, 'dev-a').turnsTo = 'support'));
    expect(turnTarget(c, agent(c, 'dev-a'))).toBe('support');
    const plain = neutralConfig();
    plain.agents.team.push({ ...agent(config(), 'dev-a'), squad: undefined, turnsTo: null });
    expect(turnTarget(plain, plain.agents.team.at(-1) as AgentDef)).toBeNull();
    expect(turnTarget(plain, { ...(plain.agents.team.at(-1) as AgentDef), turnsTo: 'turn' })).toBe('turn');
  });

  it('a liaison that is not in the team, or not a member, is not used', () => {
    const c = config((x) => ((x.squads ?? [])[0].liaison = 'lead-b'));
    expect(turnTarget(c, agent(c, 'dev-a'))).toBeNull();
  });
});

describe('the edits', () => {
  it('adds, updates and removes a squad; removing makes the members shared and drops its flow', () => {
    let c = neutralConfig();
    c = addAgent(c, { id: 'worker' });
    c = addSquad(c, { id: 'core', name: 'Core', scope: { repos: ['app'] } });
    expect(() => addSquad(c, { id: 'core' })).toThrow('core');
    expect(() => addSquad(c, { id: 'Bad Id' })).toThrow('Bad Id');
    c = setAgentSquad(c, 'worker', 'core');
    c = updateSquad(c, 'core', { liaison: 'worker', mission: 'Core things.' });
    expect(c.squads?.[0]).toMatchObject({ liaison: 'worker', mission: 'Core things.', scope: { repos: ['app'] } });
    expect(() => updateSquad(c, 'ghost', {})).toThrow('ghost');
    expect(() => setAgentSquad(c, 'worker', 'ghost')).toThrow('ghost');
    c.devCycle.flows = { core: [] };
    const removed = removeSquad(c, 'core');
    expect(removed.squads).toEqual([]);
    expect(removed.devCycle.flows).toEqual({});
    expect(removed.agents.team.find((a) => a.id === 'worker')?.squad).toBeUndefined();
    // the original is untouched
    expect(c.squads).toHaveLength(1);
  });

  it('an agent that leaves a squad stops being its liaison, and a removed agent leaves its squad without one', () => {
    const c = config();
    expect(setAgentSquad(c, 'lead-a', 'b').squads?.[0].liaison).toBeNull();
    expect(setAgentSquad(c, 'lead-a', null).squads?.[0].liaison).toBeNull();
    const without = removeAgent(c, 'lead-b');
    expect(without.squads?.[1].liaison).toBeNull();
    expect(codes(checkSquads(input(without)))).toContain('E:no-liaison:b');
    // and the stages of a squad's flow that named it lose the name
    const named = config((x) => ((x.devCycle.flows ?? {}).b.find((s) => s.id === 'security') as { agentId?: string }).agentId = 'sec-b');
    expect(removeAgent(named, 'sec-b').devCycle.flows?.b.find((s) => s.id === 'security')?.agentId).toBeUndefined();
  });

  it('a template applied to the workspace leaves the flows of its squads alone, and an exported template does not carry them', () => {
    const c = config();
    const applied = applyTemplate(c, agentFlowEngineering);
    expect(applied.devCycle.flows?.b.map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(applied.squads).toHaveLength(2);
    const exported = templateFromConfig(c, { id: 'mine', name: 'Mine', description: '' });
    expect(exported.devCycle.flows).toBeUndefined();
    expect(JSON.stringify(exported)).not.toContain('"squad"');
    // the agents of the squads keep the stages of their flow when the cycle changes
    expect(applied.agents.team.find((a) => a.id === 'sec-b')?.stages).toEqual(['security']);
  });
});
