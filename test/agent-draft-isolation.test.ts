// A draft agent (the one the AI assistant saves to be tried out) takes no part in the cycle. It is born inert (no stages, no squad, not autonomous, turns to nobody), but a
// file written by hand, the flow editor or an old value can give it all of those, so the decision is taken where the team is read: who works a stage, who a question goes
// to, who a call or an @ reaches, what the checks count, what a switch may change and what a shared template carries. Without a draft in the team every one of these
// answers exactly what it answered before.
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { effectiveTeam, liaisonFor, membersOf, scopedTeam, squadView, turnTarget } from '../src/shared/config/squads';
import { isDraft, newAgent, recommendations, stageAgent, workingTeam } from '../src/shared/config/team';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import { templateFromConfig } from '../src/shared/cycles';
import { agentThreadId, mentionableIds, parseMentions } from '../src/shared/forum';
import { checkFlow, checkSquads, flowOf } from '../src/shared/runs';
import { RunnerError } from '../src/main/runner/service';
import { boot } from './helpers/runner';
import { agentFlowConfig } from './helpers/runs';
import { withSquads } from './helpers/squads';

/** A draft that someone gave everything an inert one lacks: it lists stages, runs by itself and turns to a real agent. */
const loud = (over: Partial<AgentDef> = {}): AgentDef => newAgent({ id: 'trial', draft: true, stages: ['implement', 'ready'], autonomous: true, turnsTo: 'qa', ...over });
const agent = (c: WorkspaceConfig, id: string): AgentDef => c.agents.team.find((a) => a.id === id) as AgentDef;
/** The flow of the engineering cycle with the draft first in the team, so "the first agent that lists the stage" would be it. */
const withDraft = (over: Partial<AgentDef> = {}, edit: (c: WorkspaceConfig) => void = () => undefined): WorkspaceConfig => {
  const c = agentFlowConfig();
  c.agents.team.unshift(loud(over));
  edit(c);
  return c;
};
const codes = (issues: { code: string; agent?: string | null; stage?: string | null }[]): string[] => issues.map((i) => `${i.code}:${i.agent ?? i.stage ?? ''}`);

describe('who works a stage', () => {
  it('is never a draft, even one that lists the stage and comes first', () => {
    const c = withDraft({}, (x) => delete x.devCycle.stages.find((s) => s.id === 'implement')!.agentId);
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'implement')?.id).toBe('developer');
    // Nobody else lists the end stage: the draft that does is no one.
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'ready')).toBeNull();
  });

  it('is the next agent that lists the stage, or nobody, when the stage names a draft', () => {
    const c = withDraft({}, (x) => (x.devCycle.stages.find((s) => s.id === 'implement')!.agentId = 'trial'));
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'implement')?.id).toBe('developer');
    c.agents.team = c.agents.team.filter((a) => a.id !== 'developer');
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'implement')).toBeNull();
  });

  it('is what the flow of the workspace and of a squad say', () => {
    const c = withDraft({}, (x) => delete x.devCycle.stages.find((s) => s.id === 'implement')!.agentId);
    const stages = flowOf(c);
    expect(stages.find((s) => s.id === 'implement')).toMatchObject({ agent: 'developer' });
    expect(stages.find((s) => s.id === 'ready')).toMatchObject({ agent: null, autonomous: false });
    const same = agentFlowConfig();
    delete same.devCycle.stages.find((s) => s.id === 'implement')!.agentId;
    expect(stages).toEqual(flowOf(same));
  });
});

describe('the team the runner reads', () => {
  it('leaves the draft out of the effective team, of a squad\'s agents and of the view a run resolves its flow from', () => {
    const c = withSquads(neutralConfig(), (x) => x.agents.team.unshift(loud({ squad: 'a' })));
    expect(effectiveTeam(c).map((a) => a.id)).not.toContain('trial');
    expect(scopedTeam(c, 'a').map((a) => a.id)).not.toContain('trial');
    expect(squadView(c, 'a').agents.team.map((a) => a.id)).not.toContain('trial');
    expect(squadView(c, null).agents.team.map((a) => a.id)).not.toContain('trial');
    // The team without the draft is the team with it, less the draft.
    const without = withSquads(neutralConfig());
    expect(effectiveTeam(c)).toEqual(effectiveTeam(without));
  });

  it('does not count the draft among the members of a squad, so a squad with only a draft is not routable', () => {
    const c = withSquads(neutralConfig(), (x) => x.agents.team.unshift(loud({ squad: 'a' })));
    expect(membersOf(c, 'a').map((a) => a.id)).not.toContain('trial');
    expect(membersOf(c, 'a')).toEqual(membersOf(withSquads(neutralConfig()), 'a'));
    // Without the mark the same agent is a member: the filter is the mark, not the id.
    const real = withSquads(neutralConfig(), (x) => x.agents.team.unshift(loud({ squad: 'a', draft: undefined })));
    expect(membersOf(real, 'a').map((a) => a.id)).toContain('trial');
  });

  it('recommends no permission to a draft whose id is a role\'s by chance', () => {
    const c = withSquads(neutralConfig(), (x) => x.agents.team.push(newAgent({ id: 'qa', name: 'QA', draft: true })));
    expect(recommendations(c, true).map((r) => r.id)).not.toContain('qa');
    // The same agent without the mark gets the recommendation of its role.
    const real = withSquads(neutralConfig(), (x) => x.agents.team.push(newAgent({ id: 'qa', name: 'QA' })));
    expect(recommendations(real, true).map((r) => r.id)).toContain('qa');
  });

  it('takes no draft as the liaison of a squad, even when a file names one', () => {
    const c = withSquads(neutralConfig(), (x) => {
      x.agents.team.push(loud({ id: 'trial', squad: 'a' }));
      x.squads = (x.squads ?? []).map((q) => (q.id === 'a' ? { ...q, liaison: 'trial' } : q));
    });
    expect(liaisonFor(c, agent(c, 'dev-a'))).toBeNull();
  });

  it('sends a question that turns to a draft where it would go with no one named', () => {
    const c = withSquads(neutralConfig(), (x) => x.agents.team.push(loud({ id: 'trial', squad: undefined })));
    const dev = agent(c, 'dev-a');
    // dev-a is in squad a, whose liaison is lead-a: a draft as `turnsTo` is no one, so the question goes to the liaison.
    expect(turnTarget(c, { ...dev, turnsTo: 'trial' })).toBe('lead-a');
    expect(turnTarget(c, { ...dev, turnsTo: 'lead-a' })).toBe('lead-a');
    // A shared agent has no liaison: the person.
    expect(turnTarget(c, { ...agent(c, 'support'), turnsTo: 'trial' })).toBeNull();
  });
});

describe('the checks of the flow and of the squads', () => {
  it('count a stage or an agent that points at a draft as pointing at someone who does not exist', () => {
    const c = withDraft({}, (x) => {
      x.devCycle.stages.find((s) => s.id === 'plan')!.agentId = 'trial';
      agent(x, 'reviewer').turnsTo = 'trial';
    });
    const issues = checkFlow({ stages: c.devCycle.stages, team: c.agents.team });
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'agent-unknown', stage: 'plan', params: expect.objectContaining({ agent: 'trial' }) }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'turns-unknown', agent: 'reviewer', params: expect.objectContaining({ target: 'trial' }) }));
  });

  it('say nothing about the draft itself, and exactly what they said before it was there', () => {
    const c = withDraft({ turnsTo: 'trial' });
    const clean = agentFlowConfig();
    // The draft turns to itself and lists stages: a real agent would be told so (`turns-self`), a draft is not looked at.
    expect(checkFlow({ stages: c.devCycle.stages, team: c.agents.team })).toEqual(checkFlow({ stages: clean.devCycle.stages, team: clean.agents.team }));
    const idle = withDraft({ stages: [], turnsTo: null });
    expect(codes(checkFlow({ stages: idle.devCycle.stages, team: idle.agents.team }))).not.toContain('agent-idle:trial');
  });

  it('do not count a draft as a member, a liaison or a link of the chain of a squad', () => {
    const asMember = withSquads(neutralConfig(), (x) => {
      x.agents.team.push(loud({ squad: 'a', turnsTo: null }));
      // the squad's only members are real agents; take them out and the draft is all that is left
      for (const a of x.agents.team) if (a.squad === 'a' && a.id !== 'trial') delete a.squad;
      x.squads![0].liaison = null;
    });
    const asMemberCodes = codes(checkSquads({ squads: asMember.squads ?? [], team: asMember.agents.team, stages: asMember.devCycle.stages, flows: asMember.devCycle.flows }));
    expect(asMemberCodes).toContain('squad-empty:');
    expect(asMemberCodes).not.toContain('no-liaison:');

    const asLiaison = withSquads(neutralConfig(), (x) => {
      x.agents.team.push(loud({ squad: 'a', turnsTo: null, stages: [] }));
      x.squads![0].liaison = 'trial';
    });
    const found = checkSquads({ squads: asLiaison.squads ?? [], team: asLiaison.agents.team, stages: asLiaison.devCycle.stages, flows: asLiaison.devCycle.flows });
    expect(found).toContainEqual(expect.objectContaining({ severity: 'error', code: 'liaison-unknown', squad: 'a' }));
  });

  it('give the same answer with a draft in the team as without it', () => {
    const c = withSquads(neutralConfig());
    const input = (team: AgentDef[]) => ({ squads: c.squads ?? [], team, stages: c.devCycle.stages, flows: c.devCycle.flows });
    const plain = checkSquads(input(c.agents.team), { checkSharedFlow: true });
    // A draft of squad b that turns to a lead of squad a would be a `turns-other-squad` error for a real agent.
    const crossing = loud({ squad: 'b', stages: ['security'], turnsTo: 'lead-a' });
    expect(codes(checkSquads(input([crossing, ...c.agents.team.filter((a) => a.id !== 'trial')]), { checkSharedFlow: true }))).toEqual(codes(plain));
    expect(checkSquads(input([{ ...crossing, draft: undefined }, ...c.agents.team]), { checkSharedFlow: true }).length).toBeGreaterThan(plain.length);
  });
});

describe('the helpers of the team', () => {
  it('know a draft by its mark and hand back the same list when there is none', () => {
    const c = withDraft();
    expect(c.agents.team.filter(isDraft).map((a) => a.id)).toEqual(['trial']);
    expect(workingTeam(c.agents.team).some(isDraft)).toBe(false);
    const plain = agentFlowConfig().agents.team;
    expect(workingTeam(plain)).toBe(plain);
  });
});

describe('who an @ reaches', () => {
  it('is every agent of the cycle and no draft', () => {
    const c = withDraft();
    expect(mentionableIds(c.agents.team)).toEqual(agentFlowConfig().agents.team.map((a) => a.id));
    expect(parseMentions('@trial and @developer', mentionableIds(c.agents.team))).toEqual(['developer']);
  });

  it('includes the draft in its own conversation, and only there', () => {
    const c = withDraft();
    expect(mentionableIds(c.agents.team, agentThreadId('trial'))).toContain('trial');
    expect(mentionableIds(c.agents.team, agentThreadId('developer'))).not.toContain('trial');
    expect(mentionableIds(c.agents.team, 'general')).not.toContain('trial');
    // another draft's conversation does not open the first one
    c.agents.team.push(newAgent({ id: 'other', draft: true }));
    const ids = mentionableIds(c.agents.team, agentThreadId('other'));
    expect(ids).toContain('other');
    expect(ids).not.toContain('trial');
  });

  it('is the same list as before when the team has no draft', () => {
    const team = agentFlowConfig().agents.team;
    expect(mentionableIds(team)).toEqual(team.map((a) => a.id));
    expect(mentionableIds(team, agentThreadId('developer'))).toEqual(team.map((a) => a.id));
  });
});

describe('what the runner lets the person change or start', () => {
  it('refuses to switch a draft to autonomous, as for an agent that does not exist, and still switches the others', async () => {
    const b = await boot({ configure: (c) => c.agents.team.push(newAgent({ id: 'trial', draft: true })) });
    expect(() => b.runner.setAutonomous('trial', true)).toThrow(RunnerError);
    expect(b.deps.config().agents.team.find((a) => a.id === 'trial')?.autonomous).toBe(false);
    expect(b.runner.setAutonomous('qa', false).agents.team.find((a) => a.id === 'qa')?.autonomous).toBe(false);
  });

  it('does not ask for a sandbox because of a draft that lists stages', async () => {
    // No sandbox service at all: a real agent set to `sandbox` that works a stage refuses the start, a draft that was given one does not.
    const b = await boot({ configure: (c) => c.agents.team.push(newAgent({ id: 'trial', draft: true, shell: 'sandbox', stages: ['qa'] })) });
    await expect(b.runner.start('app#101')).resolves.toMatchObject({ issue: { ref: 'app#101' } });
    await b.settle();
    const real = await boot({ configure: (c) => c.agents.team.push(newAgent({ id: 'worker', shell: 'sandbox', stages: ['qa'] })) });
    await expect(real.runner.start('app#101')).rejects.toMatchObject({ code: 'no-sandbox' });
  });
});

describe('what is shared as a template', () => {
  it('carries no draft, and the same team as before without one', () => {
    const c = agentFlowConfig();
    const meta = { id: 'mine', name: 'Mine', description: '' };
    const before = templateFromConfig(c, meta);
    c.agents.team.push(loud());
    const after = templateFromConfig(c, meta);
    expect(after.team?.map((a) => a.id)).not.toContain('trial');
    expect(after).toEqual(before);
  });
});

describe('saving the config', () => {
  it('does not count a draft that comes or goes as a change to the flow: a flow with an old problem still lets the person try an agent', async () => {
    const { writeConfigFile } = await import('../src/main/config-bootstrap');
    const { reloadConfig, updateConfig } = await import('../src/main/workspaceConfig');
    const { ATAS } = await import('../src/main/env');
    // A flow the app opened with a stage that lost its agent: saving one is refused, a stored one is kept as it was.
    const stored = agentFlowConfig();
    stored.agents.team = stored.agents.team.filter((a) => a.id !== 'developer');
    delete stored.devCycle.stages.find((s) => s.id === 'implement')!.agentId;
    writeConfigFile(ATAS, stored);
    reloadConfig();
    const add = (extra: AgentDef) => updateConfig((c) => ({ ...c, agents: { ...c.agents, team: [...c.agents.team, extra] } }));
    expect(() => add(newAgent({ id: 'trial', draft: true }))).not.toThrow();
    expect(() => updateConfig((c) => ({ ...c, agents: { ...c.agents, team: c.agents.team.filter((a) => a.id !== 'trial') } }))).not.toThrow();
    // An agent that works is held to the flow's checks, as it always was.
    expect(() => add(newAgent({ id: 'worker' }))).toThrow();
    // A draft that lists stages is no change to the flow either: the mark is what keeps it out of it.
    expect(() => add(newAgent({ id: 'trial', draft: true, stages: ['implement'] }))).not.toThrow();
  });
});
