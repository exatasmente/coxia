import { CARD_FIELDS, CEREMONY_IDS, PROMPT_ROLES, type CeremonyId, type CeremonyParams, type CycleMeanings, type DevCycleConfig, type PromptRole } from '../config/types';

// What a workspace that has not chosen a template gets: no stages, no spec layout, and the ceremony parameters every template starts from.

export const QUESTION_KINDS = ['cycle.kind.prediction', 'cycle.kind.counterfactual', 'cycle.kind.boundary', 'cycle.kind.sideEffect', 'cycle.kind.rollback', 'cycle.kind.regression'];

export function defaultCeremonyParams(): CeremonyParams {
  return {
    preDaily: { label: 'cycle.label.preDaily', speechWords: 60, specReads: 3, summaryTarget: '', summaryStyle: 'cycle.summary.style' },
    unblock: { speechWords: 80 },
    gate: { maxQuestions: 3, questionKinds: [...QUESTION_KINDS], summaryWords: 150 },
    qaHandoff: { speechWords: 150 },
    retro: { windowDays: 7, speechWords: 150 },
    releaseConflicts: { speechWords: 90 },
  };
}

export function defaultMeanings(): CycleMeanings {
  return {
    blocker: { stageKinds: ['blocked'], text: '' },
    question: { enabled: true, text: 'cycle.meaning.question' },
    readyForQa: { stageKinds: [], requiresSpec: true, text: '' },
  };
}

export function sameFamily(family: string): Record<PromptRole, string> {
  return Object.fromEntries(PROMPT_ROLES.map((r) => [r, family])) as Record<PromptRole, string>;
}

export function neutralDevCycle(): DevCycleConfig {
  return {
    templateId: 'none',
    ceremonies: Object.fromEntries(CEREMONY_IDS.map((c) => [c, c !== 'qaHandoff' && c !== 'releaseConflicts'])) as Record<CeremonyId, boolean>,
    ceremonyParams: defaultCeremonyParams(),
    stages: [],
    stageMapping: [],
    meanings: defaultMeanings(),
    enrichment: { specFolder: true, cardFields: [...CARD_FIELDS], extraFiles: [] },
    priority: { labels: [] },
    prompts: sameFamily('sdd'),
    promptOverrides: {},
    pipelineSkill: '',
    releaseLabelPattern: '^v?(\\d+\\.\\d+\\.\\d+)$',
    specLayout: {
      folderPrefix: '#{iid}-',
      phaseFiles: [],
      planFiles: [],
      gateFiles: [],
      decisionLog: { heading: '' },
      documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
    },
    comments: {},
    quickTransitions: [],
    qa: { user: null },
  };
}
