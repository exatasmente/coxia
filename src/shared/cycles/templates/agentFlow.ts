// i18n-lint: allow-file cycle template data: stage names and file names, whose texts are catalog keys
import { newAgent } from '../../config/team';
import { CARD_FIELDS, type AgentDef, type StageDef } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { agentFlowComments } from './agentFlowComments';

// The agent cycle: the stages are work done by a team of agents, with the person at the two gates. An issue goes refine, gate 1, plan, gate 2,
// implement, review, QA, ready; each work stage names its agent and the files it must produce in the cycle folder (no sub-folder: one flow
// for every kind of issue). The tracker's own stage is not mapped: a run carries its stage, shown beside the card.

export const AGENT_FLOW_STAGES: StageDef[] = [
  { id: 'refine', label: 'Refine', match: ['^Refin'], kind: 'backlog', rank: 1, type: 'work', agentId: 'refiner', produces: ['1_SPEC.md'] },
  { id: 'gate1', label: 'Gate 1', match: ['^Gate 1$'], kind: 'backlog', rank: 2, type: 'gate' },
  { id: 'plan', label: 'Plan', match: ['^Plan'], kind: 'development', rank: 3, type: 'work', agentId: 'planner', produces: ['2_PLAN.md'] },
  { id: 'gate2', label: 'Gate 2', match: ['^Gate 2$'], kind: 'development', rank: 4, type: 'gate' },
  { id: 'implement', label: 'Implement', match: ['^Implement'], kind: 'development', rank: 5, type: 'work', agentId: 'developer', produces: ['3_IMPLEMENTATION.md'] },
  { id: 'review', label: 'Review', match: ['^Review'], kind: 'review', rank: 6, type: 'work', agentId: 'reviewer', produces: ['4_REVIEW.md'], returnsTo: 'implement', roundLimit: 2 },
  { id: 'qa', label: 'QA', match: ['^QA$'], kind: 'qa', rank: 7, type: 'work', agentId: 'qa', produces: ['5_TEST_PLAN.md'], returnsTo: 'implement', roundLimit: 2 },
  // Where the run ends: no agent works it.
  { id: 'ready', label: 'Ready', match: ['^Ready$'], kind: 'reviewApproved', rank: 8, type: 'work' },
];

const member = (id: string, key: string, stages: string[], permission: AgentDef['permission'], role: 'deep' | 'turn'): AgentDef =>
  newAgent({ id, name: `cycle.agentFlow.team.${key}.name`, job: `cycle.agentFlow.team.${key}.job`, instructions: `cycle.agentFlow.team.${key}.instructions`, stages, permission, autonomous: true, model: { role } });

/** The default team of the agent cycle: all autonomous (the person is at the two gates), and only the developer may change files, inside its run's worktree. */
export function agentFlowTeam(): AgentDef[] {
  return [
    member('refiner', 'refiner', ['refine'], 'read', 'deep'),
    member('planner', 'planner', ['plan'], 'read', 'deep'),
    member('developer', 'developer', ['implement'], 'worktree', 'deep'),
    member('reviewer', 'reviewer', ['review'], 'read', 'deep'),
    member('qa', 'qa', ['qa'], 'read', 'deep'),
  ];
}

export const agentFlow: CycleTemplate = {
  id: 'agent-flow',
  name: 'cycle.agentFlow.name',
  description: 'cycle.agentFlow.description',
  needs: ['issueProject'],
  team: agentFlowTeam(),
  devCycle: {
    templateId: 'agent-flow',
    ceremonies: { preDaily: true, unblock: true, gate: true, qaHandoff: false, retro: true, releaseConflicts: false },
    ceremonyParams: defaultCeremonyParams(),
    stages: AGENT_FLOW_STAGES,
    stageMapping: [],
    meanings: {
      blocker: { stageKinds: ['blocked'], text: 'cycle.agentFlow.meaning.blocker' },
      question: { enabled: true, text: 'cycle.meaning.question' },
      readyForQa: { stageKinds: [], requiresSpec: false, text: '' },
    },
    enrichment: { specFolder: true, cardFields: [...CARD_FIELDS], extraFiles: [] },
    prompts: sameFamily('sdd'),
    promptOverrides: {},
    pipelineSkill: '',
    releaseLabelPattern: '^v?(\\d+\\.\\d+\\.\\d+)$',
    comments: agentFlowComments(),
    specLayout: {
      folderPrefix: '{iid}-',
      phaseFiles: [
        { file: '5_TEST_PLAN.md', label: 'cycle.agentFlow.phase.testPlan' },
        { file: '4_REVIEW.md', label: 'cycle.agentFlow.phase.review' },
        { file: '3_IMPLEMENTATION.md', label: 'cycle.agentFlow.phase.implementation' },
        { file: '2_PLAN.md', label: 'cycle.agentFlow.phase.plan' },
        { file: '1_SPEC.md', label: 'cycle.agentFlow.phase.spec' },
      ],
      planFiles: ['2_PLAN.md'],
      gateFiles: [
        { sub: '', gate: 1, files: [['1_SPEC.md', 'cycle.agentFlow.gate.spec']] },
        { sub: '', gate: 2, files: [['2_PLAN.md', 'cycle.agentFlow.gate.plan']] },
      ],
      decisionLog: { heading: 'cycle.agentFlow.decisionLog' },
      documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
    },
  },
};
