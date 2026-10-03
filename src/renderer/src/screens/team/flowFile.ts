import { agentFlowComments } from '../../../../shared/cycles/templates/agentFlowComments';
import { ENGINEERING_FLOW_STAGES, agentFlowTeam, engineeringTeam } from '../../../../shared/cycles/templates/agentFlow';
import { exportTemplateText, parseTemplate } from '../../../../shared/cycles/apply';
import type { CycleTemplate } from '../../../../shared/cycles/types';
import { COMMENT_EVENT_KEYS, type AgentDef, type CommentTemplate, type StageDef, type WorkspaceConfig } from '../../../../shared/config/types';
import { isFlowCycle } from '../../../../shared/runs/flow';
import { AGENT_FLOW_STAGES } from '../../../../shared/cycles/templates/agentFlow';
import { renumber, withStages, type FlowDraft, type Target } from './flowEdit';

// Where a flow comes from and where it goes: the starting flows the editor offers, and the file a flow is exported to and imported from. A flow file is a
// cycle template file with the flow in it (the format the app already has, `coxia-cycle-template`), so the same checks read it.

/** What a flow brings with it: its stages, the agents it names that the workspace may lack, and the comments of its stages. */
export interface FlowBundle {
  stages: StageDef[];
  team: AgentDef[];
  comments: Record<string, CommentTemplate>;
}

export interface Starter {
  id: string;
  /** A catalog key. */
  name: string;
  /** A catalog key. */
  description: string;
  bundle: () => FlowBundle;
}

// The engineering flow without its two gates: nobody stops the work, the review and QA still send it back.
const shortStages = (): StageDef[] => renumber(structuredClone(ENGINEERING_FLOW_STAGES).filter((s) => s.type !== 'gate'));

export const STARTERS: Starter[] = [
  { id: 'agent-flow', name: 'cycle.agentFlow.name', description: 'cycle.agentFlow.description', bundle: () => ({ stages: structuredClone(AGENT_FLOW_STAGES), team: agentFlowTeam(), comments: agentFlowComments(true) }) },
  { id: 'agent-flow-engineering', name: 'cycle.agentFlowEngineering.name', description: 'cycle.agentFlowEngineering.description', bundle: () => ({ stages: structuredClone(ENGINEERING_FLOW_STAGES), team: engineeringTeam(), comments: agentFlowComments(false) }) },
  { id: 'agent-flow-short', name: 'ui.flow.starter.short.name', description: 'ui.flow.starter.short.description', bundle: () => ({ stages: shortStages(), team: engineeringTeam(), comments: agentFlowComments(false) }) },
];

/**
 * The draft with `bundle` as the flow of `target`. The agents it brings that the workspace lacks join the draft's new agents (one the workspace has is left as it
 * is), and so do the comments of stages that have no template.
 */
export function applyBundle(d: FlowDraft, config: WorkspaceConfig, target: Target, bundle: FlowBundle): FlowDraft {
  const have = new Set([...config.agents.team, ...d.newAgents].map((a) => a.id));
  const added = bundle.team.filter((a) => !a.system && !have.has(a.id)).map((a) => ({ ...structuredClone(a), squad: undefined }));
  const next = withStages(d, target, renumber(structuredClone(bundle.stages)));
  const comments = { ...next.comments };
  for (const [key, tpl] of Object.entries(bundle.comments)) if (!config.devCycle.comments[key] && !comments[key]) comments[key] = structuredClone(tpl);
  return { ...next, newAgents: [...next.newAgents, ...added], comments };
}

export interface ExportMeta {
  id: string;
  name: string;
}

const toRole = (a: AgentDef): AgentDef => {
  const { squad: _squad, ...rest } = structuredClone(a);
  // A provider and a model are this machine's: the file asks for the app's default role instead, so it opens anywhere and carries nothing of the setup.
  return { ...rest, model: { role: a.model.role ?? 'deep', provider: '', model: '' } } as AgentDef;
};

/** The text of the flow file for `stages`: the stages, the agents of the team that work them (never a built-in one) and the comments of their stages. */
export function exportFlowText(config: WorkspaceConfig, stages: StageDef[], meta: ExportMeta, now: Date): string {
  const named = new Set(stages.flatMap((s) => (s.agentId ? [s.agentId] : [])));
  const team = config.agents.team.filter((a) => !a.system && named.has(a.id)).map(toRole);
  const keys = new Set<string>([...COMMENT_EVENT_KEYS, ...stages.flatMap((s) => (s.comment === undefined ? [s.id] : s.comment ? [s.comment] : []))]);
  const comments = Object.fromEntries(Object.entries(config.devCycle.comments).filter(([k]) => keys.has(k)).map(([k, v]) => [k, structuredClone(v)]));
  const template: CycleTemplate = { id: meta.id, name: meta.name, description: '', needs: [], devCycle: { templateId: meta.id, stages: structuredClone(stages), comments }, ...(team.length ? { team } : {}) };
  return exportTemplateText(template, now);
}

export type FlowRead = { ok: true; bundle: FlowBundle; warnings: string[] } | { ok: false; errors: string[]; notFlow?: boolean };

const issueText = (i: { path: string; message: string }): string => (i.path ? `${i.path}: ${i.message}` : i.message);

/** Reads a flow file: it must be JSON, a valid template, and a flow (stages with a type), and everything the template check finds is reported with its path. */
export function readFlowText(text: string): FlowRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const check = parseTemplate(raw);
  if (!check.ok || !check.template) return { ok: false, errors: check.errors.map(issueText) };
  const { devCycle, team } = check.template;
  const stages = (devCycle.stages ?? []) as StageDef[];
  if (!stages.length || !isFlowCycle(stages)) return { ok: false, errors: [], notFlow: true };
  return { ok: true, bundle: { stages, team: team ?? [], comments: (devCycle.comments ?? {}) as Record<string, CommentTemplate> }, warnings: check.warnings.map(issueText) };
}
