import { VcsError } from './errors';
import type { VcsCiStatus } from './types';

export const enc = encodeURIComponent;

/** Runs `fn` over the items with at most `size` in flight, keeping the order of the results. */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const PROJECT = /^[\w.-]+(\/[\w.-]+)+$/;

/** "group/sub/name" (at least owner and name) or a numeric id; throws a translated error for anything else. */
export function checkProject(project: string, allowId = true): string {
  if (!(PROJECT.test(project) && !project.split('/').some((s) => /^\.+$/.test(s))) && !(allowId && /^\d+$/.test(project))) throw new VcsError('invalid', { detail: project });
  return project;
}

export function checkIid(iid: number): number {
  if (!Number.isSafeInteger(iid) || iid <= 0) throw new VcsError('invalid', { detail: String(iid) });
  return iid;
}

/** The longest title of a new issue the app writes: the hosts take 256 characters (GitHub, Bitbucket) and more (GitLab). */
export const ISSUE_TITLE_MAX = 256;

/** The title of a new issue: one line of text that is not empty, trimmed. */
export function checkTitle(title: string): string {
  const one = title.replace(/\s+/g, ' ').trim();
  if (!one || one.length > ISSUE_TITLE_MAX) throw new VcsError('invalid', { detail: title.slice(0, 40) });
  return one;
}

/** A label to give a new issue: text, no comma (GitLab joins them with one) and no line break. */
export function checkLabel(label: string): string {
  const one = label.trim();
  if (!one || one.length > 200 || /[,\n\r]/.test(one)) throw new VcsError('invalid', { detail: label.slice(0, 40) });
  return one;
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|see|related to)\s*:?\s+(?:[\w./-]*#)?(\d+)\b/gi;
const HASH = /(?:^|[\s(\[])#(\d{1,9})\b/g;
const BRANCH = /(?:^|[/_-])(\d{2,9})(?:$|[/_-])/;

/** Issue numbers an MR mentions: "Closes #12", "(#12)", "#12" in the title, or a number in the branch name. Best effort. */
export function issueRefsOf(text: string, branch = ''): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(CLOSING)) found.add(Number(m[1]));
  for (const m of text.matchAll(HASH)) found.add(Number(m[1]));
  const b = BRANCH.exec(branch);
  if (b) found.add(Number(b[1]));
  return [...found].filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function iso(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0;
}

/** The id of a note to delete: a positive whole number, never what `num` makes of text (0), because a delete must name exactly what it removes. */
export function noteNum(value: string | number): number {
  const n = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : 0;
  if (!Number.isSafeInteger(n) || n <= 0) throw new VcsError('invalid', { detail: String(value).slice(0, 40) });
  return n;
}

/** Worst-first merge of several CI states into the one the card shows. */
export function worstCi(states: VcsCiStatus[]): VcsCiStatus | null {
  const order: VcsCiStatus[] = ['failed', 'running', 'pending', 'manual', 'canceled', 'success', 'skipped'];
  for (const s of order) if (states.includes(s)) return s;
  return null;
}

/** Splits a raw unified diff (several files) into one entry per file. */
export function splitUnifiedDiff(raw: string): { path: string; diff: string }[] {
  const out: { path: string; diff: string }[] = [];
  const parts = raw.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  for (const part of parts) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/m.exec(part);
    const path = head?.[2] ?? head?.[1];
    if (!path) continue;
    const at = part.search(/^@@/m);
    out.push({ path, diff: at >= 0 ? part.slice(at) : '' });
  }
  return out;
}
