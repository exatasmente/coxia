import { ID } from '../../../../shared/config/schema';
import { addSquad, membersOf, setAgentSquad, squadOf, squadsOf, updateSquad } from '../../../../shared/config/squads';
import { workingTeam } from '../../../../shared/config/team';
import type { AgentDef, SquadDef, SquadPath, WorkspaceConfig } from '../../../../shared/config/types';
import { checkSquads, type SquadIssue } from '../../../../shared/runs/squadCheck';

// The squad editor, as pure functions: the draft a person types into, the checks shown while typing, and the config the draft makes.

const ID_RE = new RegExp(ID);

/** The agents a squad can take as members: the team that takes part in the cycle, without the drafts of the assistant. */
export const memberChoices = (config: Pick<WorkspaceConfig, 'agents'>): AgentDef[] => workingTeam(config.agents.team);

export interface SquadDraft {
  id: string;
  name: string;
  mission: string;
  /** The label the issue gets on the tracker; empty: none. */
  label: string;
  autonomy: boolean;
  liaison: string | null;
  repos: string[];
  labels: string[];
  paths: SquadPath[];
  unclaimed: boolean;
  /** The ids of the agents that belong to the squad. */
  members: string[];
}

export type SquadField = 'id' | 'name' | 'liaison' | 'paths' | 'label';

export interface SquadProblem {
  field: SquadField;
  /** A catalog key of this screen. */
  key: string;
  params?: Record<string, string>;
}

export function draftOfSquad(config: WorkspaceConfig, s: SquadDef): SquadDraft {
  return {
    id: s.id,
    name: s.name,
    mission: s.mission,
    label: s.label ?? '',
    autonomy: s.autonomy,
    liaison: s.liaison,
    repos: [...s.scope.repos],
    labels: [...s.scope.labels],
    paths: s.scope.paths.map((p) => ({ ...p })),
    unclaimed: s.scope.unclaimed,
    members: membersOf(config, s.id).map((a) => a.id),
  };
}

export const blankSquad = (): SquadDraft => ({ id: '', name: '', mission: '', label: '', autonomy: true, liaison: null, repos: [], labels: [], paths: [], unclaimed: false, members: [] });

/** A folder of a repository as the scope compares it: no leading "./" or "/", no trailing "/". */
export const normalizePrefix = (p: string): string => p.trim().replace(/^(\.?\/)+/, '').replace(/\/+$/, '');

/** The labels with one more: trimmed, nothing empty, no label twice (case does not matter). */
export function withLabel(labels: string[], label: string): string[] {
  const l = label.trim();
  if (!l || labels.some((x) => x.toLowerCase() === l.toLowerCase())) return labels;
  return [...labels, l];
}

export function squadProblems(config: WorkspaceConfig, d: SquadDraft, isNew: boolean): SquadProblem[] {
  const out: SquadProblem[] = [];
  if (!d.name.trim()) out.push({ field: 'name', key: 'ui.squads.err.name' });
  if (isNew) {
    if (!ID_RE.test(d.id)) out.push({ field: 'id', key: 'ui.squads.err.idShape' });
    else if (squadOf(config, d.id)) out.push({ field: 'id', key: 'ui.squads.err.idTaken', params: { id: d.id } });
  }
  if (d.paths.some((p) => !p.repo || !normalizePrefix(p.prefix))) out.push({ field: 'paths', key: 'ui.squads.err.path' });
  if (d.label.trim() && /[,\n\r]/.test(d.label)) out.push({ field: 'label', key: 'ui.squads.err.label' });
  if (d.liaison && !d.members.includes(d.liaison)) out.push({ field: 'liaison', key: 'ui.squads.err.liaisonMember' });
  return out;
}

/**
 * The config the draft makes: the squad added or edited, its scope, and who belongs to it. Membership goes first and the liaison last, so a liaison that joins in
 * the same edit is a member by then (an agent that leaves stops being the liaison on its own).
 */
export function applySquad(config: WorkspaceConfig, d: SquadDraft, isNew: boolean): WorkspaceConfig {
  const fields = {
    name: d.name.trim(),
    mission: d.mission.trim(),
    autonomy: d.autonomy,
    label: d.label.trim() || null,
    scope: { repos: [...d.repos], labels: d.labels.map((l) => l.trim()).filter(Boolean), paths: d.paths.map((p) => ({ repo: p.repo, prefix: normalizePrefix(p.prefix) })), unclaimed: d.unclaimed },
  };
  let next = isNew ? addSquad(config, { id: d.id, ...fields, liaison: null }) : updateSquad(config, d.id, fields);
  const before = new Set(membersOf(next, d.id).map((a) => a.id));
  const want = new Set(d.members);
  for (const a of next.agents.team) {
    if (want.has(a.id) && !before.has(a.id)) next = setAgentSquad(next, a.id, d.id);
    else if (!want.has(a.id) && before.has(a.id)) next = setAgentSquad(next, a.id, null);
  }
  return updateSquad(next, d.id, { liaison: d.liaison && want.has(d.liaison) ? d.liaison : null });
}

/** The checks of the squads over the config the draft makes, limited to what is about this squad (or one of its members). */
export function squadIssues(config: WorkspaceConfig, d: SquadDraft, isNew: boolean): SquadIssue[] {
  let next: WorkspaceConfig;
  try {
    next = applySquad(config, d, isNew);
  } catch {
    return [];
  }
  const members = new Set(d.members);
  return checkSquads({ squads: squadsOf(next), team: next.agents.team, stages: next.devCycle.stages, flows: next.devCycle.flows, repos: next.projects.autoDiscover ? undefined : next.projects.repos.map((r) => r.id) }).filter((i) => i.squad === d.id || (i.agent !== null && members.has(i.agent)));
}

/** Whether a squad follows a flow of its own or the workspace's. */
export const hasOwnFlow = (config: WorkspaceConfig, squadId: string): boolean => !!config.devCycle.flows?.[squadId];

/** The agents of other squads that the draft takes: they move, and the screen says so. */
export function movingAgents(config: WorkspaceConfig, d: SquadDraft): { agent: string; from: string }[] {
  return d.members.flatMap((id) => {
    const a = config.agents.team.find((x) => x.id === id);
    return a?.squad && a.squad !== d.id ? [{ agent: id, from: a.squad }] : [];
  });
}
