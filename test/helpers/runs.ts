import { neutralConfig } from '../../src/shared/config';
import type { WorkspaceConfig } from '../../src/shared/config/types';
import { agentFlow, agentFlowEngineering, applyTemplate } from '../../src/shared/cycles';
import type { ForumDraft } from '../../src/shared/forum';
import { flowOf, startRun, type FlowStage, type Run, type StartInput, type Transition } from '../../src/shared/runs';

export const AT = '2026-10-03T10:00:00.000Z';
export const at = (minutes: number): string => new Date(Date.parse(AT) + minutes * 60_000).toISOString();

/** A workspace config with the engineering cycle applied (refine to ready: the agent cycle as it was before the business roles). The runner's tests are written for it. */
export const agentFlowConfig = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlowEngineering);

/** A workspace config with the agent cycle applied: triage to communicate, with the business team. */
export const businessFlowConfig = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlowEngineering);

export const agentFlowStages = (): FlowStage[] => flowOf(agentFlowConfig());

/** The flow of the agent cycle with the autonomy of some agents set by id (the default team is all autonomous). */
export function flowWithAutonomy(autonomy: Record<string, boolean>): FlowStage[] {
  const c = agentFlowConfig();
  for (const a of c.agents.team) if (a.id in autonomy) a.autonomous = autonomy[a.id];
  return flowOf(c);
}

export const startInput = (over: Partial<StartInput> = {}): StartInput => ({
  id: 'r-abc123-x1y2',
  issue: { ref: 'app#101', iid: 101, title: 'Add the thing', url: 'https://example.com/group/project/issues/101' },
  repo: 'app',
  branch: 'coxia/101-add-the-thing',
  worktree: '/tmp/coxia-test/wt',
  cycleFolder: 'docs/cycles/101-add-the-thing',
  cycleId: 'agent-flow',
  ...over,
});

/** Drives a run move by move, keeping every message a move asked the forum to record. */
export function drive(flow: FlowStage[] = agentFlowStages(), input: StartInput = startInput()) {
  let minute = 0;
  const messages: ForumDraft[] = [];
  const first = startRun(input, flow, at(minute));
  let run: Run = first.run;
  messages.push(...first.messages);
  return {
    flow,
    messages,
    get run(): Run {
      return run;
    },
    /** Applies a move: `(run, at) => Transition`. */
    do(move: (run: Run, at: string) => Transition): Transition {
      minute += 1;
      const tr = move(run, at(minute));
      run = tr.run;
      messages.push(...tr.messages);
      return tr;
    },
  };
}
