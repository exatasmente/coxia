import { VcsError } from './errors';
import type { VcsProvider } from './types';
import { checkIid } from './util';

// The app tool the agents read the code host with when they have no CLI (Bitbucket, or an integration that uses the API only).
// It is read-only by construction: it calls the provider's read methods and nothing else, with a fixed list of operations.

export const VCS_READ_OPS = ['issue', 'issue_comments', 'issue_linked_mrs', 'mr', 'mr_threads', 'mr_comments', 'mr_changes', 'mr_ci'] as const;
export type VcsReadOp = (typeof VCS_READ_OPS)[number];

export const VCS_READ_DESCRIPTION =
  // i18n-ignore: tool description for the model: English by design
  'Reads from the code host (read only): an issue (with its labels and milestone), the comments of an issue, the merge or pull requests linked to an issue, a merge or pull request, its review threads, its comments, ' +
  // i18n-ignore: tool description for the model: English by design
  'its changed files with diffs, or its CI runs. `project` is "group/repo" (as in mrPaths); `iid` is the issue or MR number.';

export const VCS_READ_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore: tool description for the model: English by design
    op: { type: 'string', enum: [...VCS_READ_OPS], description: 'What to read' },
    project: { type: 'string', description: 'group/repo (owner/repo, workspace/repo)' },
    // i18n-ignore: tool description for the model: English by design
    iid: { type: 'integer', description: 'Issue or MR number' },
  },
  required: ['op', 'project', 'iid'],
} as const;

const BODY_MAX = 4000;
const DIFF_MAX = 6000;
const OUT_MAX = 30_000;

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text);

function parse(input: unknown): { op: VcsReadOp; project: string; iid: number } {
  const i = (input ?? {}) as Record<string, unknown>;
  const op = VCS_READ_OPS.find((o) => o === i.op);
  // i18n-ignore: tool description for the model: English by design
  if (!op || typeof i.project !== 'string' || typeof i.iid !== 'number') throw new VcsError('invalid', { detail: 'op, project, iid' });
  return { op, project: i.project, iid: checkIid(i.iid) };
}

/**
 * Whether `project` is one the workspace works with: its issue project or the project of one of its repositories, the same identity the cards use. An empty list is the
 * workspace that names none (its cards are every project the host lists for the person), so it names no limit either.
 */
export function projectAllowed(project: string, allowed: readonly string[]): boolean {
  return !allowed.length || allowed.some((p) => p.toLowerCase() === project.toLowerCase());
}

/** Runs one read and returns text for the model. Throws a translated VcsError for a bad input, a project outside the workspace or a failing host. */
export async function runVcsRead(provider: VcsProvider, input: unknown, allowed: readonly string[] = []): Promise<string> {
  const { op, project, iid } = parse(input);
  // i18n-ignore: tool answer for the model: English by design
  if (!projectAllowed(project, allowed)) throw new VcsError('invalid', { detail: `project "${project.slice(0, 120)}" is not one of this workspace's projects (${allowed.join(', ')})` });
  const comments = (list: { author: string; createdAt: string; body: string }[]) => list.map((c) => ({ author: c.author, at: c.createdAt, body: cut(c.body, BODY_MAX) }));
  let result: unknown;
  switch (op) {
    case 'issue': {
      const i = await provider.getIssue(project, iid);
      result = { ...i, webUrl: i.webUrl };
      break;
    }
    case 'issue_comments':
      result = comments((await provider.listIssueComments(project, iid)).filter((c) => !c.system).slice(0, 40));
      break;
    case 'issue_linked_mrs':
      result = (await provider.linkedMrs(project, iid)).slice(0, 20).map((m) => ({ ...m, description: cut(m.description, 400) }));
      break;
    case 'mr': {
      const m = await provider.getMr(project, iid, { approvals: true });
      result = { ...m, description: cut(m.description, BODY_MAX) };
      break;
    }
    case 'mr_threads':
      result = (await provider.listMrThreads(project, iid)).slice(0, 40).map((th) => ({ id: th.id, resolved: th.resolved, path: th.path, line: th.line, notes: comments(th.notes.filter((n) => !n.system)) }));
      break;
    case 'mr_comments':
      result = comments((await provider.listMrComments(project, iid)).filter((c) => !c.system).slice(0, 40));
      break;
    case 'mr_changes':
      result = (await provider.listMrChanges(project, iid)).slice(0, 60).map((f) => ({ path: f.path, diff: cut(f.diff, DIFF_MAX) }));
      break;
    case 'mr_ci':
      result = await provider.listMrCi(project, iid);
      break;
  }
  return cut(JSON.stringify(result, null, 1), OUT_MAX);
}
