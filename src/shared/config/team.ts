import { t } from '../i18n';
import { ID } from './schema';
import { LLM_ROLES, type AgentDef, type AgentModel, type AgentRoleConfig, type DevCycleConfig, type LlmRole, type StageDef, type WorkspaceConfig } from './types';

// The agent team: the five built-in (system) agents, the helpers that keep them in place, and the pure edits Settings makes.
// Everything here takes a config and returns a new one; validation is the caller's (saveConfig).

type RoleSeed = Partial<Pick<AgentRoleConfig, 'modelRole' | 'extraInstructions'>>;

const ID_RE = new RegExp(ID);

export const isSystemId = (id: string): boolean => (LLM_ROLES as readonly string[]).includes(id);

/** The built-in agent of an LLM role. It is what the ceremonies call, so it takes the role's model and extra instructions as they are. */
export function systemAgent(role: LlmRole, seed: RoleSeed = {}): AgentDef {
  const modelRole = (LLM_ROLES as readonly string[]).includes(seed.modelRole as string) ? (seed.modelRole as LlmRole) : role;
  return {
    id: role,
    name: `cycle.team.system.${role}.name`,
    job: `cycle.team.system.${role}.job`,
    model: { role: modelRole, provider: '', model: '' },
    stages: [],
    permission: 'read',
    autonomous: false,
    instructions: typeof seed.extraInstructions === 'string' ? seed.extraInstructions : '',
    system: true,
  };
}

export function systemAgents(roles: Partial<Record<LlmRole, RoleSeed>> = {}): AgentDef[] {
  return LLM_ROLES.map((r) => systemAgent(r, roles[r] ?? {}));
}

/** An agent with every field filled: the id is the only thing that cannot be guessed. A new agent borrows the model of the `deep` role and only reads. */
export function newAgent(partial: Pick<AgentDef, 'id'> & Partial<Omit<AgentDef, 'model'>> & { model?: Partial<AgentModel> }): AgentDef {
  const m = partial.model;
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    job: partial.job ?? '',
    model: m ? { role: m.role ?? null, provider: m.provider ?? '', model: m.model ?? '' } : { role: 'deep', provider: '', model: '' },
    stages: partial.stages ?? [],
    permission: partial.permission ?? 'read',
    autonomous: partial.autonomous ?? false,
    instructions: partial.instructions ?? '',
    system: partial.system ?? false,
  };
}

/** The team with whichever system agent is missing added back (seeded from the roles), so a file can never lose one. */
export function ensureSystemAgents(team: AgentDef[], roles: Partial<Record<LlmRole, RoleSeed>> = {}): AgentDef[] {
  const have = new Set(team.map((a) => a.id));
  return [...team, ...LLM_ROLES.filter((r) => !have.has(r)).map((r) => systemAgent(r, roles[r] ?? {}))];
}

/**
 * The agent that works a stage: the one the stage names, else the first agent of the team that lists the stage, else none.
 * A gate (`human`) never has one.
 */
export function stageAgent(team: AgentDef[], stages: StageDef[], stageId: string): AgentDef | null {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage || stage.human) return null;
  const named = stage.agentId ? team.find((a) => a.id === stage.agentId) : undefined;
  return named ?? team.find((a) => a.stages.includes(stageId)) ?? null;
}

export type AgentPatch = Partial<Omit<AgentDef, 'id' | 'system'>>;

const find = (config: WorkspaceConfig, id: string): AgentDef => {
  const a = config.agents.team.find((x) => x.id === id);
  if (!a) throw new Error(t('main.team.unknown', { id }));
  return a;
};

/** Adds an agent the person created. It is never a system agent and its id is free. */
export function addAgent(config: WorkspaceConfig, agent: Pick<AgentDef, 'id'> & Partial<Omit<AgentDef, 'model'>> & { model?: Partial<AgentModel> }): WorkspaceConfig {
  if (!ID_RE.test(agent.id)) throw new Error(t('main.team.invalidId', { id: agent.id }));
  if (isSystemId(agent.id)) throw new Error(t('main.team.reserved', { id: agent.id }));
  if (config.agents.team.some((a) => a.id === agent.id)) throw new Error(t('main.team.duplicate', { id: agent.id }));
  const next = structuredClone(config);
  next.agents.team.push(newAgent({ ...agent, system: false }));
  return next;
}

/**
 * Edits an agent. A system agent mirrors its model role and instructions into `agents.roles`, which is what the ceremonies read;
 * a system agent given an explicit provider and model keeps the role entry as it was.
 */
export function updateAgent(config: WorkspaceConfig, id: string, patch: AgentPatch): WorkspaceConfig {
  const current = find(config, id);
  const next = structuredClone(config);
  const i = next.agents.team.findIndex((a) => a.id === id);
  const merged: AgentDef = { ...current, ...structuredClone(patch), id: current.id, system: current.system };
  next.agents.team[i] = merged;
  if (current.system && isSystemId(id)) {
    const role = next.agents.roles[id as LlmRole];
    if (merged.model.role) role.modelRole = merged.model.role;
    role.extraInstructions = merged.instructions;
  }
  return next;
}

/** Removes an agent the person created and clears the stages that named it. A system agent cannot be removed. */
export function removeAgent(config: WorkspaceConfig, id: string): WorkspaceConfig {
  const a = find(config, id);
  if (a.system) throw new Error(t('main.team.systemLocked', { id }));
  const next = structuredClone(config);
  next.agents.team = next.agents.team.filter((x) => x.id !== id);
  for (const s of next.devCycle.stages) if (s.agentId === id) delete s.agentId;
  return next;
}

/** Drops from every agent the stage ids the cycle does not have, so a cycle swap leaves no dangling reference. */
export function pruneAgentStages(team: AgentDef[], cycle: Pick<DevCycleConfig, 'stages'>): AgentDef[] {
  const ids = new Set(cycle.stages.map((s) => s.id));
  return team.map((a) => (a.stages.every((s) => ids.has(s)) ? a : { ...a, stages: a.stages.filter((s) => ids.has(s)) }));
}
