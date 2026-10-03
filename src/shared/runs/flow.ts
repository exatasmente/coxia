import type { DevCycleConfig, WorkspaceConfig } from '../config/types';
import { stageAgent } from '../config/team';
import type { FlowStage } from './types';

/**
 * The stages of the cycle in the order a run goes through them (by rank, then as listed), each with its agent. The last one is where a run ends.
 * A gate has no agent, and neither has the last stage.
 */
export function flowOf(config: Pick<WorkspaceConfig, 'agents'> & { devCycle: Pick<DevCycleConfig, 'stages'> }): FlowStage[] {
  const stages = config.devCycle.stages.map((s, i) => ({ s, i })).sort((a, b) => a.s.rank - b.s.rank || a.i - b.i);
  return stages.map(({ s }, i) => {
    const human = !!s.human;
    const last = i === stages.length - 1;
    return { id: s.id, label: s.label || s.id, human, agent: human || last ? null : (stageAgent(config.agents.team, config.devCycle.stages, s.id)?.id ?? null), artifacts: [...(s.artifacts ?? [])] };
  });
}

export interface FlowProblem {
  code: 'empty' | 'no-agent';
  stage: string | null;
}

/** What keeps a run from starting: no stages, or a stage that is neither a gate nor the last and has no agent. */
export function flowProblems(flow: FlowStage[]): FlowProblem[] {
  if (!flow.length) return [{ code: 'empty', stage: null }];
  return flow.filter((s, i) => !s.human && i < flow.length - 1 && !s.agent).map((s) => ({ code: 'no-agent' as const, stage: s.id }));
}

/** The work stage whose artifact a gate (or a later stage) judges: the nearest earlier stage that is not a gate. */
export function producerOf(flow: FlowStage[], stageId: string): FlowStage | null {
  const i = flow.findIndex((s) => s.id === stageId);
  for (let j = i - 1; j >= 0; j--) if (!flow[j].human) return flow[j];
  return null;
}
