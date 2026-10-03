import { DEFAULT_ROUND_LIMIT, type DevCycleConfig, type StageDef, type WorkspaceConfig } from '../config/types';
import { squadView, type CycleView } from '../config/squads';
import { stageAgent } from '../config/team';
import type { FlowSnapshot, FlowStage, Run } from './types';

/** The name of the file the issue is copied into at the start of a run: the input of the first stage, readable by every one after it. */
export const ISSUE_RECORD = '0_ISSUE.md';

type FlowConfig = { agents: Pick<WorkspaceConfig['agents'], 'team'>; devCycle: Pick<DevCycleConfig, 'stages'> };

/** A cycle whose stages carry any of the flow fields (a type, an agent, what it produces, where it goes on or back, what it waits for) is a flow a run follows; any other is a cycle of the ceremonies only. */
export const isFlowCycle = (stages: Pick<StageDef, 'type' | 'agentId' | 'produces' | 'reads' | 'next' | 'returnsTo' | 'waitsFor' | 'roundLimit' | 'trackerStatus'>[]): boolean =>
  stages.some((s) => !!s.type || !!s.agentId || !!s.produces?.length || !!s.reads || s.next !== undefined || !!s.returnsTo || !!s.waitsFor || s.roundLimit !== undefined || !!s.trackerStatus);

/** Every stage but a gate or a wait is work: a stage of a flow with no type is work. */
export const isWork = (s: { type?: StageDef['type'] }): boolean => (s.type ?? 'work') === 'work';

/** The id of the work stage nearest before position `i` of the list: where work goes back to when nothing says otherwise. */
const nearestWork = (stages: StageDef[], i: number): string | null => {
  for (let j = i - 1; j >= 0; j--) if (isWork(stages[j])) return stages[j].id;
  return null;
};

/**
 * The stages of the cycle in the order a run goes through them (as listed), each with its agent and every default of the flow filled in.
 * `next` is null where the run ends: after the last stage, or after a stage that says so. `stages` is the list to read when it is not the cycle's own: the
 * seam for a squad that has a flow of its own (the agents still come from the one team).
 */
export function flowOf(config: FlowConfig, stages: StageDef[] = config.devCycle.stages): FlowStage[] {
  return stages.map((s, i) => {
    const type = s.type ?? 'work';
    const who = type === 'work' ? stageAgent(config.agents.team, stages, s.id) : null;
    const comment = s.comment === undefined ? s.id : s.comment || null;
    return {
      id: s.id,
      label: s.label || s.id,
      kind: s.kind,
      type,
      agent: who?.id ?? null,
      autonomous: who?.autonomous ?? false,
      artifacts: [...(s.produces ?? [])],
      reads: s.reads ? [...s.reads] : null,
      next: s.next === undefined ? (stages[i + 1]?.id ?? null) : s.next,
      returnsTo: s.returnsTo ?? nearestWork(stages, i),
      roundLimit: s.roundLimit ?? DEFAULT_ROUND_LIMIT,
      waitsFor: s.waitsFor ? { ...s.waitsFor } : null,
      comment,
      trackerStatus: s.trackerStatus?.trim() || null,
    };
  });
}

// A short, stable hash of a flow (FNV-1a over its structure): it says which version a run follows. What the agents are doing (autonomy) is not part of the
// flow, so switching an agent on or off never makes a new version.
export function flowHash(stages: FlowStage[]): string {
  const text = JSON.stringify(stages.map(({ autonomous: _live, ...rest }) => rest));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The copy of a flow a run keeps. */
export const snapshotOf = (stages: FlowStage[]): FlowSnapshot => ({ hash: flowHash(stages), stages: structuredClone(stages) });

/**
 * The flow a run follows: the copy it started with, the agents as they are now (autonomy is read when a stage starts or publishes, so a switch applies from
 * the next one; an agent that left the team is replaced by the one the cycle names for the stage today). A run with no copy follows the current flow.
 */
export function flowOfRun(run: Pick<Run, 'flow' | 'squad'>, config: CycleView): FlowStage[] {
  // A run in a squad reads its agents from the squad's members and the shared ones, and the stages of the squad's flow.
  const view = squadView(config, run.squad);
  if (!run.flow) return flowOf(view, view.devCycle.stages);
  const team = view.agents.team;
  return run.flow.stages.map((s) => {
    if (s.type !== 'work' || !s.agent) return s;
    const agent = team.find((a) => a.id === s.agent) ?? stageAgent(team, view.devCycle.stages, s.id);
    return { ...s, agent: agent?.id ?? null, autonomous: agent?.autonomous ?? false };
  });
}

export interface FlowProblem {
  code: 'empty' | 'no-agent';
  stage: string | null;
}

/** What keeps a run from starting: no stages, or a work stage that is not where the run ends and has no agent. */
export function flowProblems(flow: FlowStage[]): FlowProblem[] {
  if (!flow.length) return [{ code: 'empty', stage: null }];
  return flow.filter((s) => s.type === 'work' && s.next !== null && !s.agent).map((s) => ({ code: 'no-agent' as const, stage: s.id }));
}

/** The work stage whose artifact a gate (or a later stage) judges: the nearest earlier stage that is work. */
export function producerOf(flow: FlowStage[], stageId: string): FlowStage | null {
  const i = flow.findIndex((s) => s.id === stageId);
  for (let j = i - 1; j >= 0; j--) if (flow[j].type === 'work') return flow[j];
  return null;
}

/** The stage that ends with the push: the last one whose agent changes the worktree. Its work is what the pull request carries. */
export function pushStageOf(config: Pick<WorkspaceConfig, 'agents'>, flow: FlowStage[]): FlowStage | null {
  const writes = new Set(config.agents.team.filter((a) => a.permission === 'worktree').map((a) => a.id));
  const found = flow.filter((s) => s.type === 'work' && s.agent && writes.has(s.agent));
  return found.length ? found[found.length - 1] : null;
}
