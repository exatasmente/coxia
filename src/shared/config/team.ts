import { t } from '../i18n';
import { ID } from './schema';
import { LLM_ROLES, type AgentDef, type AgentModel, type AgentRoleConfig, type AgentShell, type AgentToolsConfig, type AgentTracker, type DevCycleConfig, type LlmRole, type StageDef, type WorkspaceConfig } from './types';

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
    // The ceremonies read the code host (when the workspace's tools allow it); the agent of a ceremony says so, and turning it off takes that read away.
    tracker: 'read',
    shell: 'none',
    autonomous: false,
    turnsTo: null,
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
    // What an agent could do before the two fields existed: an agent that writes ran the commands of the workspace, one that reads ran none and had no say about the host.
    tracker: partial.tracker ?? 'none',
    shell: partial.shell ?? ((partial.permission ?? 'read') === 'worktree' ? 'allowlist' : 'none'),
    ...(partial.allowedCommands?.length ? { allowedCommands: [...partial.allowedCommands] } : {}),
    ...(partial.tools ? { tools: { ...partial.tools } } : {}),
    autonomous: partial.autonomous ?? false,
    turnsTo: partial.turnsTo ?? null,
    ...(partial.squad !== undefined ? { squad: partial.squad } : {}),
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
 * A gate and a wait never have one.
 */
export function stageAgent(team: AgentDef[], stages: StageDef[], stageId: string): AgentDef | null {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage || (stage.type && stage.type !== 'work')) return null;
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
  // A field the patch sets to undefined is dropped: the editor clears the last allowed command that way, and a key left holding undefined fails the schema.
  for (const key of Object.keys(merged) as (keyof AgentDef)[]) if (merged[key] === undefined) delete merged[key];
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
  for (const flow of Object.values(next.devCycle.flows ?? {})) for (const s of flow) if (s.agentId === id) delete s.agentId;
  // A squad whose liaison leaves has none until the person picks another (validation says so).
  next.squads = (next.squads ?? []).map((q) => (q.liaison === id ? { ...q, liaison: null } : q));
  return next;
}

/** Drops from every agent the stage ids the cycle does not have, so a cycle swap leaves no dangling reference. */
export function pruneAgentStages(team: AgentDef[], cycle: Pick<DevCycleConfig, 'stages' | 'flows'>): AgentDef[] {
  // The stages of a squad's own flow count too: an agent of that squad works them.
  const ids = new Set([...cycle.stages, ...Object.values(cycle.flows ?? {}).flat()].map((s) => s.id));
  return team.map((a) => (a.stages.every((s) => ids.has(s)) ? a : { ...a, stages: a.stages.filter((s) => ids.has(s)) }));
}

/** How far each permission reaches, lowest first: a change to a higher value gives an agent more than it had. */
const SHELL_RANK: Record<AgentShell, number> = { none: 0, allowlist: 1, sandbox: 2, host: 3 };
const TRACKER_RANK: Record<AgentTracker, number> = { none: 0, read: 1 };

/**
 * The tools an agent uses: its own when the person set them for that agent, otherwise the workspace's. Field by field, so an agent can have a tool the workspace
 * turned off (`files: true` on the agent even when `agents.tools.files` is false).
 */
export function toolsForAgent(config: WorkspaceConfig, agent: Pick<AgentDef, 'tools'>): AgentToolsConfig {
  return agent.tools ? { ...config.agents.tools, ...agent.tools } : config.agents.tools;
}

/** Whether `to` lets an agent run more than `from` did. */
export const shellRaised = (from: AgentShell, to: AgentShell): boolean => SHELL_RANK[to] > SHELL_RANK[from];

/** Whether `to` lets an agent read more of the code host than `from` did. */
export const trackerRaised = (from: AgentTracker, to: AgentTracker): boolean => TRACKER_RANK[to] > TRACKER_RANK[from];

/** The shell a value comes to where no sandbox works: `sandbox` is lowered to what the agent could do before it (`allowlist` when it writes, else `none`). */
export const withoutSandbox = (shell: AgentShell, permission: AgentDef['permission']): AgentShell => (shell === 'sandbox' ? (permission === 'worktree' ? 'allowlist' : 'none') : shell);

/** What each agent of the shipped teams is recommended to have, by id (the roles of the agent cycle and of the engineering cycle). */
export const RECOMMENDED: Record<string, { tracker: AgentTracker; shell: AgentShell }> = {
  support: { tracker: 'none', shell: 'none' },
  'product-owner': { tracker: 'read', shell: 'none' },
  'tech-lead': { tracker: 'read', shell: 'sandbox' },
  developer: { tracker: 'none', shell: 'sandbox' },
  qa: { tracker: 'none', shell: 'sandbox' },
  'customer-success': { tracker: 'none', shell: 'none' },
  refiner: { tracker: 'read', shell: 'none' },
  planner: { tracker: 'read', shell: 'sandbox' },
  reviewer: { tracker: 'read', shell: 'sandbox' },
  'release-manager': { tracker: 'read', shell: 'none' },
};

export interface Recommendation {
  id: string;
  tracker: AgentTracker;
  shell: AgentShell;
  /** What the agent has now. */
  from: { tracker: AgentTracker; shell: AgentShell };
}

/**
 * The agents of the team whose permissions differ from the recommendation of their role. Nothing here is applied: the team editor offers it. Where no sandbox works
 * the shell recommended is the one the agent could have before sandboxes (`allowlist` for one that writes, else `none`).
 */
export function recommendations(config: WorkspaceConfig, sandbox: boolean): Recommendation[] {
  const out: Recommendation[] = [];
  for (const a of config.agents.team) {
    const want = RECOMMENDED[a.id];
    if (!want || a.system) continue;
    const shell = sandbox ? want.shell : withoutSandbox(want.shell, a.permission);
    if (a.tracker !== want.tracker || a.shell !== shell) out.push({ id: a.id, tracker: want.tracker, shell, from: { tracker: a.tracker, shell: a.shell } });
  }
  return out;
}

/** The team with the recommendation applied to the agents it names (the editor's one button). */
export function applyRecommendations(config: WorkspaceConfig, list: Recommendation[]): WorkspaceConfig {
  const next = structuredClone(config);
  for (const r of list) {
    const a = next.agents.team.find((x) => x.id === r.id);
    if (a) Object.assign(a, { tracker: r.tracker, shell: r.shell });
  }
  return next;
}
