import { lstatSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { WorkspaceConfig } from '../../shared/config/types';
import { runThreadId } from '../../shared/forum';
import type { Run } from '../../shared/runs';
import { git } from '../conflictGit';
import type { ForumStore } from '../forum-core';

// A run's worktree is a fresh checkout: it has no `node_modules` or `.venv`, so the commands the app runs there ("vitest: not found") and the tests a developer
// agent is allowed to run cannot work. The person's own clone usually has them installed, so the worktree gets a symbolic link to each of those folders.
// The link is made only where the repository's .gitignore ignores the folder (the app never commits it, see `DEPENDENCY_EXCLUDES` in git.ts), never over
// something that is already there, and only into a folder of the worktree that is a real directory. An agent still cannot write through it: the worktree
// guard refuses a path that leaves the worktree by a link. The commands the app runs use the clone's dependencies, which is the point.

/** The folder names that hold installed dependencies. */
export const DEPENDENCY_NAMES = ['node_modules', '.venv'] as const;
// Folders whose children are packages of a workspace (`packages/*/node_modules`).
const WORKSPACE_DIRS = ['packages', 'apps', 'libs', 'services'];
/** The most links one worktree gets. */
export const MAX_LINKS = 30;

/** The clone a worktree belongs to, from the git directory it shares; null for a bare one or when git cannot say. */
export async function cloneOf(wt: string): Promise<string | null> {
  const common = (await git(wt, ['rev-parse', '--git-common-dir'], { fail: false })).stdout.trim();
  if (!common) return null;
  const dir = resolve(wt, common);
  return basename(dir) === '.git' ? dirname(dir) : null;
}

const kind = (path: string): 'dir' | 'link' | 'file' | null => {
  try {
    const s = lstatSync(path);
    return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : 'file';
  } catch {
    return null;
  }
};

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const realDirs = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !(DEPENDENCY_NAMES as readonly string[]).includes(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
};

/** The dependency folders the clone has, as paths relative to it: the root ones, one level down (`sidecar/.venv`) and under the workspace folders (`packages/*`). */
export function dependencyFolders(clone: string): string[] {
  const found: string[] = [];
  const consider = (dir: string): void => {
    for (const name of DEPENDENCY_NAMES) {
      const rel = dir ? `${dir}/${name}` : name;
      if (isDir(join(clone, rel))) found.push(rel);
    }
  };
  consider('');
  for (const top of realDirs(clone)) {
    consider(top);
    if (WORKSPACE_DIRS.includes(top)) for (const child of realDirs(join(clone, top))) consider(`${top}/${child}`);
  }
  return found.slice(0, MAX_LINKS);
}

export interface Linked {
  /** What was linked now, relative to the worktree. */
  linked: string[];
  /** The clone has no dependency folder and the worktree has none of its own: nothing the commands need is there. */
  none: boolean;
}

/** Links the dependency folders of `clone` that `wt` lacks. Never replaces anything, never writes through a link, and skips what the repository does not ignore. */
export async function linkDependencies(clone: string, wt: string): Promise<Linked> {
  const have = dependencyFolders(clone);
  const linked: string[] = [];
  for (const rel of have) {
    const here = join(wt, rel);
    if (kind(here) !== null) continue;
    const parent = dirname(rel) === '.' ? wt : join(wt, dirname(rel));
    if (kind(parent) !== 'dir') continue;
    // The folder form, because a link is not a directory to git: the pattern `node_modules/` ignores the folder and not a link made in its place.
    if ((await git(wt, ['check-ignore', '-q', '--', `${rel}/`], { fail: false })).code !== 0) continue;
    try {
      symlinkSync(join(clone, rel), here, 'dir');
      linked.push(rel);
    } catch {
      // a folder that cannot be linked is left as the worktree has it
    }
  }
  const own = DEPENDENCY_NAMES.some((n) => kind(join(wt, n)) !== null);
  return { linked, none: !have.length && !own };
}

export interface DependencyDeps {
  config(): WorkspaceConfig;
  forum: ForumStore;
}

/**
 * Before a stage that runs commands: links the clone's dependencies when the worktree lacks them and says so once in the run's thread (which folders, or
 * that the clone has none, so QA may not be able to run the tests). Silent when everything is there already; never fails a stage.
 */
export async function ensureDependencies(d: DependencyDeps, run: Run, stage: string | null, clone?: string | null): Promise<void> {
  if (d.config().runner.linkDependencies === false) return;
  try {
    const from = clone ?? (await cloneOf(run.worktree));
    if (!from) return;
    const result = await linkDependencies(from, run.worktree);
    const threadId = runThreadId(run.id);
    if (result.linked.length) {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.deps.linked', params: { list: result.linked.join(', ') }, stage });
    } else if (result.none && !(d.forum.read(threadId, 0, 2000)?.messages ?? []).some((m) => m.code === 'runner.deps.none')) {
      d.forum.append(threadId, { kind: 'system', author: { type: 'app' }, code: 'runner.deps.none', stage });
    }
  } catch (e) {
    console.error('[runner] dependencies', run.id, e instanceof Error ? e.message : e);
  }
}
