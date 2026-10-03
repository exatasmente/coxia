import type { ReleaseAction, VcsCommand } from '../types';
import { type Finding, type Run } from './types';
import { type FindingThread, reviewRounds } from './view';

// What a proposal of the runner shows in Actions before the person says "yes": the comment as it will read, the review's comments, the pull request's
// description, the labels. It is worked out from the run (which keeps the text it proposed) and, for what the run does not keep, from the writes themselves.
// Pure: it reads an action and a run and returns plain data.

export const PROPOSAL_PURPOSES = ['comment', 'review', 'run-pr', 'undo', 'priority', 'status', 'request-issue', 'squad', 'push', 'release'] as const;
export type ProposalPurpose = (typeof PROPOSAL_PURPOSES)[number];

export interface ReviewLine {
  /** "src/a.ts:12", or the file alone; null for the general point. */
  where: string | null;
  severity: Finding['severity'];
  body: string;
  suggestion: string | null;
  thread: FindingThread;
}

export interface ProposalView {
  purpose: ProposalPurpose;
  runId: string;
  /** The key of the comment in the run, for the ones that have one. */
  key: string | null;
  /** The title the person reads: the comment's, the pull request's, the issue's. */
  title: string;
  /** The text that will be written, as markdown: a comment, a description, an issue's text. */
  body: string | null;
  /** The comment is already on the tracker and this edits it, or deletes it. */
  edit: boolean;
  target: 'issue' | 'mr' | null;
  /** A review: the verdict it sends and the lines it carries. */
  review: { round: number; verdict: 'changes' | 'comment'; lines: ReviewLine[] } | null;
  /** The labels a write adds and removes. */
  labels: { add: string[]; remove: string[] } | null;
  /** A group of writes that stopped half way: how many already ran. */
  progress: { done: number; total: number } | null;
  /** The branch a push sends. */
  branch: string | null;
  /** The comment that stays, or goes, as it is on the tracker. */
  url: string | null;
}

// How the three hosts spell a review that asks for changes (GitHub's event, GitLab's and Bitbucket's states).
const ASKS_CHANGES = /REQUEST_CHANGES|request_changes|needs_work|NEEDS_WORK/;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function jsonOf(c: VcsCommand): Record<string, unknown> {
  if (!c.json) return {};
  try {
    const v: unknown = JSON.parse(c.json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** The labels a set of writes adds and removes, whichever host wrote them: a `labels` body, GitLab's `add_labels` and `remove_labels`, a DELETE of one label. */
export function labelsOf(commands: readonly VcsCommand[]): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const c of commands) {
    const body = jsonOf(c);
    add.push(...list(body.labels), ...list(c.fields.add_labels), ...(c.method === 'PUT' ? list(c.fields.labels) : []));
    remove.push(...list(c.fields.remove_labels));
    const gone = c.method === 'DELETE' ? /\/labels\/([^/?#]+)$/.exec(c.endpoint) : null;
    if (gone) remove.push(decodeURIComponent(gone[1]));
  }
  return { add: [...new Set(add)], remove: [...new Set(remove)] };
}

const factsOf = (commands: readonly VcsCommand[]): { title: string | null; body: string | null } => {
  for (const c of commands) {
    const j = jsonOf(c);
    const content = j.content && typeof j.content === 'object' ? text((j.content as Record<string, unknown>).raw) : null;
    const body = text(j.body) ?? text(j.description) ?? content ?? text(c.fields.body) ?? text(c.fields.description) ?? text(c.fields.note);
    const title = text(j.title) ?? text(c.fields.title);
    if (body || title) return { title, body };
  }
  return { title: null, body: null };
};

export const proposalPurpose = (a: Pick<ReleaseAction, 'kind' | 'unit'>): ProposalPurpose | null => {
  if (a.kind === 'run-push') return 'push';
  if (a.kind === 'release-git') return typeof a.unit?.runId === 'string' ? 'release' : null;
  const p = a.unit?.purpose;
  return typeof a.unit?.runId === 'string' && typeof p === 'string' && (PROPOSAL_PURPOSES as readonly string[]).includes(p) ? (p as ProposalPurpose) : null;
};

/** The proposal of the runner an action is, with what it will write; null for an action that is not one of the runner's. */
export function proposalView(a: ReleaseAction, run: Run | null): ProposalView | null {
  const purpose = proposalPurpose(a);
  if (!purpose) return null;
  const unit = a.unit ?? {};
  const key = typeof unit.key === 'string' ? unit.key : null;
  const commands = a.commands?.length ? a.commands : a.command ? [a.command] : [];
  const record = key ? (run?.comments[key] ?? null) : null;
  const facts = factsOf(commands);
  const view: ProposalView = {
    purpose,
    runId: String(unit.runId),
    key,
    title: a.summary ?? '',
    body: null,
    edit: false,
    target: null,
    review: null,
    labels: null,
    progress: a.commands && a.commands.length > 1 && (a.done ?? 0) > 0 ? { done: a.done ?? 0, total: a.commands.length } : null,
    branch: typeof unit.branch === 'string' ? unit.branch : null,
    url: record?.url ?? null,
  };
  switch (purpose) {
    case 'comment':
      return { ...view, title: record?.title || a.summary || '', body: record?.body ?? facts.body, edit: unit.edit === true, target: record?.target ?? (unit.target === 'mr' ? 'mr' : 'issue') };
    case 'undo':
      return { ...view, title: record?.title || a.summary || '', body: record?.body ?? null, edit: true, target: record?.target ?? null };
    case 'run-pr': {
      const pr = run?.comments.pr;
      return { ...view, title: pr?.title || facts.title || a.summary || '', body: pr?.body ?? facts.body, target: 'mr' };
    }
    case 'request-issue':
      return { ...view, title: facts.title ?? a.summary ?? '', body: facts.body, target: 'issue' };
    case 'priority':
    case 'status':
    case 'squad':
      return { ...view, labels: labelsOf(commands), target: 'issue' };
    case 'review': {
      const round = typeof unit.round === 'number' ? unit.round : 0;
      const view2 = run ? reviewRounds(run).find((r) => r.round.round === round) : undefined;
      return {
        ...view,
        body: record?.body ?? facts.body,
        target: 'mr',
        review: {
          round,
          verdict: commands.some((c) => ASKS_CHANGES.test(`${c.json ?? ''} ${Object.values(c.fields).join(' ')}`)) ? 'changes' : 'comment',
          lines: (view2?.findings ?? []).map(({ finding, thread }) => ({ where: finding.line === null ? finding.path : finding.endLine !== null ? `${finding.path}:${finding.line}-${finding.endLine}` : `${finding.path}:${finding.line}`, severity: finding.severity, body: finding.body, suggestion: finding.suggestion, thread })),
        },
      };
    }
    case 'push':
      return view;
    case 'release':
      return { ...view, title: a.summary ?? '' };
  }
}
