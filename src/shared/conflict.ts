import type { ReleaseAction } from './types';

export type HunkChoice = 'proposal' | 'ours' | 'theirs' | 'edit';
export type Confidence = 'alta' | 'media' | 'baixa';

// ours = the MR branch, theirs = main. A whole-file hunk covers conflicts that leave no markers (delete/modify).
export interface ConflictHunk {
  id: string;
  file: string;
  whole: boolean;
  ours: string;
  oursGone: boolean;
  base: string | null;
  theirs: string;
  theirsGone: boolean;
  // The agent never sees files that look like secrets: no proposal, the user decides.
  sensitive: boolean;
  proposal: string | null;
  explanation: string | null;
  confidence: Confidence | null;
  test: string | null;
  // The proposal came from an agent that stopped before finishing its reading.
  partial?: boolean;
  choice: HunkChoice | null;
  edited: string | null;
}

export interface ConflictFile {
  path: string;
  hunks: ConflictHunk[];
}

export interface ConflictVerify {
  command: string | null;
  skipped: boolean;
  exitCode: number | null;
  tail: string;
  log: string | null;
  at: string;
}

export interface ConflictResolve {
  clone: string;
  worktree: string;
  branch: string;
  target: string;
  syncBranch: string;
  originSha: string;
  mainSha: string;
  files: ConflictFile[];
  preparedAt: string;
  proposedAt: string | null;
  proposalSummary: string | null;
  appliedAt: string | null;
  verify: ConflictVerify | null;
  commit: string | null;
  pushId: string | null;
  publishedAt: string | null;
  // The step running right now; cleared on startup in case the app died in the middle.
  busy: string | null;
}

export type ConflictStep = 'none' | 'prepared' | 'proposed' | 'applied' | 'verify-failed' | 'push-waiting' | 'published';

export function conflictStep(a: Pick<ReleaseAction, 'resolve'>): ConflictStep {
  const r = a.resolve;
  if (!r) return 'none';
  if (r.publishedAt) return 'published';
  if (r.commit) return 'push-waiting';
  if (r.appliedAt) return r.verify && r.verify.exitCode !== 0 && !r.verify.skipped ? 'verify-failed' : 'applied';
  if (r.proposedAt) return 'proposed';
  return 'prepared';
}

const STEP_LABEL: Record<ConflictStep, string> = {
  none: 'sem preparo',
  prepared: 'preparado',
  proposed: 'proposta pronta',
  applied: 'aplicado e verificado',
  'verify-failed': 'verificação falhou',
  'push-waiting': 'aguardando “sim” para publicar',
  published: 'publicado',
};

export function conflictProgress(a: Pick<ReleaseAction, 'resolve'>): string {
  const step = conflictStep(a);
  if (a.resolve?.busy) return a.resolve.busy;
  if (step === 'applied' && a.resolve?.verify?.skipped) return 'aplicado sem testes';
  return STEP_LABEL[step];
}

// What a choice writes for the hunk; null means the side deleted the file (whole-file hunks) or nothing was chosen.
export function hunkText(h: ConflictHunk, choice: HunkChoice | null = h.choice): string | null {
  if (choice === 'proposal') return h.proposal;
  if (choice === 'ours') return h.oursGone ? null : h.ours;
  if (choice === 'theirs') return h.theirsGone ? null : h.theirs;
  if (choice === 'edit') return h.edited;
  return null;
}

export function hunkReady(h: ConflictHunk): boolean {
  if (h.choice === null) return false;
  if (h.choice === 'proposal') return h.proposal !== null;
  if (h.choice === 'edit') return h.edited !== null;
  return true;
}

export const allChosen = (files: ConflictFile[]): boolean => files.every((f) => f.hunks.every(hunkReady));
