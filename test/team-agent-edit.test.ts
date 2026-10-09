import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { newSquad, addSquad } from '../src/shared/config/squads';
import { addAgent, newAgent, workingTeam } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { agentProblems, applyAgent, blankAgent, draftOf, promoteDraft, slugOf, stagesLosingAgent, stagesOfAgent, teamIssues, turnsToChoices, uniqueId } from '../src/renderer/src/screens/team/agentEdit';

const flow = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlow);
// A squad with members needs a liaison; the squad is not what this test is about, so the checked copy has none.
const agentOnly = (c: WorkspaceConfig): WorkspaceConfig => ({ ...c, squads: [] , agents: { ...c.agents, team: c.agents.team.map((a) => ({ ...a, squad: null })) } });
const agent = (c: WorkspaceConfig, id: string) => c.agents.team.find((a) => a.id === id)!;

describe('ids from names', () => {
  it('folds accents, dashes everything else and keeps the id valid', () => {
    expect(slugOf('Líder Técnico!')).toBe('lider-tecnico');
    expect(slugOf('  --QA / Release--  ')).toBe('qa-release');
    expect(slugOf('!!!')).toBe('');
    expect(slugOf('x'.repeat(80))).toHaveLength(48);
  });

  it('picks the first free id', () => {
    expect(uniqueId('qa', ['developer'])).toBe('qa');
    expect(uniqueId('qa', ['qa'])).toBe('qa-2');
    expect(uniqueId('qa', ['qa', 'qa-2'])).toBe('qa-3');
    expect(uniqueId('', [])).toBe('item');
  });
});

describe('the problems of an agent draft', () => {
  it('asks for a name, a valid free id and, without a role, a provider and a model', () => {
    const c = flow();
    const d = blankAgent();
    expect(agentProblems(c, d, true).map((p) => p.key)).toEqual(['ui.team.err.name', 'ui.team.err.idShape']);
    expect(agentProblems(c, { ...d, name: 'A', id: 'developer' }, true).map((p) => p.key)).toEqual(['ui.team.err.idTaken']);
    expect(agentProblems(c, { ...d, name: 'A', id: 'turn' }, true).map((p) => p.key)).toEqual(['ui.team.err.idReserved']);
    expect(agentProblems(c, { ...d, name: 'A', id: 'ok' }, true)).toEqual([]);
    const own = { ...d, name: 'A', id: 'ok', model: { role: null, provider: 'nope', model: '' } };
    expect(agentProblems(c, own, true).map((p) => p.key)).toEqual(['ui.team.err.provider']);
  });

  it('does not check the id of an agent that exists', () => {
    const c = flow();
    expect(agentProblems(c, draftOf(agent(c, 'developer')), false)).toEqual([]);
  });
});

describe('the virtual screen of an agent in the editor', () => {
  it('starts off, and a draft of an agent without them holds none', () => {
    const c = flow();
    expect(blankAgent()).toMatchObject({ screen: false, allowedHosts: [], browserProfile: false });
    expect(draftOf(agent(c, 'developer'))).toMatchObject({ screen: false, allowedHosts: [], browserProfile: false });
  });

  it('writes the three only when they are on, and clearing one removes the field', () => {
    const c = flow();
    const plain = applyAgent(c, draftOf(agent(c, 'developer')), false);
    expect('screen' in agent(plain, 'developer') || 'allowedHosts' in agent(plain, 'developer') || 'browserProfile' in agent(plain, 'developer')).toBe(false);
    const on = applyAgent(c, { ...draftOf(agent(c, 'developer')), screen: true, allowedHosts: [' Example.com ', 'docs.example.com', 'example.com', ''], browserProfile: true }, false);
    expect(agent(on, 'developer')).toMatchObject({ screen: true, allowedHosts: ['example.com', 'docs.example.com'], browserProfile: true });
    expect(validateConfig(agentOnly(on)).errors).toEqual([]);
    expect(draftOf(agent(on, 'developer'))).toMatchObject({ screen: true, allowedHosts: ['example.com', 'docs.example.com'], browserProfile: true });
    const off = applyAgent(on, { ...draftOf(agent(on, 'developer')), screen: false, allowedHosts: [], browserProfile: false }, false);
    expect('screen' in agent(off, 'developer') || 'allowedHosts' in agent(off, 'developer') || 'browserProfile' in agent(off, 'developer')).toBe(false);
    expect(validateConfig(agentOnly(off)).errors).toEqual([]);
  });

  it('saves a new agent with them, and an edit of something else leaves them as they were', () => {
    const c = flow();
    const made = applyAgent(c, { ...blankAgent(), id: 'scout', name: 'Scout', screen: true, allowedHosts: ['example.com'] }, true);
    expect(agent(made, 'scout')).toMatchObject({ screen: true, allowedHosts: ['example.com'] });
    const renamed = applyAgent(made, { ...draftOf(agent(made, 'scout')), name: 'Scout 2' }, false);
    expect(agent(renamed, 'scout')).toMatchObject({ name: 'Scout 2', screen: true, allowedHosts: ['example.com'] });
  });

  it('flags a host the proxy would not take and a list that is too long, as validate.ts does', () => {
    const c = flow();
    const d = { ...blankAgent(), id: 'ok', name: 'A' };
    expect(agentProblems(c, { ...d, allowedHosts: ['example.com', ' '] }, true)).toEqual([]);
    for (const bad of ['https://example.com', 'example.com:443', '*.example.com', 'localhost']) {
      expect(agentProblems(c, { ...d, allowedHosts: [bad] }, true), bad).toEqual([{ field: 'allowedHosts', key: 'ui.team.err.allowedHost', params: { host: bad } }]);
    }
    const many = Array.from({ length: 21 }, (_, i) => `h${i}.example.com`);
    expect(agentProblems(c, { ...d, allowedHosts: many }, true).map((p) => p.key)).toEqual(['ui.team.err.allowedHostsMax']);
  });
});

describe('applying a draft', () => {
  it('adds an agent that validates, with its squad', () => {
    let c = flow();
    c = addSquad(c, newSquad({ id: 'core', name: 'Core' }));
    const next = applyAgent(c, { ...blankAgent(), id: 'designer', name: ' Designer ', job: 'Designs', squad: 'core', turnsTo: 'product-owner' }, true);
    expect(agent(next, 'designer')).toMatchObject({ name: 'Designer', squad: 'core', turnsTo: 'product-owner', system: false });
    expect(validateConfig(agentOnly(next)).errors).toEqual([]);
  });

  it('edits an agent and a system agent keeps its role entry in step', () => {
    const c = flow();
    const d = { ...draftOf(agent(c, 'deep')), instructions: 'be careful' };
    const next = applyAgent(c, d, false);
    expect(agent(next, 'deep').instructions).toBe('be careful');
    expect(next.agents.roles.deep.extraInstructions).toBe('be careful');
  });

  it('a model of its own drops the role, and a role drops the provider', () => {
    let c = flow();
    c.llm.providers.push({ ...c.llm.providers[0], id: 'local', kind: 'openai-compatible', engine: 'open', baseUrl: 'http://localhost:11434/v1' });
    const own = applyAgent(c, { ...draftOf(agent(c, 'developer')), model: { role: null, provider: 'local', model: ' tiny ' } }, false);
    expect(agent(own, 'developer').model).toEqual({ role: null, provider: 'local', model: 'tiny' });
    const back = applyAgent(own, { ...draftOf(agent(own, 'developer')), model: { role: 'fix', provider: 'local', model: 'tiny' } }, false);
    expect(agent(back, 'developer').model).toEqual({ role: 'fix', provider: '', model: '' });
  });

  it('saving an agent with no allowed command leaves no empty field, and clearing the last one removes it', () => {
    const c = flow();
    const plain = applyAgent(c, draftOf(agent(c, 'developer')), false);
    expect('allowedCommands' in agent(plain, 'developer')).toBe(false);
    expect(validateConfig(agentOnly(plain)).errors).toEqual([]);
    const ruled = applyAgent(c, { ...draftOf(agent(c, 'developer')), allowedCommands: ['npm test:*'] }, false);
    expect(agent(ruled, 'developer').allowedCommands).toEqual(['npm test:*']);
    const cleared = applyAgent(ruled, { ...draftOf(agent(ruled, 'developer')), allowedCommands: [] }, false);
    expect('allowedCommands' in agent(cleared, 'developer')).toBe(false);
    expect(validateConfig(agentOnly(cleared)).errors).toEqual([]);
  });

  it('refuses a taken id', () => {
    expect(() => applyAgent(flow(), { ...blankAgent(), id: 'developer', name: 'x' }, true)).toThrow();
  });
});

describe('the checks of the team over a draft', () => {
  it('finds a loop of who turns to whom, with the agent it is about', () => {
    const c = flow();
    const d = { ...draftOf(agent(c, 'product-owner')), turnsTo: 'developer' };
    const { flow: issues } = teamIssues(c, d, false);
    expect(issues.map((i) => i.code)).toContain('turns-loop');
    expect(issues.every((i) => i.agent === 'product-owner')).toBe(true);
  });

  it('finds an agent that turns to itself', () => {
    const c = flow();
    const { flow: issues } = teamIssues(c, { ...draftOf(agent(c, 'qa')), turnsTo: 'qa' }, false);
    expect(issues.map((i) => i.code)).toEqual(['turns-self']);
  });

  it('is quiet for an agent as it is', () => {
    const c = flow();
    expect(teamIssues(c, draftOf(agent(c, 'qa')), false)).toEqual({ flow: [], squad: [] });
  });
});

describe('what removing an agent leaves without one', () => {
  it('lists the stages only that agent works, in the workspace flow and in a squad flow', () => {
    let c = flow();
    expect(stagesLosingAgent(c, 'developer').map((s) => s.stage)).toEqual(['implement']);
    expect(stagesLosingAgent(c, 'tech-lead').map((s) => s.stage)).toEqual(['plan', 'review']);
    c = addAgent(c, { id: 'backup', name: 'Backup', stages: ['implement'] });
    // the stage names its agent, so a second agent that lists it does not take over
    expect(stagesLosingAgent(c, 'developer').map((s) => s.stage)).toEqual([]);
    c.devCycle.flows = { core: [{ id: 'only', label: 'Only', match: [], kind: 'development', rank: 1, type: 'work', agentId: 'qa' }] };
    expect(stagesLosingAgent(c, 'qa')).toEqual([{ stage: 'qa', label: 'QA', squad: null }, { stage: 'only', label: 'Only', squad: 'core' }]);
  });

  it('is empty for an agent that works nothing', () => {
    expect(stagesLosingAgent(flow(), 'turn')).toEqual([]);
  });
});

describe('the stages an agent works', () => {
  it('are the ones that name it and the ones it lists with no agent named', () => {
    const c = flow();
    expect(stagesOfAgent(c, agent(c, 'tech-lead')).map((s) => s.id)).toEqual(['plan', 'review']);
    expect(stagesOfAgent(c, agent(c, 'turn'))).toEqual([]);
  });
});

describe('the two permissions of a run in the agent editor', () => {
  it('start with no host read and no commands for a new agent, and carry what an agent has', async () => {
    const { blankAgent, draftOf, applyAgent, agentProblems, shellAfterPermission } = await import('../src/renderer/src/screens/team/agentEdit');
    const { neutralConfig } = await import('../src/shared/config');
    expect(blankAgent()).toMatchObject({ tracker: 'none', shell: 'none' });
    const config = neutralConfig();
    const draft = { ...blankAgent(), id: 'qa2', name: 'QA 2', permission: 'read' as const, tracker: 'read' as const, shell: 'sandbox' as const };
    const next = applyAgent(config, draft, true);
    const made = next.agents.team.find((a) => a.id === 'qa2')!;
    expect(made).toMatchObject({ tracker: 'read', shell: 'sandbox' });
    expect(draftOf(made)).toMatchObject({ tracker: 'read', shell: 'sandbox' });
    expect(agentProblems(config, draft, true)).toEqual([]);
    expect(shellAfterPermission('allowlist', 'read')).toBe('none');
    expect(shellAfterPermission('allowlist', 'worktree')).toBe('allowlist');
    expect(shellAfterPermission('sandbox', 'read')).toBe('sandbox');
  });

  it('refuses "listed commands" for an agent that only reads', async () => {
    const { blankAgent, agentProblems } = await import('../src/renderer/src/screens/team/agentEdit');
    const { neutralConfig } = await import('../src/shared/config');
    const draft = { ...blankAgent(), id: 'r2', name: 'R', permission: 'read' as const, shell: 'allowlist' as const };
    expect(agentProblems(neutralConfig(), draft, true)).toEqual([{ field: 'shell', key: 'ui.team.err.allowlist' }]);
    expect(agentProblems(neutralConfig(), { ...draft, permission: 'worktree' }, true)).toEqual([]);
  });
});

describe('a draft agent in the editor', () => {
  const withDraft = (): WorkspaceConfig => {
    const c = flow();
    c.agents.team.push(newAgent({ id: 'trial', draft: true }));
    return c;
  };

  it('is not offered as the agent a question turns to, and the others are as before', () => {
    const c = withDraft();
    expect(turnsToChoices(c, 'developer').map((a) => a.id)).not.toContain('trial');
    expect(turnsToChoices(c, 'developer').map((a) => a.id)).toEqual(turnsToChoices(flow(), 'developer').map((a) => a.id));
    expect(turnsToChoices(c, 'developer').map((a) => a.id)).not.toContain('developer');
  });

  it('keeps its id taken: a new agent cannot be given the id of a draft', () => {
    const c = withDraft();
    expect(agentProblems(c, { ...blankAgent(), name: 'Trial', id: 'trial' }, true).map((p) => p.key)).toEqual(['ui.team.err.idTaken']);
    // and the id a name makes steps over it
    expect(uniqueId(slugOf('Trial'), c.agents.team.map((a) => a.id))).toBe('trial-2');
  });

  it('is no agent a question may turn to, as far as the checks of the team go', () => {
    const c = withDraft();
    const d = { ...draftOf(agent(c, 'developer')), turnsTo: 'trial' };
    expect(teamIssues(c, d, false).flow.map((i) => i.code)).toContain('turns-unknown');
  });
});

describe('promoting a draft agent of the assistant', () => {
  const withTrial = (): WorkspaceConfig => {
    const c = addSquad(flow(), newSquad({ id: 'core', name: 'Core' }));
    c.agents.team.push(newAgent({ id: 'trial', name: 'Trial', job: 'old job', instructions: 'old', draft: true, tracker: 'read' }));
    return c;
  };
  const form = (c: WorkspaceConfig, over: Partial<ReturnType<typeof blankAgent>> = {}) => ({ ...draftOf(agent(c, 'trial')), ...over });
  const workStage = (c: WorkspaceConfig): string => c.devCycle.stages.find((s) => (s.type ?? 'work') === 'work')!.id;

  it('takes the mark off in the same edit that applies the form, its stages, squad and who it turns to included', () => {
    const c = withTrial();
    const stage = workStage(c);
    const next = promoteDraft(c, form(c, { name: ' Trial two ', job: 'new job', instructions: 'new', stages: [stage], squad: 'core', turnsTo: 'tech-lead', permission: 'worktree', shell: 'allowlist' }));
    const made = agent(next, 'trial');
    expect(made).toMatchObject({ name: 'Trial two', job: 'new job', instructions: 'new', stages: [stage], squad: 'core', turnsTo: 'tech-lead', permission: 'worktree', shell: 'allowlist', system: false });
    expect('draft' in made).toBe(false);
    // from here the agent takes part in the cycle; before, it did not
    expect(workingTeam(c.agents.team).map((a) => a.id)).not.toContain('trial');
    expect(workingTeam(next.agents.team).map((a) => a.id)).toContain('trial');
    expect(turnsToChoices(next, 'developer').map((a) => a.id)).toContain('trial');
    expect(c.agents.team.find((a) => a.id === 'trial')).toMatchObject({ draft: true });
  });

  it('keeps every other agent as it was and moves nothing else in the config', () => {
    const c = withTrial();
    const next = promoteDraft(c, form(c));
    expect(next.agents.team.filter((a) => a.id !== 'trial')).toEqual(c.agents.team.filter((a) => a.id !== 'trial'));
    expect({ ...next, agents: { ...next.agents, team: [] } }).toEqual({ ...c, agents: { ...c.agents, team: [] } });
  });

  it('is the edit of any agent for the rest: a model of its own, the autonomy and the commands as the form has them', () => {
    const c = withTrial();
    const next = promoteDraft(c, form(c, { autonomous: true, allowedCommands: ['npm test:*'], model: { role: 'fix', provider: '', model: '' } }));
    expect(agent(next, 'trial')).toMatchObject({ autonomous: true, allowedCommands: ['npm test:*'], model: { role: 'fix' } });
    expect('allowedCommands' in agent(promoteDraft(c, form(c)), 'trial')).toBe(false);
  });

  it('refuses an agent that is not there and one that is not a draft', () => {
    const c = withTrial();
    expect(() => promoteDraft(c, { ...form(c), id: 'ghost' })).toThrow(/ghost/);
    expect(() => promoteDraft(c, { ...draftOf(agent(c, 'developer')) })).toThrow(/developer/);
    expect(() => promoteDraft(c, { ...draftOf(agent(c, 'deep')) })).toThrow(/deep/);
  });

  it('is checked over the config it makes: a problem of the agent about to be saved is not hidden by the mark it still has', () => {
    const c = withTrial();
    const d = form(c, { turnsTo: 'ghost' });
    // as a plain edit the agent is still a draft in the config, so the checks of the flow leave it out and say nothing about it
    expect(teamIssues(c, d, false).flow.map((i) => i.code)).not.toContain('turns-unknown');
    expect(teamIssues(c, d, false, true).flow.filter((i) => i.agent === 'trial').map((i) => i.code)).toEqual(['turns-unknown']);
    // a promotion of something that cannot be promoted says nothing, like an edit that throws
    expect(teamIssues(c, { ...d, id: 'developer' }, false, true)).toEqual({ flow: [], squad: [] });
  });

  it('is judged on its own like an agent that exists: its id is not asked about, its name and its commands are', () => {
    const c = withTrial();
    expect(agentProblems(c, form(c), false)).toEqual([]);
    expect(agentProblems(c, form(c, { name: '  ' }), false).map((p) => p.key)).toEqual(['ui.team.err.name']);
    expect(agentProblems(c, form(c, { shell: 'allowlist' }), false).map((p) => p.key)).toEqual(['ui.team.err.allowlist']);
  });
});
