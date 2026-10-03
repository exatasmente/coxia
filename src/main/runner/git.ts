import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cycleText } from '../../shared/cycles/text';
import { git } from '../conflictGit';

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

export interface WorktreeRequest {
  clone: string;
  dest: string;
  branch: string;
  /** Branch to cut from; defaults to the repository's own. */
  base?: string;
}

export interface Worktree {
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
  await git(w.clone, ['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`], { fail: false });
  const remote = `refs/remotes/origin/${base}`;
  const baseRef = (await ok(w.clone, ['rev-parse', '--verify', '--quiet', remote])) ? remote : (await ok(w.clone, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`])) ? `refs/heads/${base}` : 'HEAD';
  mkdirSync(dirname(w.dest), { recursive: true });
  await git(w.clone, ['worktree', 'add', '--no-track', '-b', branch, w.dest, baseRef]);
  return { baseRef, baseSha: await out(w.dest, ['rev-parse', 'HEAD']) };
}

export interface Identity {
  name: string;
  email: string;
}

/** The identity a repository already has, read from its own configuration. Nothing is ever written to a git config. */
export async function repoIdentity(cwd: string): Promise<Identity | null> {
  const name = (await git(cwd, ['config', '--get', 'user.name'], { fail: false })).stdout.trim();
  const email = (await git(cwd, ['config', '--get', 'user.email'], { fail: false })).stdout.trim();
  return name && email ? { name, email } : null;
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
export const commitMessage = (template: string, summary: string, iid: number): string => template.replace(/\{summary\}/g, summary).replace(/\{iid\}/g, String(iid));

/**
 * Commits everything changed in the worktree as `identity`, with the repository's hooks, signing and file-system monitor switched off for this one
 * command. Returns the new commit, or null when there was nothing to commit.
 */
export async function commitAll(wt: string, message: string, identity: Identity): Promise<string | null> {
  await git(wt, ['add', '-A', '--', '.', ...DEPENDENCY_EXCLUDES]);
  if (!(await out(wt, ['status', '--porcelain', '--', '.', ...DEPENDENCY_EXCLUDES]))) return null;
  await git(wt, [...SAFE, '-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`, 'commit', '--no-verify', '--quiet', '-m', message]);
  return out(wt, ['rev-parse', 'HEAD']);
}

/** Whether the worktree has a change (tracked or not) outside `exclude`, the cycle folder: what a pass that writes code leaves before the app commits it. */
export async function changedOutside(wt: string, exclude: string): Promise<boolean> {
  return !!(await git(wt, ['status', '--porcelain', '--', '.', `:(exclude)${exclude}`, ...DEPENDENCY_EXCLUDES], { fail: false })).stdout.trim();
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
