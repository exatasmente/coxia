import { newAgent } from '../../src/shared/config/team';
import { newSquad } from '../../src/shared/config/squads';
import type { AgentDef, SquadDef, StageDef, WorkspaceConfig } from '../../src/shared/config/types';

// A workspace with two squads: the lean flow the squad tests use (triage by the shared front door, implement by the squad's developer, and the end), the
// two squads scoped by repository, and a flow of its own for the second (an extra security stage). Everything is data: nothing here starts a run.

const stage = (id: string, kind: StageDef['kind'], rank: number, over: Partial<StageDef> = {}): StageDef => ({ id, label: id, match: [], kind, rank, type: 'work', ...over });

export const squadStages = (): StageDef[] => [
  stage('triage', 'backlog', 1, { agentId: 'support', produces: ['0_TRIAGE.md'] }),
  stage('implement', 'development', 2, { produces: ['3_IMPLEMENTATION.md'] }),
  stage('ready', 'reviewApproved', 3),
];

/** The flow of squad B: the lean one with a security stage after the implementation. */
export const squadBStages = (): StageDef[] => [
  stage('triage', 'backlog', 1, { agentId: 'support', produces: ['0_TRIAGE.md'] }),
  stage('implement', 'development', 2, { produces: ['3_IMPLEMENTATION.md'] }),
  stage('security', 'review', 3, { produces: ['4_SECURITY.md'], returnsTo: 'implement' }),
  stage('ready', 'reviewApproved', 4),
];

const agent = (id: string, over: Partial<AgentDef>): AgentDef => newAgent({ id, autonomous: true, model: { role: 'deep' }, ...over });

export function squadTeam(): AgentDef[] {
  return [
    agent('support', { stages: ['triage'] }),
    agent('dev-a', { stages: ['implement'], permission: 'read', squad: 'a' }),
    agent('lead-a', { squad: 'a' }),
    agent('dev-b', { stages: ['implement'], permission: 'read', squad: 'b' }),
    agent('sec-b', { stages: ['security'], squad: 'b' }),
    agent('lead-b', { squad: 'b' }),
  ];
}

export function squadDefs(): SquadDef[] {
  return [
    newSquad({ id: 'a', name: 'Squad A', mission: 'The app.', scope: { repos: ['app'] }, liaison: 'lead-a', label: 'squad-a' }),
    newSquad({ id: 'b', name: 'Squad B', mission: 'The web.', scope: { repos: ['web'] }, liaison: 'lead-b', label: 'squad-b' }),
  ];
}

/**
 * Turns the config into the squad workspace: the lean flow, the team around it (the five built-in agents stay), two squads and the flow of B. `app` and `web`
 * are the repositories the squads are scoped to; a test that runs them adds the clones.
 */
export function withSquads(c: WorkspaceConfig, edit: (c: WorkspaceConfig) => void = () => undefined): WorkspaceConfig {
  c.devCycle.stages = squadStages();
  c.devCycle.flows = { b: squadBStages() };
  c.devCycle.comments = {};
  c.devCycle.templateId = 'squad-test';
  c.agents.team = [...c.agents.team.filter((a) => a.system), ...squadTeam()];
  c.squads = squadDefs();
  for (const id of ['web']) if (!c.projects.repos.some((r) => r.id === id)) c.projects.repos.push({ id, path: `/tmp/squad-test/${id}`, remoteUrl: null, vcsId: null, projectPath: 'group/project' });
  edit(c);
  return c;
}
