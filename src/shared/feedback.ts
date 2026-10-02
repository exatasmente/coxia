import type { ReleaseAction, Talk } from './types';

export type ReentryClass = 'defeito-novo' | 'causa-diferente' | 'so-plano' | 'ambiente';
export type ReentryPhase = 'F1' | 'F3' | 'F4' | 'nenhuma';

export interface MrPath {
  ref: string;
  project: string;
  iid: number;
}

export interface QaNoteView {
  id: number;
  at: string;
  where: string;
  excerpt: string;
  url: string;
}

export interface Reentry {
  id: string;
  ref: string;
  iid: string;
  title: string;
  stage: string | null;
  sessionId: string | null;
  speech: string;
  found: string;
  classification: ReentryClass;
  why: string;
  phase: ReentryPhase;
  steps: string[];
  notes: QaNoteView[];
  talk: Talk[];
  createdAt: string;
}

export interface DiscussionNote {
  author: string;
  at: string;
  body: string;
}

export interface Explanation {
  speech: string;
  // chat version; absent on explanations stored before it existed
  text?: string;
  point: string;
  needsCode: boolean;
  draft: string;
  sessionId: string | null;
  at: string;
  partial?: boolean;
}

export interface ProposalView {
  key: string;
  kind: 'reply' | 'resolve';
  state: ReleaseAction['state'] | 'unknown';
}

export interface DiscussionView {
  id: string;
  path: string | null;
  line: number | null;
  notes: DiscussionNote[];
  explanation: Explanation | null;
  // The thread got new notes after the explanation was written.
  stale: boolean;
  proposals: ProposalView[];
}

export interface DiscussionsResult {
  mr: MrPath;
  fetchedAt: string;
  discussions: DiscussionView[];
}
