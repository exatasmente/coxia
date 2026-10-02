// i18n-lint: allow-file cycle template data: stage names and patterns of the code host, whose text is catalog keys
import { CARD_FIELDS, type StageDef } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { rules } from './rules';

// Kanban: a continuous flow with limits on work in progress. A standup, the unblock conversation and a flow retro; nothing else.

const STAGES: StageDef[] = [
  { id: 'done', label: 'Done', match: ['^(STAGE::\\s*)?(Done|Closed|Released)$'], kind: 'done', rank: 5 },
  { id: 'review', label: 'Review', match: ['Review', 'Code Review', 'In Review'], kind: 'review', rank: 4 },
  { id: 'blocked', label: 'Blocked', match: ['^(STAGE::\\s*)?(Blocked|Impediment).*$'], kind: 'blocked', rank: 3 },
  { id: 'in-progress', label: 'In Progress', match: ['In Progress', 'Doing', 'In development'], kind: 'development', rank: 3 },
  { id: 'ready', label: 'Ready', match: ['Ready', 'To Do', 'Todo'], kind: 'backlog', rank: 2 },
  { id: 'backlog', label: 'Backlog', match: ['Backlog', '^Open$'], kind: 'backlog', rank: 1 },
];

export const kanban: CycleTemplate = {
  id: 'kanban',
  name: 'cycle.kanban.name',
  description: 'cycle.kanban.description',
  needs: ['issueProject'],
  devCycle: {
    templateId: 'kanban',
    ceremonies: { preDaily: true, unblock: true, gate: false, qaHandoff: false, retro: true, releaseConflicts: false },
    ceremonyParams: {
      ...defaultCeremonyParams(),
      preDaily: { label: 'cycle.label.standup', speechWords: 50, specReads: 0, summaryTarget: '', summaryStyle: 'cycle.summary.styleKanban' },
    },
    stages: STAGES,
    stageMapping: [
      ...rules('gitlab', 'label', '', [
        ['^(STAGE|Status)::\\s*Done$', 'done'],
        ['^(STAGE|Status)::\\s*(In )?Review$', 'review'],
        ['^(STAGE|Status)::\\s*Blocked', 'blocked'],
        ['^(STAGE|Status)::\\s*(In Progress|Doing)$', 'in-progress'],
        ['^(STAGE|Status)::\\s*(Ready|To Do)$', 'ready'],
        ['^(STAGE|Status)::\\s*Backlog$', 'backlog'],
      ]),
      ...rules('gitlab', 'status', '', [
        ['^(Done|Closed)$', 'done'],
        ['^(Ready for code review|In code review)$', 'review'],
        ['^(In development|In progress)$', 'in-progress'],
        ['^(To do|Ready for planning)$', 'ready'],
        ['^Open$', 'backlog'],
      ]),
      ...rules('github', 'field', 'Status', [
        ['^Done$', 'done'],
        ['^In review$', 'review'],
        ['^Blocked$', 'blocked'],
        ['^In progress$', 'in-progress'],
        ['^(Ready|Todo|To do)$', 'ready'],
        ['^Backlog$', 'backlog'],
      ]),
      ...rules('github', 'state', '', [['^closed$', 'done']]),
      ...rules('bitbucket', 'state', '', [
        ['^(closed|resolved)$', 'done'],
        ['^on hold$', 'blocked'],
        ['^open$', 'in-progress'],
        ['^new$', 'backlog'],
      ]),
      ...rules('any', 'column', '', [
        ['^Done$', 'done'],
        ['^Review$', 'review'],
        ['^Blocked', 'blocked'],
        ['^(In progress|Doing)$', 'in-progress'],
        ['^(Ready|To do)$', 'ready'],
        ['^Backlog$', 'backlog'],
      ]),
    ],
    meanings: {
      blocker: { stageKinds: ['blocked'], text: 'cycle.kanban.meaning.blocker' },
      question: { enabled: true, text: 'cycle.meaning.question' },
      readyForQa: { stageKinds: [], requiresSpec: false, text: '' },
    },
    enrichment: { specFolder: false, cardFields: [...CARD_FIELDS], extraFiles: [] },
    prompts: { ...sameFamily('sdd'), retro: 'kanban' },
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
