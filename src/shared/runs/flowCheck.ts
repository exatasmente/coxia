import { stageAgent, workingTeam } from '../config/team';
import type { AgentDef, StageDef } from '../config/types';
import { t as translate, type Translate } from '../i18n';
import { ISSUE_RECORD, isFlowCycle, isWork } from './flow';

// The one check of a flow: pure, over the stages and the team, with stable codes and the params of each message. It is what the config validator runs,
// what the runner runs before it starts a run, and what the editor shows on the row of the stage while the person edits. Nothing here renders a message
// itself: `flowIssueText` does, through the catalog (`flow.check.<code>`), in whatever language the caller translates to.

export const FLOW_ERRORS = ['no-stages', 'gate-first', 'work-no-agent', 'agent-unknown', 'agent-on-non-work', 'next-nowhere', 'returns-nowhere', 'returns-to-non-work', 'no-return-target', 'unreachable', 'no-end', 'artifact-unproduced', 'artifact-duplicate', 'wait-no-event', 'turns-unknown', 'turns-self', 'turns-loop'] as const;
export const FLOW_WARNINGS = ['agent-idle', 'gate-last', 'end-no-agent'] as const;
export type FlowIssueCode = (typeof FLOW_ERRORS)[number] | (typeof FLOW_WARNINGS)[number];

/** Which field of the stage (or of the agent) the issue is about, so the editor can mark the right control. */
export type FlowIssueField = 'type' | 'agentId' | 'next' | 'returnsTo' | 'reads' | 'produces' | 'waitsFor' | 'turnsTo' | 'autonomous' | 'stages';

export interface FlowIssue {
  severity: 'error' | 'warning';
  code: FlowIssueCode;
  /** The stage it is about (its id); null for the flow as a whole and for an issue about an agent. */
  stage: string | null;
  /** The agent it is about (its id), for the issues about the team. */
  agent: string | null;
  field: FlowIssueField;
  /** What the message of the code needs: `stage` (its name), `target`, `file`, `other`, `agent`, `agents`. */
  params: Record<string, string>;
}

export interface FlowInput {
  stages: StageDef[];
  team: AgentDef[];
  /** The stages of the flows squads have of their own: they are not checked here, but an agent that works one of them is not idle. */
  extraStages?: StageDef[];
}

export interface FlowCheckOptions {
  /** Check the stages as a flow whether or not any has a `type` (the editor, and the runner before it starts: an empty list is then a problem). */
  asFlow?: boolean;
}

const nameOf = (s: StageDef): string => s.label || s.id;
const WRITES_BEFORE_RETURN = new Set(['review', 'qa']);

function stageIssues(stages: StageDef[], team: AgentDef[], out: FlowIssue[]): void {
  const issue = (severity: FlowIssue['severity'], code: FlowIssueCode, stage: StageDef | null, field: FlowIssueField, params: Record<string, string> = {}): void => {
    out.push({ severity, code, stage: stage?.id ?? null, agent: null, field, params: { ...(stage ? { stage: nameOf(stage) } : {}), ...params } });
  };
  if (!stages.length) return void issue('error', 'no-stages', null, 'stages');

  const ids = new Set(stages.map((s) => s.id));
  const labelOf = (id: string): string => {
    const s = stages.find((x) => x.id === id);
    return s ? nameOf(s) : id;
  };
  // A gate, a review and a QA pass are the stages that send the work back.
  const returns = (s: StageDef): boolean => s.type === 'gate' || (isWork(s) && WRITES_BEFORE_RETURN.has(s.kind));
  const nextOf = (s: StageDef, i: number): string | null => (s.next === undefined ? (stages[i + 1]?.id ?? null) : s.next);
  const defaultBack = (i: number): string | null => {
    for (let j = i - 1; j >= 0; j--) if (isWork(stages[j])) return stages[j].id;
    return null;
  };

  if (stages[0].type === 'gate') issue('error', 'gate-first', stages[0], 'type');

  const produced = new Map<string, StageDef>();
  stages.forEach((s, i) => {
    const type = s.type ?? 'work';
    const work = type === 'work';
    const next = nextOf(s, i);
    const agent = work ? stageAgent(team, stages, s.id) : null;

    if (s.agentId && !work) issue('error', 'agent-on-non-work', s, 'agentId');
    else if (s.agentId && !team.some((a) => a.id === s.agentId)) issue('error', 'agent-unknown', s, 'agentId', { agent: s.agentId });
    else if (work && !agent) {
      // The stage where the run ends may have no agent: the run then ends when it gets there.
      if (next === null) {
        // An end marker with nothing to produce is a plain end; one that was meant to produce something (a release note) is a stage that lost its agent.
        if (s.produces?.length) issue('warning', 'end-no-agent', s, 'agentId');
      } else issue('error', 'work-no-agent', s, 'agentId');
    }

    if (s.next !== undefined && s.next !== null && !ids.has(s.next)) issue('error', 'next-nowhere', s, 'next', { target: s.next });
    if (s.returnsTo !== undefined) {
      if (!ids.has(s.returnsTo)) issue('error', 'returns-nowhere', s, 'returnsTo', { target: s.returnsTo });
      else if (!isWork(stages.find((x) => x.id === s.returnsTo) as StageDef)) issue('error', 'returns-to-non-work', s, 'returnsTo', { target: labelOf(s.returnsTo) });
    } else if (returns(s) && !defaultBack(i) && i > 0) {
      issue('error', 'no-return-target', s, 'returnsTo');
    }

    if (type === 'wait') {
      const w = s.waitsFor;
      if (!w || (w.kind === 'label' && !w.label?.trim()) || ((w.kind === 'time' || w.kind === 'beta-age') && !(w.minutes && w.minutes > 0))) issue('error', 'wait-no-event', s, 'waitsFor');
    }

    for (const file of s.reads ?? []) {
      if (file !== ISSUE_RECORD && !stages.slice(0, i).some((x) => x.produces?.includes(file))) issue('error', 'artifact-unproduced', s, 'reads', { file });
    }
    for (const file of s.produces ?? []) {
      const other = produced.get(file);
      if (other) issue('error', 'artifact-duplicate', s, 'produces', { file, other: nameOf(other) });
      else produced.set(file, s);
    }
  });

  // What the run can reach from its first stage, going on or going back.
  const reach = new Set<string>();
  const queue = [stages[0].id];
  while (queue.length) {
    const id = queue.pop() as string;
    if (reach.has(id)) continue;
    reach.add(id);
    const i = stages.findIndex((s) => s.id === id);
    const s = stages[i];
    const edges = [nextOf(s, i), s.returnsTo ?? (returns(s) ? defaultBack(i) : null)];
    for (const e of edges) if (e && ids.has(e) && !reach.has(e)) queue.push(e);
  }
  stages.forEach((s) => {
    if (!reach.has(s.id)) issue('error', 'unreachable', s, 'next');
  });
  if (!stages.some((s, i) => nextOf(s, i) === null && reach.has(s.id))) issue('error', 'no-end', null, 'next');

  // A gate after the last work stage judges nothing.
  const lastWork = stages.map((s, i) => (isWork(s) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  for (let i = stages.length - 1; i > lastWork; i--) {
    if (stages[i].type === 'gate') {
      issue('warning', 'gate-last', stages[i], 'type');
      break;
    }
  }
}

function teamIssues(stages: StageDef[], team: AgentDef[], extra: StageDef[], out: FlowIssue[]): void {
  const ids = new Set(team.map((a) => a.id));
  const agentIssue = (severity: FlowIssue['severity'], code: FlowIssueCode, a: AgentDef, field: FlowIssueField, params: Record<string, string> = {}): void => {
    out.push({ severity, code, stage: null, agent: a.id, field, params: { agent: a.id, ...params } });
  };
  for (const a of team) {
    if (a.turnsTo === a.id) agentIssue('error', 'turns-self', a, 'turnsTo');
    else if (a.turnsTo && !ids.has(a.turnsTo)) agentIssue('error', 'turns-unknown', a, 'turnsTo', { target: a.turnsTo });
  }
  // A chain of questions that comes back to where it began never reaches the person: each circle is reported once, on the first agent of the team in it.
  const seen = new Set<string>();
  for (const a of team) {
    const path: string[] = [];
    let cur: AgentDef | undefined = a;
    while (cur && cur.turnsTo && cur.turnsTo !== cur.id && !path.includes(cur.id)) {
      path.push(cur.id);
      cur = team.find((x) => x.id === cur?.turnsTo);
    }
    if (cur && path.includes(cur.id) && cur.turnsTo && cur.turnsTo !== cur.id) {
      const circle = path.slice(path.indexOf(cur.id));
      const first = team.find((x) => circle.includes(x.id)) as AgentDef;
      if (!circle.some((id) => seen.has(id))) {
        circle.forEach((id) => seen.add(id));
        agentIssue('error', 'turns-loop', first, 'turnsTo', { agents: [...circle, circle[0]].join(' → ') });
      }
    }
  }
  const named = new Set([...stages, ...extra].flatMap((s) => (s.agentId ? [s.agentId] : [])));
  for (const a of team) if (a.autonomous && !a.stages.length && !named.has(a.id)) agentIssue('warning', 'agent-idle', a, 'autonomous');
}

/**
 * What is wrong with a flow and with the team that works it. Errors stop a run (and saving, in the editor); warnings say something is probably not meant.
 * A cycle where no stage has a `type` is one of the ceremonies' and has no flow to check (its team is still checked).
 */
export function checkFlow(input: FlowInput, options: FlowCheckOptions = {}): FlowIssue[] {
  const out: FlowIssue[] = [];
  // A draft is not part of the team the flow runs: a stage or an agent that points at one is pointing at no one.
  const team = workingTeam(input.team);
  if (options.asFlow || isFlowCycle(input.stages)) stageIssues(input.stages, team, out);
  teamIssues(input.stages, team, input.extraStages ?? [], out);
  return out;
}

/** Only the issues that stop a run. */
export const flowErrors = (input: FlowInput, options: FlowCheckOptions = {}): FlowIssue[] => checkFlow(input, options).filter((i) => i.severity === 'error');

/**
 * The message of an issue, in the language of the translator it is given (the active language by default). The stage names in its params are catalog keys
 * for a template's stages: the same translator puts them in words (a literal is not in the catalog and stays as it is).
 */
export function flowIssueText(issue: Pick<FlowIssue, 'code' | 'params'>, t: Translate = translate): string {
  const params = { ...issue.params };
  for (const name of ['stage', 'target', 'other']) if (params[name]) params[name] = t(params[name]);
  return t(`flow.check.${issue.code}`, params);
}
