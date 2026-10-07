import { ID } from '../../../../shared/config/schema';
import { RUN_KIND_FLOW_KEYS } from '../../../../shared/config/squads';
import { newAgent } from '../../../../shared/config/team';
import { DEFAULT_ROUND_LIMIT, type AgentDef, type CommentTemplate, type FlowAutonomy, type StageDef, type StageKind, type StageType, type WorkspaceConfig } from '../../../../shared/config/types';
import { newFlowAutonomy } from '../../../../shared/config/autonomy';
import { isWork } from '../../../../shared/runs/flow';
import { checkFlow, type FlowIssue } from '../../../../shared/runs/flowCheck';
import { checkSquads, type SquadIssue } from '../../../../shared/runs/squadCheck';
import { pruneAgentStages } from '../../../../shared/config/team';

// The flow editor, as pure functions: the stages as a list that is reordered, grown and cut; the draft that holds every flow being edited with the agents
// made on the way; the checks shown on the rows; and the config the draft makes. Nothing here draws.

const ID_RE = new RegExp(ID);
// The shapes the schema accepts (config/schema.ts); test/team-flow-edit.test.ts holds the two together.
const ARTIFACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMENT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** A flow target: a squad id, or null for the workspace's own flow. */
export type Target = string | null;

export interface FlowDraft {
  /** The workspace's flow. */
  workspace: StageDef[];
  /** The flows squads have of their own. A squad with no entry follows the workspace's. */
  flows: Record<string, StageDef[]>;
  /** The autonomy block of each flow, by the flow's key (`''` for the workspace's, a squad id for a squad's). Absent: everything off and the workspace's block deciding. */
  autonomy: Record<string, FlowAutonomy>;
  /** Agents made while editing (from a starter, a file or the stage panel): they join the team when the flow is saved. */
  newAgents: AgentDef[];
  /** Comment templates a starter or a file brought for stages that had none: they join the config when the flow is saved. */
  comments: Record<string, CommentTemplate>;
  /** Stage ids that were changed, old to new, so what refers to them by id (an agent's stage list, a comment, a mapping) follows. */
  renames: Record<string, string>;
}

export function draftOfFlows(config: WorkspaceConfig): FlowDraft {
  return { workspace: structuredClone(config.devCycle.stages), flows: structuredClone(config.devCycle.flows ?? {}), autonomy: structuredClone(config.devCycle.autonomy ?? {}), newAgents: [], comments: {}, renames: {} };
}

/** The flow key a target is stored under: `''` for the workspace's own flow, the squad id for a squad's. */
export const flowKeyOfTarget = (target: Target): string => target ?? '';

/** The autonomy block of a flow, filled out: a flow with none reads as one that follows the workspace, everything off. */
export const autonomyOfTarget = (d: FlowDraft, target: Target): FlowAutonomy => newFlowAutonomy(d.autonomy[flowKeyOfTarget(target)]);

/** The draft with one flow's autonomy block replaced. */
export function withAutonomy(d: FlowDraft, target: Target, patch: Partial<FlowAutonomy>): FlowDraft {
  return { ...d, autonomy: { ...d.autonomy, [flowKeyOfTarget(target)]: { ...autonomyOfTarget(d, target), ...patch } } };
}

export const stagesOfTarget = (d: FlowDraft, target: Target): StageDef[] => (target ? (d.flows[target] ?? d.workspace) : d.workspace);
export const ownsFlow = (d: FlowDraft, target: Target): boolean => !target || !!d.flows[target];

/** The draft with `stages` as the flow of `target` (a squad that had none gets its own). */
export function withStages(d: FlowDraft, target: Target, stages: StageDef[]): FlowDraft {
  return target ? { ...d, flows: { ...d.flows, [target]: stages } } : { ...d, workspace: stages };
}

/** A squad goes back to the workspace's flow. */
export function dropOwnFlow(d: FlowDraft, squad: string): FlowDraft {
  const { [squad]: _gone, ...rest } = d.flows;
  return { ...d, flows: rest };
}

/** A squad gets a flow of its own, starting as a copy of the workspace's. */
export const giveOwnFlow = (d: FlowDraft, squad: string): FlowDraft => withStages(d, squad, structuredClone(d.workspace));

// ---- the list ---------------------------------------------------------------------------------------------------------------------------

/** `rank` follows the position: the flow runs in the order it is listed. */
export const renumber = (stages: StageDef[]): StageDef[] => stages.map((s, i) => (s.rank === Math.min(100, i + 1) ? s : { ...s, rank: Math.min(100, i + 1) }));

/** The stage at `from` moved to position `to`. */
export function moveStage(stages: StageDef[], from: number, to: number): StageDef[] {
  if (from === to || from < 0 || from >= stages.length || to < 0 || to >= stages.length) return stages;
  const next = [...stages];
  const [one] = next.splice(from, 1);
  next.splice(to, 0, one);
  return renumber(next);
}

/** One step up (-1) or down (+1). */
export function moveBy(stages: StageDef[], id: string, delta: -1 | 1): StageDef[] {
  const i = stages.findIndex((s) => s.id === id);
  return i < 0 ? stages : moveStage(stages, i, i + delta);
}

/** `base`, or `base-2`... the first id the stages do not use. */
export function newStageId(stages: StageDef[], base: string): string {
  const used = new Set(stages.map((s) => s.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base.slice(0, 44)}-${n}`)) return `${base.slice(0, 44)}-${n}`;
}

// A review, a QA pass and an end are what a new stage must not inherit the meaning of.
const KEEP_KIND = new Set<StageKind>(['backlog', 'development']);

/**
 * A new stage of `type` after position `after` (-1: at the start). It takes the meaning of the stage before it when that is a plain one. When the stage before
 * it said where to go next by name and that was the stage that followed, it now goes to the new one and the new one goes on to it, so the flow stays connected.
 */
export function insertStage(stages: StageDef[], after: number, type: StageType, label: string): { stages: StageDef[]; id: string } {
  const prev = stages[after];
  const id = newStageId(stages, type);
  const stage: StageDef = {
    id,
    label,
    match: [],
    kind: prev && KEEP_KIND.has(prev.kind) ? prev.kind : 'development',
    rank: 0,
    type,
    ...(type === 'wait' ? { waitsFor: { kind: 'pr-merged' as const } } : {}),
  };
  const after1 = stages[after + 1];
  const next = stages.map((s, i) => (i === after && s.next && after1 && s.next === after1.id ? { ...s, next: id } : s));
  if (prev && prev.next && after1 && prev.next === after1.id) stage.next = after1.id;
  next.splice(after + 1, 0, stage);
  return { stages: renumber(next), id };
}

/** A copy right after the stage. It produces nothing yet (two stages cannot write the same file) and follows the list for what comes next. */
export function duplicateStage(stages: StageDef[], id: string, copyLabel: string): { stages: StageDef[]; id: string } {
  const i = stages.findIndex((s) => s.id === id);
  if (i < 0) return { stages, id };
  const copyId = newStageId(stages, `${id.slice(0, 43)}-copy`);
  const copy: StageDef = { ...structuredClone(stages[i]), id: copyId, label: copyLabel };
  delete copy.produces;
  delete copy.next;
  const next = [...stages];
  next.splice(i + 1, 0, copy);
  return { stages: renumber(next), id: copyId };
}

/** The stage taken out. What pointed at it by name is left pointing (the check says so on that row): the person decides where it goes now. */
export const removeStage = (stages: StageDef[], id: string): StageDef[] => renumber(stages.filter((s) => s.id !== id));

/** A change to the fields of one stage; a key set to undefined is removed from the stage. */
export function patchStage(stages: StageDef[], id: string, patch: Partial<Record<keyof StageDef, unknown>>): StageDef[] {
  return stages.map((s) => {
    if (s.id !== id) return s;
    const next: Record<string, unknown> = { ...s, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    return next as unknown as StageDef;
  });
}

/** The id of a stage changed, with every `next` and `returnsTo` that named it. */
export function renameStage(stages: StageDef[], from: string, to: string): StageDef[] {
  return stages.map((s) => ({ ...s, id: s.id === from ? to : s.id, ...(s.next === from ? { next: to } : {}), ...(s.returnsTo === from ? { returnsTo: to } : {}) }));
}

/** `renames` with the change of `from` to `to` added; what was renamed to `from` before now goes to `to`, and a stage renamed back needs no entry. */
export function chainRename(renames: Record<string, string>, from: string, to: string): Record<string, string> {
  const next: Record<string, string> = {};
  let chained = false;
  for (const [a, b] of Object.entries(renames)) {
    next[a] = b === from ? to : b;
    if (b === from) chained = true;
  }
  if (!chained) next[from] = to;
  for (const [a, b] of Object.entries(next)) if (a === b) delete next[a];
  return next;
}

// ---- the checks -------------------------------------------------------------------------------------------------------------------------

export type StageField = 'id' | 'produces' | 'reads' | 'roundLimit' | 'waitsFor' | 'comment' | 'trackerStatus';

export interface FieldProblem {
  field: StageField;
  /** A catalog key of this screen. */
  key: string;
  params?: Record<string, string>;
}

/** What is wrong with one stage's fields on their own: the shapes the file format wants. The flow checks (who works it, where it goes) come from `flowIssues`. */
export function stageFieldProblems(stages: StageDef[], s: StageDef): FieldProblem[] {
  const out: FieldProblem[] = [];
  if (!ID_RE.test(s.id)) out.push({ field: 'id', key: 'ui.flow.err.idShape' });
  else if (stages.filter((x) => x.id === s.id).length > 1) out.push({ field: 'id', key: 'ui.flow.err.idTaken', params: { id: s.id } });
  for (const field of ['produces', 'reads'] as const) {
    const list = s[field] ?? [];
    for (const file of list) if (!ARTIFACT_RE.test(file) || file.length > 100) out.push({ field, key: 'ui.flow.err.file', params: { file } });
    if (list.length > 20) out.push({ field, key: 'ui.flow.err.fileCount' });
    if (new Set(list).size !== list.length) out.push({ field, key: 'ui.flow.err.fileTwice' });
  }
  if (s.roundLimit !== undefined && !(Number.isInteger(s.roundLimit) && s.roundLimit >= 1 && s.roundLimit <= 20)) out.push({ field: 'roundLimit', key: 'ui.flow.err.roundLimit' });
  if ((s.waitsFor?.kind === 'time' || s.waitsFor?.kind === 'beta-age') && s.waitsFor.minutes !== undefined && !(Number.isInteger(s.waitsFor.minutes) && s.waitsFor.minutes >= 1 && s.waitsFor.minutes <= 525_600)) out.push({ field: 'waitsFor', key: 'ui.flow.err.minutes' });
  if (s.comment && !COMMENT_KEY_RE.test(s.comment)) out.push({ field: 'comment', key: 'ui.flow.err.commentKey' });
  if ((s.trackerStatus ?? '').length > 200) out.push({ field: 'trackerStatus', key: 'ui.flow.err.trackerStatus' });
  return out;
}

/** A check that is not about a row of the flow on screen: the team, the squads, another flow. Rendered with `flowIssueText` or `squadIssueText`. */
export type GeneralIssue = { type: 'flow'; issue: FlowIssue } | { type: 'squad'; issue: SquadIssue };

export interface FlowChecks {
  /** What the checks say about the stages of the flow being edited: the editor marks the row of `issue.stage`. */
  rows: FlowIssue[];
  /** Everything else the checks found, over the whole draft: they stop a save as well. */
  general: GeneralIssue[];
  /** How many errors stop a save, anywhere in the draft. */
  errors: number;
}

/** The config the draft makes: the flows, the agents made on the way, and what refers to a stage by id kept in step with the stages. */
export function applyFlows(config: WorkspaceConfig, d: FlowDraft): WorkspaceConfig {
  const next = structuredClone(config);
  const flows = Object.fromEntries(Object.entries(d.flows).filter(([squad]) => (next.squads ?? []).some((q) => q.id === squad)).map(([squad, stages]) => [squad, renumber(structuredClone(stages))]));
  // The flow of a release run and the one of a documentation run are no squad's and this editor does not show them: they stay as the config has them, and so do the stages their agents list.
  for (const key of RUN_KIND_FLOW_KEYS) {
    const own = config.devCycle.flows?.[key];
    if (own) flows[key] = structuredClone(own);
  }
  next.devCycle.stages = renumber(structuredClone(d.workspace));
  if (Object.keys(flows).length) next.devCycle.flows = flows;
  else delete next.devCycle.flows;
  // The autonomy block of each flow this editor shows; the blocks of flows it does not show (a release, the documentation) stay as the config has them.
  const autonomy = Object.fromEntries(Object.entries(d.autonomy).filter(([key]) => key === '' || (next.squads ?? []).some((q) => q.id === key)).map(([key, block]) => [key, { ...structuredClone(newFlowAutonomy(block)) }]));
  if (Object.keys(autonomy).length) next.devCycle.autonomy = autonomy;
  else delete next.devCycle.autonomy;
  for (const a of d.newAgents) if (!next.agents.team.some((x) => x.id === a.id)) next.agents.team.push(newAgent({ ...structuredClone(a), system: false }));
  const ids = new Set([...next.devCycle.stages, ...Object.values(flows).flat()].map((s) => s.id));
  // What listed a stage by its old id lists it by the new one, and every stage lists itself with the agent that works it.
  next.agents.team = next.agents.team.map((a) => ({ ...a, stages: [...new Set(a.stages.map((s) => d.renames[s] ?? s))] }));
  for (const s of [...next.devCycle.stages, ...Object.values(flows).flat()]) {
    if (!isWork(s) || !s.agentId) continue;
    const who = next.agents.team.find((a) => a.id === s.agentId);
    if (who && !who.stages.includes(s.id)) who.stages = [...who.stages, s.id];
  }
  next.agents.team = pruneAgentStages(next.agents.team, next.devCycle);
  next.devCycle.stageMapping = next.devCycle.stageMapping.map((r) => ({ ...r, stage: d.renames[r.stage] ?? r.stage })).filter((r) => next.devCycle.stages.some((s) => s.id === r.stage));
  // A comment template follows its stage when the stage is renamed; the ones a starter brought fill the stages that had none.
  const comments = { ...next.devCycle.comments };
  for (const [from, to] of Object.entries(d.renames)) {
    if (comments[from] && !comments[to] && ids.has(to) && !ids.has(from)) {
      comments[to] = comments[from];
      delete comments[from];
    }
  }
  for (const [key, tpl] of Object.entries(d.comments)) if (!comments[key]) comments[key] = structuredClone(tpl);
  next.devCycle.comments = comments;
  return next;
}

/**
 * The checks of the draft: the flow of `target` row by row, and over the rest of the draft (the team, the squads, the other flows) what would stop the save too,
 * since the main process refuses a flow, or a squad, with an error.
 */
export function checkFlows(config: WorkspaceConfig, d: FlowDraft, target: Target): FlowChecks {
  const next = applyFlows(config, d);
  const flows = next.devCycle.flows ?? {};
  const workspace = checkFlow({ stages: next.devCycle.stages, team: next.agents.team, extraStages: Object.values(flows).flat() }, { asFlow: true });
  const squads = checkSquads({ squads: next.squads ?? [], team: next.agents.team, stages: next.devCycle.stages, flows }, { checkSharedFlow: true });
  const own = !!target && !!flows[target];
  const rows: FlowIssue[] = [];
  const general: GeneralIssue[] = [];
  for (const i of workspace) {
    if (!target && i.agent === null) rows.push(i);
    else general.push({ type: 'flow', issue: i });
  }
  const seen = new Set(workspace.map((i) => `${i.code}|${i.stage ?? ''}`));
  for (const i of squads) {
    // A squad that follows the workspace's flow meets the same problem in it: what the flow's own list already says is not said twice.
    if (i.flow && !i.ownFlow && seen.has(`${i.code}|${i.stage ?? ''}`)) continue;
    if (i.flow && own && i.squad === target && i.ownFlow) rows.push({ severity: i.severity, code: i.code as FlowIssue['code'], stage: i.stage, agent: i.agent, field: i.field as FlowIssue['field'], params: i.params });
    else general.push({ type: 'squad', issue: i });
  }
  const lists = [next.devCycle.stages, ...Object.values(flows)];
  const fields = lists.reduce((n, stages) => n + stages.reduce((m, st) => m + stageFieldProblems(stages, st).length, 0), 0);
  const errors = workspace.filter((i) => i.severity === 'error').length + squads.filter((i) => i.severity === 'error').length + fields;
  return { rows, general, errors };
}

/** The values of a stage that are plain defaults, for the panel to show as placeholders. */
export const DEFAULT_ROUND = DEFAULT_ROUND_LIMIT;
