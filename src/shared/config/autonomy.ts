import { RELEASE_FLOW_KEY } from './squads';
import type { AutonomyBlock, AutonomyChoice, WorkspaceConfig } from './types';

// Which autonomy block decides a run, and what each of its five choices means. Pure: it takes a config and returns the effective values, the origin and the flow,
// so the decision is read the same way at every step (a stage start, a command, a gate, a push, a pull request) and is testable without the app.

/** One block with the defaults of a flow that has none: everything off and the workspace's block deciding. */
const NEUTRAL_FLOW = { cycle: false, hostCommands: false, gates: false, push: false, pullRequest: false, useWorkspace: true } as const;

/** The key of `devCycle.autonomy` that holds a flow's block: `''` for the main flow, the squad id for a squad's, `release` for the release flow. */
export const flowKeyOf = (squadId: string | null | undefined): string => squadId ?? '';

/** The key of the release flow: a run whose subject is a version, not an issue. */
export const RELEASE_AUTONOMY_KEY = RELEASE_FLOW_KEY;

export interface EffectiveAutonomy extends AutonomyBlock {
  /** Where the decision came from: the workspace's block or the flow's own. */
  from: 'workspace' | 'flow';
  /** The flow that decided (the key of the map); null when the workspace's block did. */
  flow: string | null;
}

/**
 * The autonomy block that decides a run of `flowKey`: the flow's own when its "Use the workspace's setting" is off, the workspace's otherwise (and when the flow
 * has no block of its own). A flow with no entry reads as one that follows the workspace.
 */
export function autonomyOf(c: Pick<WorkspaceConfig, 'runner' | 'devCycle'>, flowKey: string): EffectiveAutonomy {
  const block = c.devCycle.autonomy?.[flowKey];
  if (!block || block.useWorkspace) {
    return { ...c.runner.autonomy, from: 'workspace', flow: null };
  }
  return { cycle: block.cycle, hostCommands: block.hostCommands, gates: block.gates, push: block.push, pullRequest: block.pullRequest, from: 'flow', flow: flowKey };
}

/** Whether one of the four choices is on: it never is on its own, only under `cycle`. */
export const choiceOn = (a: Pick<EffectiveAutonomy, 'cycle'> & AutonomyBlock, choice: AutonomyChoice): boolean => a.cycle && a[choice];

/** The four choices that are on, for the header of the run's screen. */
export const onChoices = (a: EffectiveAutonomy): AutonomyChoice[] =>
  (['hostCommands', 'gates', 'push', 'pullRequest'] as const).filter((c) => choiceOn(a, c));

/** A flow's block with every field filled: the `partial` over the neutral one (a saved map may hold only what the screen wrote). */
export function newFlowAutonomy(partial: Partial<AutonomyBlock> & { useWorkspace?: boolean } = {}): typeof NEUTRAL_FLOW & AutonomyBlock {
  return { useWorkspace: partial.useWorkspace ?? true, cycle: partial.cycle ?? false, hostCommands: partial.hostCommands ?? false, gates: partial.gates ?? false, push: partial.push ?? false, pullRequest: partial.pullRequest ?? false } as typeof NEUTRAL_FLOW & AutonomyBlock;
}
