import type { AuditPolicy, AuditPolicyLevel } from '../auditoria';
import { RELEASE_FLOW_KEY } from './squads';
import type { AutonomyBlock, AutonomyChoice, WorkspaceAutonomy, WorkspaceConfig } from './types';

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
    // The five fields of a run only: the board's choice is not a step of a run and never travels with it.
    const w = c.runner.autonomy;
    return { cycle: w.cycle, hostCommands: w.hostCommands, gates: w.gates, push: w.push, pullRequest: w.pullRequest, from: 'workspace', flow: null };
  }
  return { cycle: block.cycle, hostCommands: block.hostCommands, gates: block.gates, push: block.push, pullRequest: block.pullRequest, from: 'flow', flow: flowKey };
}

/** Whether one of the four choices is on: it never is on its own, only under `cycle`. */
export const choiceOn = (a: Pick<EffectiveAutonomy, 'cycle'> & AutonomyBlock, choice: AutonomyChoice): boolean => a.cycle && a[choice];

/**
 * Whether a write of the board goes to the code host executed and audited, with no "yes" in Actions. It is the workspace's own choice and does not look at `cycle`:
 * the board is not a run, and a person who never starts one still decides how it writes. Only the workspace's block has it; a flow's does not.
 */
export const boardAutonomous = (c: Pick<WorkspaceConfig, 'runner'>): boolean => c.runner.autonomy.board === true;

/** The name the audit log gives a policy's level. The only place that names it: the levels of a finer policy change here and nowhere else. */
export const levelOf = (from: EffectiveAutonomy['from']): AuditPolicyLevel => from;

/** The policy in effect for a run of `flowKey`, as the audit log keeps it; `board` adds the workspace's board choice, for a write of the board. */
export function auditPolicyOf(c: Pick<WorkspaceConfig, 'runner' | 'devCycle'>, flowKey: string, opts: { board?: boolean } = {}): AuditPolicy {
  const a = autonomyOf(c, flowKey);
  const policy: AuditPolicy = { cycle: a.cycle, hostCommands: a.hostCommands, gates: a.gates, push: a.push, pullRequest: a.pullRequest, level: levelOf(a.from), flow: flowKey };
  return opts.board ? { ...policy, board: boardAutonomous(c) } : policy;
}

/** One choice of an autonomy block that a save changed: the level and the flow it belongs to, and the value before and after. */
export interface PolicyChange {
  level: AuditPolicyLevel;
  /** `''` for the workspace's block and the main flow's; the flow's key otherwise. */
  flow: string;
  choice: string;
  before: boolean;
  after: boolean;
}

const WORKSPACE_FIELDS = ['cycle', 'hostCommands', 'gates', 'push', 'pullRequest', 'board'] as const;
const FLOW_FIELDS = ['useWorkspace', 'cycle', 'hostCommands', 'gates', 'push', 'pullRequest'] as const;

/** Every choice of the workspace's block and of each flow's block that differs between two configs. A flow with no block reads as the neutral one (it follows the workspace). */
export function policyChanges(before: Pick<WorkspaceConfig, 'runner' | 'devCycle'>, after: Pick<WorkspaceConfig, 'runner' | 'devCycle'>): PolicyChange[] {
  const out: PolicyChange[] = [];
  // Read as partial: a config from before a choice existed has no value for it, which reads as off.
  const wb: Partial<WorkspaceAutonomy> = before.runner.autonomy ?? {};
  const wa: Partial<WorkspaceAutonomy> = after.runner.autonomy ?? {};
  for (const f of WORKSPACE_FIELDS) if ((wb[f] === true) !== (wa[f] === true)) out.push({ level: levelOf('workspace'), flow: '', choice: f, before: wb[f] === true, after: wa[f] === true });
  const fb = before.devCycle.autonomy ?? {};
  const fa = after.devCycle.autonomy ?? {};
  for (const key of [...new Set([...Object.keys(fb), ...Object.keys(fa)])].sort()) {
    const b = newFlowAutonomy(fb[key]);
    const a = newFlowAutonomy(fa[key]);
    for (const f of FLOW_FIELDS) if (b[f] !== a[f]) out.push({ level: levelOf('flow'), flow: key, choice: f, before: b[f], after: a[f] });
  }
  return out;
}

/** The four choices that are on, for the header of the run's screen. */
export const onChoices = (a: EffectiveAutonomy): AutonomyChoice[] =>
  (['hostCommands', 'gates', 'push', 'pullRequest'] as const).filter((c) => choiceOn(a, c));

/** A flow's block with every field filled: the `partial` over the neutral one (a saved map may hold only what the screen wrote). */
export function newFlowAutonomy(partial: Partial<AutonomyBlock> & { useWorkspace?: boolean } = {}): typeof NEUTRAL_FLOW & AutonomyBlock {
  return { useWorkspace: partial.useWorkspace ?? true, cycle: partial.cycle ?? false, hostCommands: partial.hostCommands ?? false, gates: partial.gates ?? false, push: partial.push ?? false, pullRequest: partial.pullRequest ?? false } as typeof NEUTRAL_FLOW & AutonomyBlock;
}
