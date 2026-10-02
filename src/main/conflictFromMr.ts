import { t } from '../shared/i18n';
export interface MrRef {
  // Full "group/project" when the ref carries it; the last segment otherwise.
  project: string;
  full: boolean;
  iid: number;
}

const PROJECT = /^[\w.-]+(\/[\w.-]+)*$/;

// Accepts "group/sub/project!797" and "project!797" (the card's short form); a bare "!797" is refused.
export function parseMrRef(ref: string): MrRef {
  const m = /^\s*(.+?)!(\d+)\s*$/.exec(ref);
  if (!m || !PROJECT.test(m[1]) || m[1].split('/').some((s) => /^\.+$/.test(s))) throw new Error(t('main.conflictMr.invalidRef', { ref }));
  const iid = Number(m[2]);
  if (!Number.isSafeInteger(iid) || iid <= 0) throw new Error(t('main.conflictMr.invalidNumber', { ref }));
  return { project: m[1], full: m[1].includes('/'), iid };
}

// The short form needs the card's own MR list to learn the project path.
export function resolveMr(ref: string, known: { ref: string; project: string; iid: number }[]): { project: string; iid: number } {
  const p = parseMrRef(ref);
  if (p.full) return { project: p.project, iid: p.iid };
  const hits = known.filter((k) => k.iid === p.iid && (k.ref === ref.trim() || k.project.split('/').pop() === p.project));
  if (hits.length !== 1) throw new Error(hits.length ? t('main.conflictMr.ambiguous', { ref }) : t('main.conflictMr.notOfActivity', { ref }));
  return { project: hits[0].project, iid: hits[0].iid };
}

export interface MrRead {
  state: 'open' | 'merged' | 'closed';
  hasConflicts: boolean | null;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  sha: string;
  author: string;
}

export interface MrChecks {
  me: string;
  defaultBranch: string;
}

// Throws the pt-BR reason when this MR is not one the app resolves.
export function assertResolvable(ref: string, mr: MrRead, c: MrChecks): void {
  if (mr.state !== 'open') throw new Error(t('main.conflictMr.notOpen', { ref, state: mr.state }));
  if (mr.targetBranch !== c.defaultBranch) throw new Error(t('main.conflictMr.notMain', { ref, target: mr.targetBranch, main: c.defaultBranch }));
  if (mr.author !== c.me) throw new Error(t('main.conflictMr.notYours', { ref, author: mr.author }));
  // The conflict flag is computed lazily by the host and is often stale (post-release-sync skill): the local merge in Preparar decides.
}
