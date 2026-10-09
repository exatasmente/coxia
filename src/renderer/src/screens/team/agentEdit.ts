import { ID } from '../../../../shared/config/schema';
import { MAX_REGISTRY_HOSTS, isRegistryHost } from '../../../../shared/sandboxPaths';
import { flowStagesOf, setAgentSquad } from '../../../../shared/config/squads';
import { poolFieldsOf } from '../../../../shared/config/pool';
import { withoutLead } from '../../wizard/poolEdit';
import { addAgent, isDraft, isSystemId, modelPoolOf, removeAgent, stageAgent, updateAgent, workingTeam } from '../../../../shared/config/team';
import { t } from '../../../../shared/i18n';
import { MAX_POOL_ENTRIES, type AgentDef, type AgentModel, type AgentPermission, type AgentShell, type AgentToolsConfig, type AgentTracker, type LlmRole, type ModelPool, type ModelRef, type StageDef, type WorkspaceConfig } from '../../../../shared/config/types';
import { checkFlow, type FlowIssue } from '../../../../shared/runs/flowCheck';
import { checkSquads, type SquadIssue } from '../../../../shared/runs/squadCheck';
import { shown } from './text';

// The agent editor, as pure functions: the draft a person types into, the checks shown while typing, and the config the draft makes.

// The id helpers live in shared/ so the main process derives the id of an assistant's draft the same way; the editor and its tests keep importing them from here.
export { slugOf, uniqueId } from '../../../../shared/config/team';

const ID_RE = new RegExp(ID);

export interface AgentDraft {
  id: string;
  name: string;
  job: string;
  instructions: string;
  model: AgentModel;
  permission: AgentPermission;
  tracker: AgentTracker;
  shell: AgentShell;
  /** The commands the person allowed the agent always in a ceremony; the editor only takes rules away. */
  allowedCommands: string[];
  /** The tools this agent uses, when the person said so for this agent alone; null: the workspace's tools. */
  tools: AgentToolsConfig | null;
  autonomous: boolean;
  squad: string | null;
  turnsTo: string | null;
  /** The agent has a virtual screen and the app's browser. */
  screen: boolean;
  /** The hosts the agent may reach through the proxy (not used on `shell: host`). */
  allowedHosts: string[];
  /** The agent's browser keeps its logins between uses. */
  browserProfile: boolean;
  /** The stage ids the agent lists (the flow editor keeps them in step with the stages that name it). */
  stages: string[];
}

export type AgentField = 'id' | 'name' | 'model' | 'turnsTo' | 'shell' | 'allowedHosts';

export interface AgentProblem {
  field: AgentField;
  /** A catalog key of this screen. */
  key: string;
  params?: Record<string, string>;
}

export function draftOf(a: AgentDef): AgentDraft {
  return {
    id: a.id,
    name: a.name,
    job: a.job,
    instructions: a.instructions,
    model: { ...a.model },
    permission: a.permission,
    tracker: a.tracker,
    shell: a.shell,
    allowedCommands: [...(a.allowedCommands ?? [])],
    tools: a.tools ? { ...a.tools } : null,
    autonomous: a.autonomous,
    squad: a.squad ?? null,
    turnsTo: a.turnsTo,
    screen: a.screen === true,
    allowedHosts: [...(a.allowedHosts ?? [])],
    browserProfile: a.browserProfile === true,
    stages: [...a.stages],
  };
}

/**
 * The model of a draft after the person picks a role, or a provider and a model. The pool stays with the draft (it is only written while the agent has a model of its
 * own), a reserve that became the model itself leaves the list, and what was known of the old model (images, window, reasoning echo) is kept only for the same model.
 */
export function agentModelWith(model: AgentModel, next: { role: LlmRole } | { provider: string; model: string }): AgentModel {
  const lists = poolFieldsOf(model);
  if ('role' in next) return { role: next.role, provider: '', model: '', ...lists };
  const same = model.provider === next.provider && model.model === next.model;
  const marks = same ? { ...(model.images !== undefined ? { images: model.images } : {}), ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}), ...(model.echoReasoning !== undefined ? { echoReasoning: model.echoReasoning } : {}) } : {};
  return { role: null, provider: next.provider, model: next.model, ...marks, ...poolFieldsOf(withoutLead(lists, next)) };
}

/** The model of a draft with its pool replaced; the rest of the model stays. */
export function agentModelPool(model: AgentModel, pool: ModelPool): AgentModel {
  const { fallbacks: _f, activities: _a, ...rest } = model;
  return { ...rest, ...poolFieldsOf(pool) };
}

/** The problems of the pool of an agent's own model: a provider that is gone, a model twice in a list, a list that is too long. */
function poolProblems(config: WorkspaceConfig, model: AgentModel): AgentProblem[] {
  const out: AgentProblem[] = [];
  const check = (list: ModelRef[] | undefined, lead: ModelRef | null) => {
    const seen = new Set<string>(lead ? [`${lead.provider}\n${lead.model}`] : []);
    for (const r of list ?? []) {
      if (!config.llm.providers.some((p) => p.id === r.provider)) out.push({ field: 'model', key: 'ui.team.err.poolProvider', params: { provider: r.provider } });
      const k = `${r.provider}\n${r.model}`;
      if (seen.has(k)) out.push({ field: 'model', key: 'ui.team.err.poolDuplicate', params: { model: r.model } });
      seen.add(k);
    }
    if ((list?.length ?? 0) > MAX_POOL_ENTRIES) out.push({ field: 'model', key: 'ui.team.err.poolMax', params: { max: String(MAX_POOL_ENTRIES) } });
  };
  check(model.fallbacks, { provider: model.provider, model: model.model.trim() });
  for (const list of Object.values(model.activities ?? {})) check(list, null);
  return out;
}

export function blankAgent(): AgentDraft {
  return { id: '', name: '', job: '', instructions: '', model: { role: 'deep', provider: '', model: '' }, permission: 'read', tracker: 'none', shell: 'none', allowedCommands: [], tools: null, autonomous: false, squad: null, turnsTo: null, screen: false, allowedHosts: [], browserProfile: false, stages: [] };
}

/** What is wrong with the draft on its own (the checks that need the whole team come from `teamIssues`). */
export function agentProblems(config: WorkspaceConfig, draft: AgentDraft, isNew: boolean): AgentProblem[] {
  const out: AgentProblem[] = [];
  if (!draft.name.trim()) out.push({ field: 'name', key: 'ui.team.err.name' });
  if (isNew) {
    if (!ID_RE.test(draft.id)) out.push({ field: 'id', key: 'ui.team.err.idShape' });
    else if (isSystemId(draft.id)) out.push({ field: 'id', key: 'ui.team.err.idReserved', params: { id: draft.id } });
    else if (config.agents.team.some((a) => a.id === draft.id)) out.push({ field: 'id', key: 'ui.team.err.idTaken', params: { id: draft.id } });
  }
  if (draft.model.role === null) {
    if (!config.llm.providers.some((p) => p.id === draft.model.provider)) out.push({ field: 'model', key: 'ui.team.err.provider' });
    else if (!draft.model.model.trim()) out.push({ field: 'model', key: 'ui.team.err.modelName' });
    out.push(...poolProblems(config, draft.model));
  }
  // Commands in the real worktree could leave files that the app then commits for an agent that promised only to read: a reader runs commands in a sandbox.
  if (draft.shell === 'allowlist' && draft.permission !== 'worktree') out.push({ field: 'shell', key: 'ui.team.err.allowlist' });
  // The same rules the file is checked with (validate.ts): one message for the list, one per host that is not a plain host name.
  const hosts = draft.allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const bad = hosts.find((h) => !isRegistryHost(h));
  if (bad !== undefined) out.push({ field: 'allowedHosts', key: 'ui.team.err.allowedHost', params: { host: bad } });
  else if (hosts.length > MAX_REGISTRY_HOSTS) out.push({ field: 'allowedHosts', key: 'ui.team.err.allowedHostsMax', params: { max: String(MAX_REGISTRY_HOSTS) } });
  return out;
}

/** The shell a draft has after its permission changes: `allowlist` needs the permission to write, so a reader falls to `none`. */
export const shellAfterPermission = (shell: AgentShell, permission: AgentPermission): AgentShell => (shell === 'allowlist' && permission !== 'worktree' ? 'none' : shell);

/** The hosts of the form as the config keeps them: trimmed, lowercase, once each; null when there are none. */
function hostsOf(draft: AgentDraft): string[] | null {
  const hosts = [...new Set(draft.allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  return hosts.length ? hosts : null;
}

/** The fields of an agent that the form holds, as the config keeps them. */
function fieldsOf(draft: AgentDraft) {
  return {
    name: draft.name.trim(),
    job: draft.job.trim(),
    instructions: draft.instructions,
    model: draft.model.role ? { role: draft.model.role, provider: '', model: '' } : { role: null, provider: draft.model.provider, model: draft.model.model.trim(), ...modelPoolOf(draft.model) },
    permission: draft.permission,
    tracker: draft.tracker,
    shell: draft.shell,
    allowedCommands: draft.allowedCommands.length ? draft.allowedCommands : undefined,
    tools: draft.tools ?? undefined,
    autonomous: draft.autonomous,
    turnsTo: draft.turnsTo,
    // Absent means off and empty: the editor writes none of the three for an agent that has none, and clearing one removes the field.
    screen: draft.screen ? true : undefined,
    allowedHosts: hostsOf(draft) ?? undefined,
    browserProfile: draft.browserProfile ? true : undefined,
    stages: draft.stages,
  };
}

/** The squad of the draft, set only when it differs from the agent's now (setting it also frees the squad the agent leaves of its liaison). */
function withSquad(next: WorkspaceConfig, draft: AgentDraft): WorkspaceConfig {
  const current = next.agents.team.find((a) => a.id === draft.id)?.squad ?? null;
  return current === draft.squad ? next : setAgentSquad(next, draft.id, draft.squad);
}

/** The config the draft makes: the agent added or edited, and its squad. Throws what the pure edits throw (a taken id). */
export function applyAgent(config: WorkspaceConfig, draft: AgentDraft, isNew: boolean): WorkspaceConfig {
  const fields = fieldsOf(draft);
  const next = isNew ? addAgent(config, { id: draft.id, ...fields }) : updateAgent(config, draft.id, fields);
  return withSquad(next, draft);
}

/**
 * The config a draft agent of the assistant becomes when the person saves the editor: the same edit as any other, and the mark of a draft leaves the agent in the
 * same write, so its stages, squad and `turnsTo` start to count from here. Refuses an agent that is not a draft: the editor in this mode never opens on one.
 */
export function promoteDraft(config: WorkspaceConfig, draft: AgentDraft): WorkspaceConfig {
  const found = config.agents.team.find((a) => a.id === draft.id);
  if (!found) throw new Error(t('main.team.unknown', { id: draft.id }));
  if (!isDraft(found)) throw new Error(t('main.assist.error.notDraft', { id: draft.id }));
  // `updateAgent` drops a key the patch sets to undefined.
  return withSquad(updateAgent(config, draft.id, { ...fieldsOf(draft), draft: undefined }), draft);
}

const flowInput = (c: WorkspaceConfig) => ({ stages: c.devCycle.stages, team: c.agents.team, extraStages: Object.values(c.devCycle.flows ?? {}).flat() });

/**
 * The checks of the whole team that are about this agent, over the config the draft makes (who it turns to, a loop, idle, its squad). For a draft agent being
 * promoted (`promote`) that is the config with the mark gone: the checks leave a draft out of the team, so over the config as it is now they would not see a problem
 * of the agent that is about to be saved.
 */
export function teamIssues(config: WorkspaceConfig, draft: AgentDraft, isNew: boolean, promote = false): { flow: FlowIssue[]; squad: SquadIssue[] } {
  let next: WorkspaceConfig;
  try {
    next = promote ? promoteDraft(config, draft) : applyAgent(config, draft, isNew);
  } catch {
    return { flow: [], squad: [] };
  }
  const flow = checkFlow(flowInput(next)).filter((i) => i.agent === draft.id);
  const squad = checkSquads({ squads: next.squads ?? [], team: next.agents.team, stages: next.devCycle.stages, flows: next.devCycle.flows }).filter((i) => i.agent === draft.id);
  return { flow, squad };
}

export interface LostStage {
  stage: string;
  label: string;
  /** The squad whose own flow it is; null: the workspace's flow. */
  squad: string | null;
}

/** The stages that have no agent once `id` is removed, the ones it works today and nobody else would take over. */
export function stagesLosingAgent(config: WorkspaceConfig, id: string): LostStage[] {
  const lost: LostStage[] = [];
  let after: WorkspaceConfig;
  try {
    after = removeAgent(config, id);
  } catch {
    return lost;
  }
  const flows: [string | null, StageDef[], StageDef[]][] = [[null, config.devCycle.stages, after.devCycle.stages]];
  for (const squad of Object.keys(config.devCycle.flows ?? {})) flows.push([squad, flowStagesOf(config, squad), flowStagesOf(after, squad)]);
  for (const [squad, before, now] of flows) {
    for (const s of before) {
      if ((s.type ?? 'work') !== 'work') continue;
      if (stageAgent(config.agents.team, before, s.id)?.id !== id) continue;
      if (!stageAgent(after.agents.team, now, s.id)) lost.push({ stage: s.id, label: shown(s.label) || s.id, squad });
    }
  }
  return lost;
}

/** The agents a question of this one could pass to: everyone but itself, and no draft (it takes no part in a run). */
export const turnsToChoices = (config: WorkspaceConfig, id: string): AgentDef[] => workingTeam(config.agents.team).filter((a) => a.id !== id);

/** The stages an agent works, for the list: the stages that name it, then the ones it lists. */
export function stagesOfAgent(config: WorkspaceConfig, a: AgentDef): StageDef[] {
  const all = [config.devCycle.stages, ...Object.values(config.devCycle.flows ?? {})].flat();
  const seen = new Set<string>();
  const out: StageDef[] = [];
  for (const s of all) {
    if (seen.has(s.id)) continue;
    if (s.agentId === a.id || (!s.agentId && a.stages.includes(s.id))) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}
