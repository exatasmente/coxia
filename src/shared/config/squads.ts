import { t } from '../i18n';
import { ID } from './schema';
import { workingTeam } from './team';
import type { AgentDef, DevCycleConfig, SquadDef, SquadScope, StageDef, WorkspaceConfig } from './types';

// Squads: the pure reads and edits over `squads`, `AgentDef.squad` and `devCycle.flows`. Everything takes a config and returns a new one; validation is
// the caller's (saveConfig, with the checks of runs/squadCheck.ts). A workspace with no squads is one team: every helper answers as if nothing was there.

const ID_RE = new RegExp(ID);

type SquadView = Pick<WorkspaceConfig, 'squads'>;
type TeamView = SquadView & { agents: Pick<WorkspaceConfig['agents'], 'team'> };
export type CycleView = TeamView & { devCycle: Pick<DevCycleConfig, 'stages' | 'flows'> };

export const squadsOf = (c: SquadView): SquadDef[] => c.squads ?? [];
export const squadOf = (c: SquadView, id: string | null | undefined): SquadDef | null => (id ? (squadsOf(c).find((s) => s.id === id) ?? null) : null);
export const hasSquads = (c: SquadView): boolean => squadsOf(c).length > 0;

/** A squad with every field filled: the id is the only thing that cannot be guessed. */
export function newSquad(partial: Pick<SquadDef, 'id'> & Partial<Omit<SquadDef, 'scope'>> & { scope?: Partial<SquadScope> }): SquadDef {
  const s = partial.scope ?? {};
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    mission: partial.mission ?? '',
    scope: { repos: s.repos ?? [], labels: s.labels ?? [], paths: s.paths ?? [], unclaimed: s.unclaimed ?? false },
    liaison: partial.liaison ?? null,
    autonomy: partial.autonomy ?? true,
    label: partial.label ?? null,
  };
}

/** An agent with no squad is shared: it works for every squad. */
export const isShared = (a: Pick<AgentDef, 'squad'>): boolean => !a.squad;

/** The agents that belong to a squad. */
export const membersOf = (c: TeamView, squadId: string): AgentDef[] => c.agents.team.filter((a) => a.squad === squadId);

/**
 * The team as the switches of the squads leave it: a member of a squad that is switched off is not autonomous, whatever its own switch says (the squad's switch
 * holds every member; the agent's own applies when the squad's is on). What the runner reads the agents from, so a stage captures the combined value.
 * A draft is not in it: it takes no part in a run.
 */
export const effectiveTeam = (c: TeamView): AgentDef[] => workingTeam(c.agents.team).map((a) => (a.autonomous && !autonomousOf(c, a) ? { ...a, autonomous: false } : a));

/** The agents a squad's runs may use: its members and the shared ones. */
export const scopedTeam = (c: TeamView, squadId: string): AgentDef[] => effectiveTeam(c).filter((a) => a.squad === squadId || isShared(a));

/**
 * The keys of `devCycle.flows` that hold the flow of a kind of run that is not an issue's: a release run (a run whose subject is a version) and a documentation run (a
 * run that drafts the `.coxia/` of a repository). They are flows per run kind next to the flows of the squads, so a squad cannot be called either.
 */
export const RELEASE_FLOW_KEY = 'release';
export const DOCS_FLOW_KEY = 'docs';
export const RUN_KIND_FLOW_KEYS = [RELEASE_FLOW_KEY, DOCS_FLOW_KEY] as const;
export type RunKind = 'release' | 'docs';

/** Whether a key of `devCycle.flows` is the flow of a kind of run, and so no squad's. */
export const isRunKindFlowKey = (key: string): boolean => (RUN_KIND_FLOW_KEYS as readonly string[]).includes(key);

/** The comments the app writes by itself on the tracking issue of a release: the activities of the version, a beta published, the stable published. */
export const RELEASE_COMMENT_EVENTS = ['activities', 'beta-published', 'stable-published'] as const;

/** The comment of a documentation run: the description of its pull request, in place of the issue flow's `pr`. */
export const DOCS_COMMENT_EVENTS = ['docs-pr'] as const;

/** The stages a release run follows, when the workspace has the release flow (the `release-flow` template puts it there); null otherwise. */
export const releaseFlowOf = (c: Pick<CycleView, 'devCycle'>): StageDef[] | null => c.devCycle.flows?.[RELEASE_FLOW_KEY] ?? null;

/** The stages a documentation run follows, when the workspace has the docs flow (the `docs-flow` template puts it there); null otherwise. */
export const docsFlowOf = (c: Pick<CycleView, 'devCycle'>): StageDef[] | null => c.devCycle.flows?.[DOCS_FLOW_KEY] ?? null;

/** Which kind of run a run is, by what it carries: a release (`subject`), documentation (`docs`), or null for an issue's. */
export const runKindOf = (run: { subject?: unknown; docs?: unknown }): RunKind | null => (run.subject ? 'release' : run.docs ? 'docs' : null);

/** The stages the flow of a run's own kind has in this workspace; null for an issue run, and for a kind whose template was not applied. */
export const runKindFlowOf = (c: Pick<CycleView, 'devCycle'>, run: { subject?: unknown; docs?: unknown }): StageDef[] | null => {
  const kind = runKindOf(run);
  return kind === 'release' ? releaseFlowOf(c) : kind === 'docs' ? docsFlowOf(c) : null;
};

/** The stages a squad's runs follow: its own flow when it has one, the workspace's otherwise. `null`: the workspace's. */
export const flowStagesOf = (c: Pick<CycleView, 'devCycle'>, squadId: string | null | undefined): StageDef[] => (squadId ? (c.devCycle.flows?.[squadId] ?? c.devCycle.stages) : c.devCycle.stages);

/**
 * The part of the config a run in `squadId` reads to resolve its flow: the squad's stages and the agents it may use. With no squad (or one the config no
 * longer has), the whole workspace.
 */
export function squadView(c: CycleView, squadId: string | null | undefined): { agents: { team: AgentDef[] }; devCycle: { stages: StageDef[] } } {
  if (!squadId || !squadOf(c, squadId)) return { agents: { team: effectiveTeam(c) }, devCycle: { stages: c.devCycle.stages } };
  return { agents: { team: scopedTeam(c, squadId) }, devCycle: { stages: flowStagesOf(c, squadId) } };
}

/** The squad an agent belongs to, when the config has it. */
export const squadOfAgent = (c: TeamView, agent: Pick<AgentDef, 'squad'>): SquadDef | null => squadOf(c, agent.squad);

/** The liaison of the squad of `agent`: null for a shared agent and for the liaison itself. */
export function liaisonFor(c: TeamView, agent: Pick<AgentDef, 'id' | 'squad'>): string | null {
  const squad = squadOf(c, agent.squad);
  if (!squad?.liaison || squad.liaison === agent.id) return null;
  return c.agents.team.some((a) => a.id === squad.liaison && a.squad === squad.id) ? squad.liaison : null;
}

/**
 * Whether `agent` runs by itself: its own switch, and, for a member of a squad, the squad's switch (a squad that is off holds every member, the liaison
 * included). The switch of a squad the config no longer has counts as on.
 */
export const autonomousOf = (c: TeamView, agent: Pick<AgentDef, 'autonomous' | 'squad'>): boolean => agent.autonomous && (squadOf(c, agent.squad)?.autonomy ?? true);

/**
 * Who a question of `agent` goes to first: the agent it turns to, when that is another agent of the team; else, for a member of a squad that is not its
 * liaison, the liaison (a member that turns to the person goes through the liaison first); else the person (null). A draft is no one to turn to.
 */
export function turnTarget(c: TeamView, agent: AgentDef): string | null {
  if (agent.turnsTo && agent.turnsTo !== agent.id && workingTeam(c.agents.team).some((a) => a.id === agent.turnsTo)) return agent.turnsTo;
  return liaisonFor(c, agent);
}

// ---- edits -------------------------------------------------------------------------------------------------------------------------------

const need = (c: SquadView, id: string): SquadDef => {
  const s = squadOf(c, id);
  if (!s) throw new Error(t('main.squad.unknown', { id }));
  return s;
};

export function addSquad(c: WorkspaceConfig, squad: Parameters<typeof newSquad>[0]): WorkspaceConfig {
  if (!ID_RE.test(squad.id)) throw new Error(t('main.squad.invalidId', { id: squad.id }));
  if (squadOf(c, squad.id)) throw new Error(t('main.squad.duplicate', { id: squad.id }));
  const next = structuredClone(c);
  next.squads = [...squadsOf(next), newSquad(squad)];
  return next;
}

export type SquadPatch = Partial<Omit<SquadDef, 'id'>>;

export function updateSquad(c: WorkspaceConfig, id: string, patch: SquadPatch): WorkspaceConfig {
  const current = need(c, id);
  const next = structuredClone(c);
  next.squads = squadsOf(next).map((s) => (s.id === id ? { ...current, ...structuredClone(patch), id } : s));
  return next;
}

/** Puts an agent in a squad (an agent belongs to one at most) or, with null, makes it shared. */
export function setAgentSquad(c: WorkspaceConfig, agentId: string, squadId: string | null): WorkspaceConfig {
  if (squadId) need(c, squadId);
  const agent = c.agents.team.find((a) => a.id === agentId);
  if (!agent) throw new Error(t('main.team.unknown', { id: agentId }));
  const next = structuredClone(c);
  const a = next.agents.team.find((x) => x.id === agentId) as AgentDef;
  if (squadId) a.squad = squadId;
  else delete a.squad;
  // An agent that leaves a squad stops being its liaison.
  next.squads = squadsOf(next).map((s) => (s.liaison === agentId && s.id !== squadId ? { ...s, liaison: null } : s));
  return next;
}

/** Removes a squad: its members become shared and its own flow goes. The runs it had are moved by the runner, after the person confirms (`Runner.removeSquad`). */
export function removeSquad(c: WorkspaceConfig, id: string): WorkspaceConfig {
  need(c, id);
  const next = structuredClone(c);
  next.squads = squadsOf(next).filter((s) => s.id !== id);
  for (const a of next.agents.team) if (a.squad === id) delete a.squad;
  if (next.devCycle.flows) delete next.devCycle.flows[id];
  return next;
}
