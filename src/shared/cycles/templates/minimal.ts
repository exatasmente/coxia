import { CARD_FIELDS, type StageDef } from '../../config/types';
import { defaultCeremonyParams, sameFamily } from '../neutral';
import type { CycleTemplate } from '../types';
import { rules } from './rules';

// Minimal: the daily preparation and the unblock conversation, and nothing else. Three stages, no files, no schedule beyond the standup.

const STAGES: StageDef[] = [
  { id: 'done', label: 'Done', match: ['^(STAGE::\\s*)?(Done|Closed|Merged|Released)$'], kind: 'done', rank: 3 },
  { id: 'blocked', label: 'Blocked', match: ['^(STAGE::\\s*)?(Blocked|Impediment).*$'], kind: 'blocked', rank: 2 },
  { id: 'doing', label: 'Doing', match: ['Doing', 'In progress', 'In development', 'In review', 'Review'], kind: 'development', rank: 2 },
  { id: 'todo', label: 'To do', match: ['To do', 'Todo', 'Backlog', '^Open$', 'Ready'], kind: 'backlog', rank: 1 },
];

export const minimal: CycleTemplate = {
  id: 'minimal',
  name: 'cycle.minimal.name',
  description: 'cycle.minimal.description',
  needs: [],
  devCycle: {
    templateId: 'minimal',
    ceremonies: { preDaily: true, unblock: true, gate: false, qaHandoff: false, retro: false, releaseConflicts: false },
    ceremonyParams: {
      ...defaultCeremonyParams(),
      preDaily: { label: 'cycle.label.standup', speechWords: 40, specReads: 0, summaryTarget: '', summaryStyle: 'cycle.summary.style' },
    },
    stages: STAGES,
    stageMapping: [
      ...rules('any', 'state', '', [
        ['^(closed|merged|resolved)$', 'done'],
        ['^(open|new)$', 'todo'],
      ]),
      ...rules('github', 'field', 'Status', [
        ['^Done$', 'done'],
        ['^Blocked$', 'blocked'],
        ['^(In progress|In review)$', 'doing'],
        ['^(Todo|To do|Backlog)$', 'todo'],
      ]),
      ...rules('gitlab', 'status', '', [
        ['^(Done|Closed)$', 'done'],
        ['^(In development|In progress|Ready for code review|In code review)$', 'doing'],
        ['^(Open|Ready for planning|To do)$', 'todo'],
      ]),
    ],
    meanings: {
      blocker: { stageKinds: ['blocked'], text: '' },
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
