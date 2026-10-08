// The branch a run is cut from: the open release while a version is in beta (its work lands there, RELEASING.md), else the default branch. A run cut from the
// default branch during a beta started tens of commits behind the release and would have opened its pull request against main. Real repositories in a
// scratch folder: a bare origin and a clone, no network.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree, openReleaseBranch, workBase } from '../src/main/runner/git';

let dir: string;
const env = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const ID = ['-c', 'user.name=Runner Test', '-c', 'user.email=runner@example.test', '-c', 'commit.gpgsign=false'];

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [...ID, ...args], { cwd, env: env(), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A commit on the seed's current branch, pushed to `branch` of the origin. */
function commitTo(branch: string, file: string): string {
  const seed = join(dir, 'seed');
  writeFileSync(join(seed, file), file);
  git(seed, 'add', file);
  git(seed, 'commit', '-q', '-m', `feat: add ${file}`);
  git(seed, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  return git(seed, 'rev-parse', 'HEAD');
}

const tag = (name: string): void => {
  const seed = join(dir, 'seed');
  git(seed, 'tag', name);
  git(seed, 'push', '-q', 'origin', `refs/tags/${name}`);
};

let clone: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-base-'));
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(dir, 'init', '-q', '-b', 'main', 'seed');
  git(join(dir, 'seed'), 'remote', 'add', 'origin', join(dir, 'origin.git'));
  commitTo('main', 'a.txt');
  git(dir, 'clone', '-q', join(dir, 'origin.git'), 'clone');
  clone = join(dir, 'clone');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the branch a run is cut from', () => {
  it('is the default branch when no release is open', async () => {
    expect(await openReleaseBranch(clone)).toBeNull();
    expect(await workBase(clone)).toBe('main');
  });

  it('is the open release, the highest by version, even when the clone was made before it existed', async () => {
    commitTo('release/0.7.0', 'b.txt');
    tag('v0.7.0');
    commitTo('release/0.9.0', 'c.txt');
    const tip = commitTo('release/0.10.0', 'd.txt');
    expect(await openReleaseBranch(clone)).toBe('release/0.10.0');
    const made = await createWorktree({ clone, dest: join(dir, 'wt'), branch: 'cycle/1-x', base: await workBase(clone) });
    expect(made.base).toBe('release/0.10.0');
    expect(made.baseSha).toBe(tip);
  });

  it('leaves out a release whose stable tag exists, and one the remote deleted', async () => {
    commitTo('release/0.8.0', 'b.txt');
    expect(await openReleaseBranch(clone)).toBe('release/0.8.0');
    tag('v0.8.0');
    expect(await openReleaseBranch(clone)).toBeNull();
    commitTo('release/0.9.0', 'c.txt');
    expect(await openReleaseBranch(clone)).toBe('release/0.9.0');
    git(join(dir, 'seed'), 'push', '-q', 'origin', '--delete', 'release/0.9.0');
    expect(await workBase(clone)).toBe('main');
  });
});

describe('the worktree a run is made in', () => {
  const dest = (): string => join(dir, 'wt');

  it('is made on a new branch, cut from the base', async () => {
    const made = await createWorktree({ clone, dest: dest(), branch: 'cycle/1-x' });
    expect(made.base).toBe('main');
    expect(git(dest(), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('cycle/1-x');
  });

  it('refuses a folder that is somebody else\'s, and a branch that already exists', async () => {
    mkdirSync(dest());
    writeFileSync(join(dest(), 'mine.txt'), 'x');
    await expect(createWorktree({ clone, dest: dest(), branch: 'cycle/1-x' })).rejects.toMatchObject({ code: 'dest-exists' });
    rmSync(dest(), { recursive: true, force: true });
    git(clone, 'branch', 'cycle/1-x');
    await expect(createWorktree({ clone, dest: dest(), branch: 'cycle/1-x' })).rejects.toMatchObject({ code: 'branch-exists' });
  });

  it('takes over the worktree and the branch a run of the same issue left behind, so a run that ended without cleaning up does not block the next one', async () => {
    // what a run that ended without cleaning up leaves: its worktree, on its own branch, clean
    git(clone, 'worktree', 'add', '-q', '-b', 'cycle/1-x', dest(), 'main');
    const made = await createWorktree({ clone, dest: dest(), branch: 'cycle/1-x', takeOverLeftover: true });
    expect(made.base).toBe('main');
    expect(git(dest(), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('cycle/1-x');
    // the leftover was taken over, not left registered twice
    const listed = git(clone, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
    expect(listed.filter((l) => l.slice('worktree '.length) === dest())).toHaveLength(1);
  });

  it('leaves the leftover alone when the run did not ask for it, as a documentation run does not', async () => {
    git(clone, 'worktree', 'add', '-q', '-b', 'cycle/1-x', dest(), 'main');
    await expect(createWorktree({ clone, dest: dest(), branch: 'cycle/1-x' })).rejects.toMatchObject({ code: 'dest-exists' });
    expect(git(dest(), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('cycle/1-x');
  });

  it('does not take over a leftover worktree of its own that holds another branch or has changes', async () => {
    git(clone, 'branch', 'somebody');
    git(clone, 'worktree', 'add', '-q', dest(), 'somebody');
    await expect(createWorktree({ clone, dest: dest(), branch: 'cycle/1-x', takeOverLeftover: true })).rejects.toMatchObject({ code: 'dest-exists' });
    git(clone, 'worktree', 'remove', '--force', dest());
    git(clone, 'worktree', 'add', '-q', '-b', 'cycle/1-x', dest(), 'main');
    writeFileSync(join(dest(), 'uncommitted.txt'), 'x');
    await expect(createWorktree({ clone, dest: dest(), branch: 'cycle/1-x', takeOverLeftover: true })).rejects.toMatchObject({ code: 'dest-exists' });
  });

  it('does not delete a branch the remote has, even when the leftover worktree held it', async () => {
    git(clone, 'worktree', 'add', '-q', '-b', 'cycle/1-x', dest(), 'main');
    git(clone, 'push', '-q', 'origin', 'cycle/1-x');
    await expect(createWorktree({ clone, dest: dest(), branch: 'cycle/1-x', takeOverLeftover: true })).rejects.toMatchObject({ code: 'branch-exists' });
    expect(git(clone, 'rev-parse', '--verify', 'refs/heads/cycle/1-x')).toBeTruthy();
  });
});
