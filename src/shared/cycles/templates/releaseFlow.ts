// i18n-lint: allow-file cycle template data: stage names and file names, whose texts are catalog keys
import { newAgent } from '../../config/team';
import type { AgentDef, CommentTemplate, StageDef } from '../../config/types';
import { sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { agentFlowComments } from './agentFlowComments';

// The release as a flow of its own: the stages a run whose subject is a version goes through (spec 4.1 of issue 27), with a Release manager agent that asks for each
// step of the release through the release actions. The run's stage ids start with `release-` so none is the id of a stage of the issue flow (an agent lists the
// stage ids it works, and the two flows live in one workspace). Applying the template puts these stages in `devCycle.flows.release` and leaves the workspace's own
// flow, for issues, as it is.

export const RELEASE_MANAGER = 'release-manager';

export const RELEASE_FLOW_STAGES: StageDef[] = [
  { id: 'release-plan', label: 'cycle.releaseFlow.stage.plan', match: ['^Plan'], kind: 'backlog', rank: 1, type: 'work', agentId: RELEASE_MANAGER, produces: ['RELEASE_PLAN.md'] },
  { id: 'release-plan-gate', label: 'cycle.releaseFlow.stage.planGate', match: ['^Approve the plan$'], kind: 'backlog', rank: 2, type: 'gate' },
  { id: 'release-assemble', label: 'cycle.releaseFlow.stage.assemble', match: ['^Assemble'], kind: 'development', rank: 3, type: 'work', agentId: RELEASE_MANAGER },
  // The merges the agent asked for may wait in Actions for a "sim": the beta is cut once every activity of the version is in the branch.
  { id: 'release-merged', label: 'cycle.releaseFlow.stage.merged', match: ['^Merges'], kind: 'development', rank: 4, type: 'wait', waitsFor: { kind: 'release-approved' } },
  { id: 'release-beta', label: 'cycle.releaseFlow.stage.beta', match: ['^Cut the beta$'], kind: 'development', rank: 5, type: 'work', agentId: RELEASE_MANAGER },
  // The beta is out when the person published its draft; the run waits for it to be out for a day with nothing labelled `beta-blocker` open.
  { id: 'release-feedback', label: 'cycle.releaseFlow.stage.feedback', match: ['^Beta feedback$'], kind: 'reviewApproved', rank: 6, type: 'wait', waitsFor: { kind: 'beta-age', minutes: 1440, label: 'beta-blocker' } },
  { id: 'release-stable-gate', label: 'cycle.releaseFlow.stage.stableGate', match: ['^Approve the stable$'], kind: 'reviewApproved', rank: 7, type: 'gate' },
  { id: 'release-stable', label: 'cycle.releaseFlow.stage.stable', match: ['^Cut the stable$'], kind: 'development', rank: 8, type: 'work', agentId: RELEASE_MANAGER },
  // Where the run ends: nobody works it. The tracking issue is closed by the app when the host shows the stable version published.
  { id: 'release-published', label: 'cycle.releaseFlow.stage.published', match: ['^Published$'], kind: 'done', rank: 9, type: 'work' },
];

/** The agent of the release flow: it reads the code host and asks for release steps; it runs no command and changes no file. Autonomous: a push waits for the person anyway. */
export function releaseManager(): AgentDef {
  return newAgent({
    id: RELEASE_MANAGER,
    name: 'cycle.releaseFlow.team.releaseManager.name',
    job: 'cycle.releaseFlow.team.releaseManager.job',
    instructions: 'cycle.releaseFlow.team.releaseManager.instructions',
    stages: RELEASE_FLOW_STAGES.filter((s) => s.agentId === RELEASE_MANAGER).map((s) => s.id),
    permission: 'read',
    tracker: 'read',
    shell: 'none',
    autonomous: true,
    turnsTo: null,
    model: { role: 'deep' },
  });
}

const key = (id: string, part: string): string => `cycle.releaseFlow.comment.${id}.${part}`;

function template(id: string, sections: number, technicalDetail: boolean): CommentTemplate {
  return {
    title: key(id, 'title'),
    status: key(id, 'status'),
    sections: Array.from({ length: sections }, (_, i) => ({ heading: key(id, `s${i + 1}.heading`), guidance: key(id, `s${i + 1}.guidance`) })),
    technicalDetail,
  };
}

/**
 * The comments of the release on its tracking issue: one per work stage (the agent writes it), and the three the app writes itself (the activities of the version, a
 * beta published, the stable published). The gate and the question are the agent cycle's own.
 */
export const RELEASE_COMMENT_SHAPE: Record<string, { sections: number; technicalDetail: boolean }> = {
  'release-plan': { sections: 4, technicalDetail: true },
  'release-assemble': { sections: 2, technicalDetail: true },
  'release-beta': { sections: 2, technicalDetail: true },
  'release-stable': { sections: 2, technicalDetail: true },
  activities: { sections: 1, technicalDetail: false },
  'beta-published': { sections: 1, technicalDetail: false },
  'stable-published': { sections: 1, technicalDetail: false },
};

export function releaseComments(): Record<string, CommentTemplate> {
  const base = agentFlowComments(false);
  return {
    ...Object.fromEntries(Object.entries(RELEASE_COMMENT_SHAPE).map(([id, s]) => [id, template(id, s.sections, s.technicalDetail)])),
    gate: base.gate,
    question: base.question,
  };
}

/** The release flow: the stages of a release run and the agent that works them. Applying it adds the flow next to the workspace's own (`runKind: 'release'`). */
export const releaseFlow: CycleTemplate = {
  id: 'release-flow',
  name: 'cycle.releaseFlow.name',
  description: 'cycle.releaseFlow.description',
  needs: ['issueProject'],
  runKind: 'release',
  team: [releaseManager()],
  devCycle: {
    templateId: 'release-flow',
    stages: RELEASE_FLOW_STAGES,
    comments: releaseComments(),
    prompts: sameFamily('sdd'),
  },
};
