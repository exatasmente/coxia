import { ID } from '../../../../shared/config/schema';
import { flowStagesOf, setAgentSquad } from '../../../../shared/config/squads';
import { addAgent, isSystemId, removeAgent, stageAgent, updateAgent } from '../../../../shared/config/team';
import type { AgentDef, AgentModel, AgentPermission, AgentShell, AgentToolsConfig, AgentTracker, StageDef, WorkspaceConfig } from '../../../../shared/config/types';
import { checkFlow, type FlowIssue } from '../../../../shared/runs/flowCheck';
import { checkSquads, type SquadIssue } from '../../../../shared/runs/squadCheck';
import { shown } from './text';

// The agent editor, as pure functions: the draft a person types into, the checks shown while typing, and the config the draft makes.

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
  /** The stage ids the agent lists (the flow editor keeps them in step with the stages that name it). */
  stages: string[];
}

export type AgentField = 'id' | 'name' | 'model' | 'turnsTo' | 'shell';

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
    stages: [...a.stages],
  };
}

export function blankAgent(): AgentDraft {
  return { id: '', name: '', job: '', instructions: '', model: { role: 'deep', provider: '', model: '' }, permission: 'read', tracker: 'none', shell: 'none', allowedCommands: [], tools: null, autonomous: false, squad: null, turnsTo: null, stages: [] };
}

/** A lowercase id from a name: letters and digits kept (accents folded), anything else a dash. */
export function slugOf(text: string): string {
  const folded = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return slug;
}

/** `base`, or `base-2`, `base-3`... the first one `taken` does not hold. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base || 'item';
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root.slice(0, 44)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
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
  }
  // Commands in the real worktree could leave files that the app then commits for an agent that promised only to read: a reader runs commands in a sandbox.
  if (draft.shell === 'allowlist' && draft.permission !== 'worktree') out.push({ field: 'shell', key: 'ui.team.err.allowlist' });
  return out;
}

/** The shell a draft has after its permission changes: `allowlist` needs the permission to write, so a reader falls to `none`. */
export const shellAfterPermission = (shell: AgentShell, permission: AgentPermission): AgentShell => (shell === 'allowlist' && permission !== 'worktree' ? 'none' : shell);

/** The config the draft makes: the agent added or edited, and its squad. Throws what the pure edits throw (a taken id). */
export function applyAgent(config: WorkspaceConfig, draft: AgentDraft, isNew: boolean): WorkspaceConfig {
  const fields = {
    name: draft.name.trim(),
    job: draft.job.trim(),
    instructions: draft.instructions,
    model: draft.model.role ? { role: draft.model.role, provider: '', model: '' } : { role: null, provider: draft.model.provider, model: draft.model.model.trim() },
    permission: draft.permission,
    tracker: draft.tracker,
    shell: draft.shell,
    allowedCommands: draft.allowedCommands.length ? draft.allowedCommands : undefined,
    tools: draft.tools ?? undefined,
    autonomous: draft.autonomous,
    turnsTo: draft.turnsTo,
    stages: draft.stages,
  };
  const next = isNew ? addAgent(config, { id: draft.id, ...fields }) : updateAgent(config, draft.id, fields);
  const current = next.agents.team.find((a) => a.id === draft.id)?.squad ?? null;
  return current === draft.squad ? next : setAgentSquad(next, draft.id, draft.squad);
}

const flowInput = (c: WorkspaceConfig) => ({ stages: c.devCycle.stages, team: c.agents.team, extraStages: Object.values(c.devCycle.flows ?? {}).flat() });

/** The checks of the whole team that are about this agent, over the config the draft makes (who it turns to, a loop, idle, its squad). */
export function teamIssues(config: WorkspaceConfig, draft: AgentDraft, isNew: boolean): { flow: FlowIssue[]; squad: SquadIssue[] } {
  let next: WorkspaceConfig;
  try {
    next = applyAgent(config, draft, isNew);
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

/** The ids of the agents a question of this one could pass to: everyone but itself. */
export const turnsToChoices = (config: WorkspaceConfig, id: string): AgentDef[] => config.agents.team.filter((a) => a.id !== id);

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
