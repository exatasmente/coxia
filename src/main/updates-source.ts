// Source installs: is the source tree's main ahead of the commit the installed build was made from? Read-only (rev-parse, rev-list,
// log), except for the optional `git fetch` the person turns on. Nothing here touches the working tree, the index or the branches.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { MAX_SOURCE_COMMITS, initialSourceState, type SourceCommit, type SourceError, type SourceState } from '../shared/updates';
import { stripDirty } from '../shared/update';
import { parseBehind } from './update-core';

const exec = promisify(execFile);

const GIT_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 30_000;
const HASH = /^[0-9a-f]{4,40}$/;

// No prompts, no optional index locks (a read must not make the person's own git commands wait), stable messages.
function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };
}

async function git(dir: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await exec('git', ['-C', dir, ...args], { timeout, env: gitEnv(), maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

const firstLine = (e: unknown): string => ((e as Error).message ?? String(e)).split('\n').filter(Boolean).pop() ?? '';

// `git log --format=%h%x1f%cI%x1f%s`
export const COMMIT_FORMAT = '--format=%h%x1f%cI%x1f%s';

export function parseCommitLog(out: string): SourceCommit[] {
  const commits: SourceCommit[] = [];
  for (const line of out.split('\n')) {
    const [commit, date, ...subject] = line.split('\x1f');
    if (!commit || !HASH.test(commit) || !date) continue;
    commits.push({ commit, date, subject: subject.join('\x1f') });
  }
  return commits;
}

const fail = (state: SourceState, error: SourceError, detail: string | null = null): SourceState => ({ ...state, error, errorDetail: detail });

export interface SourceOptions {
  /** Run `git fetch origin main` first; a failure is reported but does not stop the comparison. */
  fetch: boolean;
  now?: () => number;
}

/**
 * Compares the installed build with the source tree's `main`. `installed` is the build stamp (`abc1234` or `abc1234+dirty`);
 * a dev build (`dev`) or a stamp that is not a commit has nothing to compare.
 */
export async function readSourceState(dir: string | null, installed: string, options: SourceOptions): Promise<SourceState> {
  const now = options.now ?? Date.now;
  let state: SourceState = { ...initialSourceState(dir), checkedAt: now() };
  if (!dir || !existsSync(dir)) return fail(state, 'no-dir');
  try {
    await git(dir, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return fail(state, 'not-a-repo');
  }

  if (options.fetch) {
    try {
      await git(dir, ['fetch', '--quiet', '--no-tags', 'origin', 'main'], FETCH_TIMEOUT_MS);
      state = { ...state, fetched: true };
    } catch (e) {
      state = { ...state, fetchError: firstLine(e) };
    }
  }

  try {
    state = { ...state, head: (await git(dir, ['rev-parse', '--verify', '--quiet', '--short', 'refs/heads/main^{commit}'])).trim() || null };
  } catch {
    return fail(state, 'no-main');
  }

  // The remote is informative only: the build comes from the local tree, and updating that tree is the person's decision.
  try {
    const remote = parseBehind(await git(dir, ['rev-list', '--count', 'refs/heads/main..refs/remotes/origin/main']));
    state = { ...state, remoteAhead: remote };
  } catch {
    // no origin/main: nothing to say
  }

  const commit = stripDirty(installed);
  if (!HASH.test(commit)) return fail(state, 'commit-unknown', installed);
  state = { ...state, installed: commit };
  try {
    await git(dir, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]);
  } catch {
    return fail(state, 'commit-unknown', commit);
  }
  try {
    const ahead = parseBehind(await git(dir, ['rev-list', '--count', `${commit}..refs/heads/main`]));
    if (ahead === null) return fail(state, 'git-failed');
    const log = ahead > 0 ? await git(dir, ['log', `--max-count=${MAX_SOURCE_COMMITS}`, COMMIT_FORMAT, `${commit}..refs/heads/main`]) : '';
    return { ...state, ahead, commits: parseCommitLog(log) };
  } catch (e) {
    return fail(state, 'git-failed', firstLine(e));
  }
}
