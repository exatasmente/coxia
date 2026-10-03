// i18n-lint: allow-file cycle template data: stage names and file names, whose texts are catalog keys
import { RECOMMENDED, newAgent } from '../../config/team';
import { CARD_FIELDS, type AgentDef, type StageDef, type SpecLayout } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { agentFlowComments } from './agentFlowComments';

// The agent cycle: the stages are work done by a team of agents with the roles a product team has, and the person at the two gates. An issue goes
// triage, refine, gate 1, plan, gate 2, implement, review, QA, ready (it waits there for its pull request to be merged) and communicate; each work stage
// names its agent and the files it must produce in the cycle folder (no sub-folder: one flow for every kind of issue). The tracker's own stage is not
// mapped: a run carries its stage, shown beside the card. The engineering cycle below is the same flow without the business roles: what the agent cycle
// was before they were added, and what a workspace that already had it keeps.

export const ENGINEERING_FLOW_STAGES: StageDef[] = [
  { id: 'refine', label: 'cycle.agentFlow.stage.refine', match: ['^Refin'], kind: 'backlog', rank: 1, type: 'work', agentId: 'refiner', produces: ['1_SPEC.md'] },
  { id: 'gate1', label: 'cycle.agentFlow.stage.gate1', match: ['^Gate 1$'], kind: 'backlog', rank: 2, type: 'gate' },
  { id: 'plan', label: 'cycle.agentFlow.stage.plan', match: ['^Plan'], kind: 'development', rank: 3, type: 'work', agentId: 'planner', produces: ['2_PLAN.md'] },
  { id: 'gate2', label: 'cycle.agentFlow.stage.gate2', match: ['^Gate 2$'], kind: 'development', rank: 4, type: 'gate' },
  { id: 'implement', label: 'cycle.agentFlow.stage.implement', match: ['^Implement'], kind: 'development', rank: 5, type: 'work', agentId: 'developer', produces: ['3_IMPLEMENTATION.md'] },
  { id: 'review', label: 'cycle.agentFlow.stage.review', match: ['^Review'], kind: 'review', rank: 6, type: 'work', agentId: 'reviewer', produces: ['4_REVIEW.md'], returnsTo: 'implement', roundLimit: 2 },
  { id: 'qa', label: 'cycle.agentFlow.stage.qa', match: ['^QA$'], kind: 'qa', rank: 7, type: 'work', agentId: 'qa', produces: ['5_TEST_PLAN.md'], returnsTo: 'implement', roundLimit: 2 },
  // Where the run ends: no agent works it.
  { id: 'ready', label: 'cycle.agentFlow.stage.ready', match: ['^Ready$'], kind: 'reviewApproved', rank: 8, type: 'work' },
];

export const AGENT_FLOW_STAGES: StageDef[] = [
  { id: 'triage', label: 'cycle.agentFlow.stage.triage', match: ['^Triage'], kind: 'backlog', rank: 1, type: 'work', agentId: 'support', produces: ['0_TRIAGE.md'] },
  { id: 'refine', label: 'cycle.agentFlow.stage.refine', match: ['^Refin'], kind: 'backlog', rank: 2, type: 'work', agentId: 'product-owner', produces: ['1_SPEC.md'] },
  { id: 'gate1', label: 'cycle.agentFlow.stage.gate1', match: ['^Gate 1$'], kind: 'backlog', rank: 3, type: 'gate' },
  { id: 'plan', label: 'cycle.agentFlow.stage.plan', match: ['^Plan'], kind: 'development', rank: 4, type: 'work', agentId: 'tech-lead', produces: ['2_PLAN.md'] },
  { id: 'gate2', label: 'cycle.agentFlow.stage.gate2', match: ['^Gate 2$'], kind: 'development', rank: 5, type: 'gate' },
  { id: 'implement', label: 'cycle.agentFlow.stage.implement', match: ['^Implement'], kind: 'development', rank: 6, type: 'work', agentId: 'developer', produces: ['3_IMPLEMENTATION.md'] },
  { id: 'review', label: 'cycle.agentFlow.stage.review', match: ['^Review'], kind: 'review', rank: 7, type: 'work', agentId: 'tech-lead', produces: ['4_REVIEW.md'], returnsTo: 'implement', roundLimit: 2 },
  { id: 'qa', label: 'cycle.agentFlow.stage.qa', match: ['^QA$'], kind: 'qa', rank: 8, type: 'work', agentId: 'qa', produces: ['5_TEST_PLAN.md'], returnsTo: 'implement', roundLimit: 2 },
  // The pull request is merged by a person: the run waits for it, and its stage is where the watcher looks at the pull request.
  { id: 'ready', label: 'cycle.agentFlow.stage.ready', match: ['^Ready$'], kind: 'reviewApproved', rank: 9, type: 'wait', waitsFor: { kind: 'pr-merged' } },
  { id: 'communicate', label: 'cycle.agentFlow.stage.communicate', match: ['^Communicat'], kind: 'done', rank: 10, type: 'work', agentId: 'customer-success', produces: ['6_RELEASE_NOTE.md'] },
];

// What each role is given besides its files: the Product Owner and the Tech Lead read the tracker, and the roles that check or build run commands in a sandbox
// (RECOMMENDED in config/team.ts is the same table, by id: the editor offers it to a team that already exists).
const member = (id: string, key: string, stages: string[], permission: AgentDef['permission'], turnsTo: string | null): AgentDef =>
  newAgent({ id, name: `cycle.agentFlow.team.${key}.name`, job: `cycle.agentFlow.team.${key}.job`, instructions: `cycle.agentFlow.team.${key}.instructions`, stages, permission, tracker: RECOMMENDED[id].tracker, shell: RECOMMENDED[id].shell, autonomous: true, turnsTo, model: { role: 'deep' } });

/**
 * The default team of the agent cycle: the roles of a product team, all autonomous (the person is at the two gates), and only the developer may change files,
 * inside its run's worktree. Each turns to the one whose answer it needs before it asks the person: the support agent and customer success to the product
 * owner (who decides what the product does), the developer and QA to the tech lead, the tech lead to the product owner for scope; the product owner to the person.
 */
export function agentFlowTeam(): AgentDef[] {
  return [
    member('support', 'support', ['triage'], 'read', 'product-owner'),
    member('product-owner', 'productOwner', ['refine'], 'read', null),
    member('tech-lead', 'techLead', ['plan', 'review'], 'read', 'product-owner'),
    member('developer', 'developer', ['implement'], 'worktree', 'tech-lead'),
    member('qa', 'qa', ['qa'], 'read', 'tech-lead'),
    member('customer-success', 'customerSuccess', ['communicate'], 'read', 'product-owner'),
  ];
}

/** The team of the engineering cycle: refine, plan, implement, review and QA, each its own agent, none turning to another. */
export function engineeringTeam(): AgentDef[] {
  return [
    member('refiner', 'refiner', ['refine'], 'read', null),
    member('planner', 'planner', ['plan'], 'read', null),
    member('developer', 'developer', ['implement'], 'worktree', null),
    member('reviewer', 'reviewer', ['review'], 'read', null),
    member('qa', 'qa', ['qa'], 'read', null),
  ];
}

const phase = (file: string, key: string) => ({ file, label: `cycle.agentFlow.phase.${key}` });

const specLayout = (business: boolean): SpecLayout => ({
  folderPrefix: '{iid}-',
  phaseFiles: [
    ...(business ? [phase('6_RELEASE_NOTE.md', 'releaseNote')] : []),
    phase('5_TEST_PLAN.md', 'testPlan'),
    phase('4_REVIEW.md', 'review'),
    phase('3_IMPLEMENTATION.md', 'implementation'),
    phase('2_PLAN.md', 'plan'),
    phase('1_SPEC.md', 'spec'),
    ...(business ? [phase('0_TRIAGE.md', 'triage')] : []),
  ],
  planFiles: ['2_PLAN.md'],
  gateFiles: [
    { sub: '', gate: 1, files: [['1_SPEC.md', 'cycle.agentFlow.gate.spec']] },
    { sub: '', gate: 2, files: [['2_PLAN.md', 'cycle.agentFlow.gate.plan']] },
  ],
  decisionLog: { heading: 'cycle.agentFlow.decisionLog' },
  documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
});

function template(id: string, key: string, stages: StageDef[], team: AgentDef[], business: boolean): CycleTemplate {
  return {
    id,
    name: `cycle.${key}.name`,
    description: `cycle.${key}.description`,
    needs: ['issueProject'],
    team,
    devCycle: {
      templateId: id,
      ceremonies: { preDaily: true, unblock: true, gate: true, qaHandoff: false, retro: true, releaseConflicts: false },
      ceremonyParams: defaultCeremonyParams(),
      stages,
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
      comments: agentFlowComments(business),
      specLayout: specLayout(business),
    },
  };
}

/** The agent cycle: a product team (support, product owner, tech lead, developer, QA, customer success) takes an issue from triage to the note that tells the reporter what changed. */
export const agentFlow: CycleTemplate = template('agent-flow', 'agentFlow', AGENT_FLOW_STAGES, agentFlowTeam(), true);

/** The engineering cycle: refine to ready with the engineering roles only, as the agent cycle was before it grew the business ones. */
export const agentFlowEngineering: CycleTemplate = template('agent-flow-engineering', 'agentFlowEngineering', ENGINEERING_FLOW_STAGES, engineeringTeam(), false);
