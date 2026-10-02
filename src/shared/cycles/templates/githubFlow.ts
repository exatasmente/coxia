// i18n-lint: allow-file cycle template data: stage names and patterns of the code host, whose text is catalog keys
import { CARD_FIELDS, type StageDef } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { rules } from './rules';

// GitHub Flow, kept simple: a branch per change, a pull request, review, merge to main. No QA stage and no spec files: the pull request is the
// unit of work, so what the standup follows is who is waiting for review and what is not mergeable.

const STAGES: StageDef[] = [
  { id: 'merged', label: 'Merged', match: ['^(Merged|Done|Closed)$'], kind: 'done', rank: 6 },
  { id: 'approved', label: 'Approved', match: ['Approved', 'Ready to merge'], kind: 'reviewApproved', rank: 5 },
  { id: 'changes-requested', label: 'Changes requested', match: ['Changes requested', 'Needs work'], kind: 'returned', rank: 4 },
  { id: 'in-review', label: 'In review', match: ['In review', 'Ready for review', 'PR open', 'Review'], kind: 'review', rank: 4 },
  { id: 'blocked', label: 'Blocked', match: ['^(Blocked|Impediment).*$'], kind: 'blocked', rank: 3 },
  { id: 'in-progress', label: 'In progress', match: ['In progress', 'Doing', 'Draft'], kind: 'development', rank: 3 },
  { id: 'open', label: 'Open', match: ['^(Open|Backlog|Todo|To do)$'], kind: 'backlog', rank: 1 },
];

export const githubFlow: CycleTemplate = {
  id: 'github-flow',
  name: 'cycle.githubFlow.name',
  description: 'cycle.githubFlow.description',
  needs: ['issueProject'],
  devCycle: {
    templateId: 'github-flow',
    ceremonies: { preDaily: true, unblock: true, gate: false, qaHandoff: false, retro: false, releaseConflicts: false },
    ceremonyParams: {
      ...defaultCeremonyParams(),
      preDaily: { label: 'cycle.label.standup', speechWords: 50, specReads: 0, summaryTarget: '', summaryStyle: 'cycle.summary.style' },
    },
    stages: STAGES,
    stageMapping: [
      ...rules('github', 'field', 'Status', [
        ['^(Done|Merged)$', 'merged'],
        ['^Approved$', 'approved'],
        ['^Changes requested$', 'changes-requested'],
        ['^(In review|Ready for review)$', 'in-review'],
        ['^Blocked$', 'blocked'],
        ['^(In progress|Draft)$', 'in-progress'],
        ['^(Todo|To do|Backlog|Open)$', 'open'],
      ]),
      ...rules('github', 'label', '', [
        ['^(blocked|status: blocked)$', 'blocked'],
        ['^(changes requested|status: changes requested)$', 'changes-requested'],
        ['^(approved|status: approved)$', 'approved'],
        ['^(in review|ready for review|status: in review)$', 'in-review'],
        ['^(in progress|status: in progress)$', 'in-progress'],
      ]),
      ...rules('github', 'state', '', [
        ['^merged$', 'merged'],
        ['^closed$', 'merged'],
        ['^open$', 'open'],
      ]),
      ...rules('gitlab', 'status', '', [
        ['^(Done|Closed)$', 'merged'],
        ['^Approved in code review$', 'approved'],
        ['^Rejected in code review$', 'changes-requested'],
        ['^(Ready for code review|In code review)$', 'in-review'],
        ['^(In development|In progress)$', 'in-progress'],
        ['^Open$', 'open'],
      ]),
      ...rules('bitbucket', 'state', '', [
        ['^(MERGED|closed|resolved)$', 'merged'],
        ['^on hold$', 'blocked'],
        ['^(OPEN|open)$', 'in-review'],
        ['^new$', 'open'],
      ]),
    ],
    meanings: {
      blocker: { stageKinds: ['blocked'], text: 'cycle.githubFlow.meaning.blocker' },
      question: { enabled: true, text: 'cycle.meaning.question' },
      readyForQa: { stageKinds: [], requiresSpec: false, text: '' },
    },
    enrichment: { specFolder: false, cardFields: [...CARD_FIELDS], extraFiles: [] },
    prompts: sameFamily('sdd'),
    promptOverrides: {},
    specLayout: {
      folderPrefix: '#{iid}-',
      phaseFiles: [],
      planFiles: [],
      gateFiles: [],
      decisionLog: { heading: '' },
      documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
    },
  },
};
