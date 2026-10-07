import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cycleText } from '../../shared/cycles/text';
import { type Identity, git, identityArgs } from '../conflictGit';
import type { RunnerIdentity } from '../../shared/config/types';

export type { Identity };

// What the runner does to a repository, all of it local: a worktree on a new branch, the app's own commits, the diff a reviewer reads, and the
// commands a repository declares. Nothing here pushes or talks to a code host.

const REF = /^[\w][\w./-]*$/;

export type WorktreeErrorCode = 'branch-exists' | 'dest-exists' | 'not-worktree';

/** A worktree that cannot be made for a reason the person can act on; the service turns it into a message. */
export class WorktreeError extends Error {
  constructor(
    readonly code: WorktreeErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'WorktreeError';
  }
}

export function checkRef(ref: string): string {
  // i18n-ignore-next-line: developer error: refs are made by the runner
  if (!REF.test(ref) || ref.includes('..') || ref.endsWith('.lock') || ref.endsWith('/') || ref.includes('//')) throw new Error(`invalid ref: ${ref}`);
  return ref;
}

const ok = async (cwd: string, args: string[]): Promise<boolean> => (await git(cwd, args, { fail: false })).code === 0;
const out = async (cwd: string, args: string[]): Promise<string> => (await git(cwd, args)).stdout.trim();

/** The branch new work is cut from: what the remote calls its default, else main or master, else whatever is checked out. */
export async function defaultBranch(clone: string): Promise<string> {
  const head = await git(clone, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { fail: false });
  if (head.code === 0 && head.stdout.trim().startsWith('origin/')) return head.stdout.trim().slice('origin/'.length);
  for (const name of ['main', 'master']) {
    if ((await ok(clone, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])) || (await ok(clone, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`]))) return name;
  }
  return (await git(clone, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { fail: false })).stdout.trim() || 'main';
}

/**
 * The open release: the highest `release/X.Y.Z` the remote has whose stable tag `vX.Y.Z` does not exist yet, or null. While a version is in beta its work lands
 * on that branch (RELEASING.md), so a run cut from the default branch would start behind it and open its pull request against the wrong branch.
 */
export async function openReleaseBranch(clone: string): Promise<string | null> {
  // A read: the release branches (pruned, so a deleted one is gone) and the version tags. A fetch that fails leaves what the clone already knows.
  await git(clone, [...SAFE, 'fetch', '--quiet', '--prune', 'origin', '+refs/heads/release/*:refs/remotes/origin/release/*', 'refs/tags/v*:refs/tags/v*'], { fail: false });
  const listed = (await git(clone, ['for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin/release/'], { fail: false })).stdout.split('\n').map((s) => s.trim());
  const versions = listed
    .map((name) => /^release\/(\d+)\.(\d+)\.(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[0], v: [Number(m[1]), Number(m[2]), Number(m[3])] }))
    .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  for (const r of versions) {
    if (!(await ok(clone, ['show-ref', '--verify', '--quiet', `refs/tags/v${r.v.join('.')}`]))) return r.name;
  }
  return null;
}

/** The branch a new run is cut from and its pull request aims at: the open release when there is one, else the repository's default branch. */
export async function workBase(clone: string): Promise<string> {
  return (await openReleaseBranch(clone)) ?? defaultBranch(clone);
}

export interface WorktreeRequest {
  clone: string;
  dest: string;
  branch: string;
  /** Branch to cut from; defaults to the repository's own. */
  base?: string;
}

export interface Worktree {
  /** The branch it was cut from. */
  base: string;
  baseRef: string;
  /** The commit the branch starts at. */
  baseSha: string;
}

/**
 * A worktree of `clone` at `dest` on a new branch. The remote's latest `base` is fetched first when there is a remote (a read); a branch or a
 * folder that already exists is refused, never reused: what is there belongs to somebody else.
 */
export async function createWorktree(w: WorktreeRequest): Promise<Worktree> {
  const branch = checkRef(w.branch);
  if ((await out(w.clone, ['rev-parse', '--is-bare-repository'])) !== 'false') throw new WorktreeError('not-worktree', w.clone);
  if (existsSync(w.dest)) throw new WorktreeError('dest-exists', w.dest);
  if (await ok(w.clone, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])) throw new WorktreeError('branch-exists', branch);
  const base = checkRef(w.base ?? (await defaultBranch(w.clone)));
  // The repository's hooks and file-system monitor are its own code: `fetch` and `worktree add` (whose checkout runs a `post-checkout` hook) run without them, like every command of the app.
  await git(w.clone, [...SAFE, 'fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`], { fail: false });
  const remote = `refs/remotes/origin/${base}`;
  const baseRef = (await ok(w.clone, ['rev-parse', '--verify', '--quiet', remote])) ? remote : (await ok(w.clone, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`])) ? `refs/heads/${base}` : 'HEAD';
  mkdirSync(dirname(w.dest), { recursive: true });
  await git(w.clone, [...SAFE, 'worktree', 'add', '--no-track', '-b', branch, w.dest, baseRef]);
  return { base, baseRef, baseSha: await out(w.dest, ['rev-parse', 'HEAD']) };
}

/**
 * The identity a repository names for itself in its own `.git/config`. Only that file is read: the person's global and system configuration (which
 * may be another job's address), the environment and what git would guess from the machine are not an identity the app commits as. Nothing is ever
 * written to a git config.
 */
export async function repoIdentity(cwd: string): Promise<Identity | null> {
  const read = async (key: string): Promise<string> => (await git(cwd, ['config', '--local', '--get', key], { fail: false })).stdout.trim();
  const name = await read('user.name');
  const email = await read('user.email');
  return name && email ? { name, email } : null;
}

/**
 * Who the app's commits for a repository are made as: the workspace's `runner.identity`, else the repository's own (`repoIdentity`). Null when neither
 * names one, and the app does not commit then: it never falls back to the global identity.
 */
export async function commitIdentity(configured: RunnerIdentity, repo: string, own: (cwd: string) => Promise<Identity | null> = repoIdentity): Promise<Identity | null> {
  const name = configured.name.trim();
  const email = configured.email.trim();
  return name && email ? { name, email } : own(repo);
}

export const headSha = async (wt: string): Promise<string | null> => ((await git(wt, ['rev-parse', '--verify', '--quiet', 'HEAD'], { fail: false })).stdout.trim() || null);

// The settings a commit of the app must not inherit from the repository: hooks (a tracked hook an agent edited would run outside the confinement),
// signing (it can prompt), and a file-system monitor (it is a program the repository names).
export const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.fsmonitor=false'];

// The dependency folders a worktree may carry as links to the clone's (dependencies.ts). A link is not a directory to git, so `node_modules/` in a .gitignore does
// not cover it: every command of the app that adds or lists changes leaves them out by name.
const DEPENDENCY_EXCLUDES = ['node_modules', '.venv'].map((n) => `:(exclude,glob)**/${n}`);

const ATTRIBUTION = /co-authored-by|generated (?:with|by)|\bclaude\b|\banthropic\b|\bai[- ](?:generated|assisted)\b/i;

// The conventional prefix a model adds out of habit ("feat(core): ", "fix: "): the repository's template says the type, and where the issue number goes.
const TYPE_PREFIX = /^(?:feat|fix|chore|docs|doc|refactor|test|tests|style|perf|build|ci|revert|wip)(?:\([^)]*\))?!?:\s*/i;
const ISSUE_REF = /\s*\(\s*[\w./-]*#\d+\s*\)|\s*[\w./-]*#\d+\b/g;
// Words that only Portuguese uses: a summary with one of them (or with an accent) was not written in English.
const PORTUGUESE = /\b(?:de|da|das|dos|para|com|uma|que|não|nao|pela|pelo|na|nas|nos|ao|aos|sem|por|ou|em|os)\b/i;

/** Whether a summary reads as English: plain ASCII, some letters, none of the words only Portuguese has. */
export const looksEnglish = (text: string): boolean => /^[\x20-\x7e]+$/.test(text) && /[a-z]{2}/i.test(text) && !PORTUGUESE.test(text);

/**
 * The first line of a commit's summary as the convention wants it: no type prefix and no issue reference (the repository's template adds both), one line,
 * lowercase first letter, no full stop, at most 72 characters. Attribution of a tool never gets through, and neither does a summary that is not English
 * (or that nothing is left of): the fallback is used then.
 */
export function commitSummary(summary: string, fallback: string): string {
  let line = summary.split('\n')[0].trim();
  for (let i = 0; i < 3 && TYPE_PREFIX.test(line); i++) line = line.replace(TYPE_PREFIX, '');
  line = line.replace(ISSUE_REF, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const use = line && !ATTRIBUTION.test(line) && looksEnglish(line) ? line : fallback;
  return (use.charAt(0).toLowerCase() + use.slice(1)).slice(0, 72).trim();
}

/** The summary a stage's commit gets when its agent wrote none. English whatever the workspace's language, like the rest of the repository's history: the stage is named in English too. */
export function commitFallback(stageLabel: string, writes: boolean): string {
  // i18n-ignore-start: the subject of a commit in the repository's history
  const name = cycleText(stageLabel, 'en').toLowerCase();
  return writes ? `apply the ${name} changes` : `add the ${name} documents`;
  // i18n-ignore-end
}

/** The message from the repository's template; `{summary}` and `{iid}` are replaced. */
export const commitMessage = (template: string, summary: string, iid: number): string => (iid > 0 ? template : template.replace(/\s*#?\{iid\}/g, '')).replace(/\{summary\}/g, summary).replace(/\{iid\}/g, String(iid));

const PR_TITLE_MAX = 120;
// An issue reference of the title the agent wrote (`#123`, `group/project#123`).
const REFERENCE = /#\d+/;

/**
 * The title of the pull request from the repository's template; `{title}` and `{iid}` are replaced. The 120-character cap applies to `{title}` alone, so the
 * number is never cut. A title that already carries an issue reference keeps it and the template adds no second one, and a run with no issue (iid 0) drops the
 * `#` and the number with it, as `commitMessage` does.
 */
export function pullRequestTitle(template: string, title: string, iid: number): string {
  const capped = title.slice(0, PR_TITLE_MAX).trim().replace(/\s+/g, ' ');
  const already = REFERENCE.test(capped);
  const withNumber = already || iid <= 0 ? template.replace(/\s*#?\{iid\}/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ') : template;
  return withNumber.replace(/\{title\}/g, capped).replace(/\{iid\}/g, String(iid)).trim();
}

/**
 * Commits everything changed in the worktree as `identity` and nothing else (`identityArgs`), with the repository's hooks, signing and file-system
 * monitor switched off for this one command. Returns the new commit, or null when there was nothing to commit.
 */
export async function commitAll(wt: string, message: string, identity: Identity): Promise<string | null> {
  await git(wt, [...SAFE, 'add', '-A', '--', '.', ...DEPENDENCY_EXCLUDES]);
  if (!(await out(wt, [...SAFE, 'status', '--porcelain', '--', '.', ...DEPENDENCY_EXCLUDES]))) return null;
  await git(wt, [...SAFE, ...identityArgs(identity), 'commit', '--no-verify', '--quiet', '-m', message]);
  return out(wt, ['rev-parse', 'HEAD']);
}

/** Whether the worktree has a change (tracked or not) outside `exclude`, the cycle folder: what a pass that writes code leaves before the app commits it. */
export async function changedOutside(wt: string, exclude: string): Promise<boolean> {
  return !!(await git(wt, [...SAFE, 'status', '--porcelain', '--', '.', `:(exclude)${exclude}`, ...DEPENDENCY_EXCLUDES], { fail: false })).stdout.trim();
}

/** What the branch changed since it was cut, outside `exclude` (the cycle folder), as a reviewer reads it: no external diff or text conversion program runs. */
export async function branchDiff(wt: string, base: string | null, exclude: string): Promise<string> {
  if (!base) return '';
  const spec = ['--', '.', `:(exclude)${exclude}`];
  return (await git(wt, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', `${base}..HEAD`, ...spec], { fail: false })).stdout;
}

export async function branchStat(wt: string, base: string | null, exclude: string): Promise<string> {
  if (!base) return '';
  return (await git(wt, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--stat', `${base}..HEAD`, '--', '.', `:(exclude)${exclude}`], { fail: false })).stdout.trim();
}

/**
 * The test and typecheck scripts the repository declares, as commands: what an agent that writes may run when the workspace names none. They are read from
 * the commit the branch was cut from when there is one, so an agent cannot make a new command name available by editing the file; what a script does is
 * still the repository's code, which is why the commands are the person's to choose (`runner.commands`).
 */
export async function declaredCommands(wt: string, base: string | null = null): Promise<string[]> {
  try {
    const raw = base ? await out(wt, ['show', `${base}:package.json`]) : readFileSync(join(wt, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const has = (name: string) => typeof pkg.scripts?.[name] === 'string';
    // i18n-ignore-next-line: the commands themselves
    return [...(has('test') ? ['npm test'] : []), ...(has('typecheck') ? ['npm run typecheck'] : [])];
  } catch {
    return [];
  }
}
