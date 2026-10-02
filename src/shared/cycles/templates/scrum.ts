import { CARD_FIELDS, type StageDef } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { rules } from './rules';

// Scrum: sprints with a daily scrum and a sprint retrospective. No spec files, no gates, no QA hand-off: the board is the source of truth.

const STAGES: StageDef[] = [
  { id: 'done', label: 'Done', match: ['^(STAGE::\\s*)?(Done|Closed|Released)$'], kind: 'done', rank: 6 },
  { id: 'testing', label: 'Testing', match: ['Testing', 'In QA', 'Ready for QA'], kind: 'qa', rank: 5 },
  { id: 'in-review', label: 'In Review', match: ['In Review', 'Code Review', 'Review'], kind: 'review', rank: 4 },
  { id: 'blocked', label: 'Blocked', match: ['^(STAGE::\\s*)?(Blocked|Impediment).*$'], kind: 'blocked', rank: 3 },
  { id: 'in-progress', label: 'In Progress', match: ['In Progress', 'Doing', 'In development'], kind: 'development', rank: 3 },
  { id: 'todo', label: 'To Do', match: ['To Do', 'Todo', 'Sprint Backlog', 'Selected'], kind: 'backlog', rank: 2 },
  { id: 'backlog', label: 'Backlog', match: ['Backlog', '^Open$', 'Ready for planning'], kind: 'backlog', rank: 1 },
];

export const scrum: CycleTemplate = {
  id: 'scrum',
  name: 'cycle.scrum.name',
  description: 'cycle.scrum.description',
  needs: ['issueProject'],
  devCycle: {
    templateId: 'scrum',
    ceremonies: { preDaily: true, unblock: true, gate: false, qaHandoff: false, retro: true, releaseConflicts: false },
    ceremonyParams: {
      ...defaultCeremonyParams(),
      preDaily: { label: 'cycle.label.dailyScrum', speechWords: 50, specReads: 0, summaryTarget: '', summaryStyle: 'cycle.summary.styleScrum' },
      retro: { windowDays: 14, speechWords: 150 },
    },
    stages: STAGES,
    stageMapping: [
      ...rules('gitlab', 'label', '', [
        ['^(STAGE|Status)::\\s*Done$', 'done'],
        ['^(STAGE|Status)::\\s*(Testing|In QA)$', 'testing'],
        ['^(STAGE|Status)::\\s*(In )?Review$', 'in-review'],
        ['^(STAGE|Status)::\\s*Blocked', 'blocked'],
        ['^(STAGE|Status)::\\s*(In Progress|Doing)$', 'in-progress'],
        ['^(STAGE|Status)::\\s*(To Do|Sprint Backlog)$', 'todo'],
        ['^(STAGE|Status)::\\s*Backlog$', 'backlog'],
      ]),
      ...rules('gitlab', 'status', '', [
        ['^(Done|Closed)$', 'done'],
        ['^(In development|In progress)$', 'in-progress'],
        ['^(Ready for code review|In code review)$', 'in-review'],
        ['^(To do|Ready for planning)$', 'todo'],
        ['^Open$', 'backlog'],
      ]),
      ...rules('github', 'field', 'Status', [
        ['^Done$', 'done'],
        ['^(Testing|In QA)$', 'testing'],
        ['^In review$', 'in-review'],
        ['^Blocked$', 'blocked'],
        ['^In progress$', 'in-progress'],
        ['^(Todo|To do|Sprint backlog)$', 'todo'],
        ['^Backlog$', 'backlog'],
      ]),
      ...rules('github', 'state', '', [['^closed$', 'done']]),
      ...rules('bitbucket', 'state', '', [
        ['^(closed|resolved)$', 'done'],
        ['^on hold$', 'blocked'],
        ['^open$', 'in-progress'],
        ['^new$', 'backlog'],
      ]),
    ],
    meanings: {
      blocker: { stageKinds: ['blocked'], text: 'cycle.scrum.meaning.blocker' },
      question: { enabled: true, text: 'cycle.meaning.question' },
      readyForQa: { stageKinds: [], requiresSpec: false, text: '' },
    },
    enrichment: { specFolder: false, cardFields: [...CARD_FIELDS], extraFiles: [] },
    prompts: { ...sameFamily('sdd'), retro: 'scrum' },
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
