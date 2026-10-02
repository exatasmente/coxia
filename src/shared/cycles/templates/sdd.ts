import { CARD_FIELDS, type StageDef, type StageMappingRule } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { rules } from './rules';

// SDD: spec-driven development with gates and a QA hand-off. This is the process the app was built around, with the company and machine
// specifics left out: the QA account, the issue prefix, the pointers to a team's own playbook and the release tool all come from the
// workspace config (the legacy profile fills them for the install that existed before templates).

export const SDD_STAGES: StageDef[] = [
  { id: 'done', label: 'Done', match: ['^(STAGE::\\s*)?(Done|Closed|Released)$'], kind: 'done', rank: 9 },
  { id: 'test-ok', label: 'Test OK', match: ['Test OK', 'Approved in testing'], kind: 'qaApproved', rank: 8 },
  { id: 'in-testing', label: 'Ready To Test', match: ['Ready To Test', 'Ready for testing', 'In Testing', 'Blocked in testing'], kind: 'qa', rank: 7 },
  { id: 'test-failed', label: 'Test Fail', match: ['Test Fail', 'Failed testing'], kind: 'returned', rank: 7 },
  { id: 'review-ok', label: 'Code Review OK', match: ['Code Review OK', 'Approved in code review'], kind: 'reviewApproved', rank: 6 },
  { id: 'in-review', label: 'Code Review', match: ['Code Review', 'Ready for code review', 'In code review'], kind: 'review', rank: 5 },
  { id: 'rejected', label: 'Rejected', match: ['Rejected'], kind: 'returned', rank: 4 },
  { id: 'blocked', label: 'Blocked', match: ['^(STAGE::\\s*)?Blocked(\\s*[-:].*)?$', 'Impediment'], kind: 'blocked', rank: 3 },
  { id: 'doing', label: 'Doing', match: ['Doing', 'In development', 'Blocked in development', 'In progress'], kind: 'development', rank: 3 },
  { id: 'backlog', label: 'Backlog', match: ['Backlog', 'To Do', 'Ready for planning', '^Open$'], kind: 'backlog', rank: 1 },
];

export const SDD_MAPPING: StageMappingRule[] = [
  ...rules('gitlab', 'label', '', [
    ['^STAGE::\\s*Done$', 'done'],
    ['^STAGE::\\s*Test OK$', 'test-ok'],
    ['^STAGE::\\s*Ready To Test$', 'in-testing'],
    ['^STAGE::\\s*Test Fail$', 'test-failed'],
    ['^STAGE::\\s*Code Review OK$', 'review-ok'],
    ['^STAGE::\\s*Code Review$', 'in-review'],
    ['^STAGE::\\s*Blocked', 'blocked'],
    ['^STAGE::\\s*Doing$', 'doing'],
    ['^STAGE::\\s*(Backlog|To Do)$', 'backlog'],
  ]),
  ...rules('gitlab', 'status', '', [
    ['^(Done|Closed)$', 'done'],
    ['^Approved in testing$', 'test-ok'],
    ['^(Ready for testing|In testing|Blocked in testing)$', 'in-testing'],
    ['^Failed testing$', 'test-failed'],
    ['^Approved in code review$', 'review-ok'],
    ['^(Ready for code review|In code review)$', 'in-review'],
    ['^Rejected in code review$', 'rejected'],
    ['^(In development|Blocked in development)$', 'doing'],
    ['^(Open|Ready for planning)$', 'backlog'],
  ]),
  ...rules('github', 'field', 'Status', [
    ['^(Done|Released)$', 'done'],
    ['^(Ready for (QA|testing)|In (QA|testing)|QA|Testing)$', 'in-testing'],
    ['^(Approved|Review approved)$', 'review-ok'],
    ['^(In review|Review)$', 'in-review'],
    ['^Blocked$', 'blocked'],
    ['^(In progress|Doing)$', 'doing'],
    ['^(Backlog|Todo|To do)$', 'backlog'],
  ]),
  ...rules('github', 'state', '', [['^closed$', 'done']]),
  ...rules('bitbucket', 'state', '', [
    ['^(closed|resolved)$', 'done'],
    ['^on hold$', 'blocked'],
    ['^open$', 'doing'],
    ['^new$', 'backlog'],
  ]),
];

export const sdd: CycleTemplate = {
  id: 'sdd',
  name: 'cycle.sdd.name',
  description: 'cycle.sdd.description',
  needs: ['specsDir', 'qaUser', 'issueProject', 'releaseSync'],
  devCycle: {
    templateId: 'sdd',
    ceremonies: { preDaily: true, unblock: true, gate: true, qaHandoff: true, retro: true, releaseConflicts: true },
    ceremonyParams: defaultCeremonyParams(),
    stages: SDD_STAGES,
    stageMapping: SDD_MAPPING,
    meanings: {
      blocker: { stageKinds: ['blocked'], text: 'cycle.sdd.meaning.blocker' },
      question: { enabled: true, text: 'cycle.meaning.question' },
      readyForQa: { stageKinds: ['reviewApproved', 'returned', 'qa'], requiresSpec: true, text: 'cycle.sdd.meaning.readyForQa' },
    },
    enrichment: { specFolder: true, cardFields: [...CARD_FIELDS], extraFiles: [] },
    prompts: sameFamily('sdd'),
    promptOverrides: {},
    pipelineSkill: '',
    releaseLabelPattern: '^v?(\\d+\\.\\d+\\.\\d+)$',
    specLayout: {
      folderPrefix: '#{iid}-',
      phaseFiles: [
        { file: 'ISSUE_COMPLETION.md', label: 'cycle.sdd.phase.completion' },
        { file: '3_TEST_PLAN.md', label: 'cycle.sdd.phase.testPlan' },
        { file: '4_TEST_PLAN.md', label: 'cycle.sdd.phase.testPlan' },
        { file: '2_PLAN.md', label: 'cycle.sdd.phase.plan' },
        { file: '3_PLAN.md', label: 'cycle.sdd.phase.plan' },
        { file: '2_SPEC_TECNICO.md', label: 'cycle.sdd.phase.techSpec' },
        { file: '1_SPEC_FUNCIONAL.md', label: 'cycle.sdd.phase.funcSpec' },
        { file: '1_INVESTIGATION.md', label: 'cycle.sdd.phase.investigation' },
        { file: '1_FINDINGS.md', label: 'cycle.sdd.phase.findings' },
        { file: '0_RFC.md', label: 'cycle.sdd.phase.rfc' },
        { file: '0_BUG_REPORT.md', label: 'cycle.sdd.phase.bugReport' },
      ],
      planFiles: ['2_PLAN.md', '3_PLAN.md'],
      gateFiles: [
        { sub: 'bug', gate: 1, files: [['1_INVESTIGATION.md', 'cycle.sdd.gate.investigation']] },
        { sub: 'bug', gate: 2, files: [['2_PLAN.md', 'cycle.sdd.gate.plan']] },
        { sub: 'feat', gate: 1, files: [['1_SPEC_FUNCIONAL.md', 'cycle.sdd.gate.funcSpec'], ['0_RFC.md', 'cycle.sdd.gate.rfc']] },
        { sub: 'feat', gate: 2, files: [['3_PLAN.md', 'cycle.sdd.gate.plan']] },
        { sub: 'investigation', gate: 1, files: [['1_FINDINGS.md', 'cycle.sdd.gate.findings']] },
      ],
      decisionLog: { heading: 'cycle.sdd.decisionLog' },
      documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
    },
  },
};
