import type { Effect } from './types';

// What an agent can ask the app to check for an effect. Every check is answered by GET requests only.
export const CHECK_KINDS = [
  'mr_ready',
  'mr_reviewer',
  'mr_merged',
  'mr_created',
  'mr_synced_with_main',
  'mr_new_commit',
  'mr_pipeline',
  'mr_job',
  'mr_comment',
  'issue_comment',
  'issue_label',
  'issue_label_removed',
  'issue_closed',
  'issue_created',
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export interface CheckSpec {
  kind: CheckKind;
  // GitLab project path ("sz4/sz4"); not needed for issue_created, which uses it as the search scope.
  project: string;
  iid: number | null;
  // Expected label, job name, reviewer username, pipeline status or title words, depending on the kind.
  value: string | null;
}

export type EffectState = 'waiting' | 'done' | 'unverifiable';

export interface EffectEntry {
  key: string;
  ceremonyId: string | null;
  ref: string;
  text: string;
  repo: string;
  // Only things that happened after this moment count as the effect being done.
  since: string;
  // undefined until the agent has classified it (once); null when it found nothing objective to check.
  check?: CheckSpec | null;
  reason?: string;
  classifyTries: number;
  state: EffectState;
  doneAt: string | null;
  evidence: string | null;
  manual: boolean;
  checkedAt: string | null;
  error: string | null;
}

export interface EfeitosView {
  checkedAt: string | null;
  entries: Record<string, EffectEntry>;
}

// FNV-1a over ref + text: the same effect gets the same key in the Ata, in the History and in the job.
export function effectKey(e: Pick<Effect, 'ref' | 'text'>): string {
  let h = 0x811c9dc5;
  for (const c of `${e.ref}\n${e.text.trim()}`) {
    h ^= c.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const WINDOW_DAYS = 7;
