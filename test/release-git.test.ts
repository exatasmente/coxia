import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ReleasePr, latestBetaTag, previewRelease, releaseCommandLine, runReleaseOp } from '../src/main/releaseGit';
import { setLanguage } from '../src/shared/i18n';
import { type ReleaseUnit } from '../src/shared/release';
import { AUTHOR, ReleaseWorld, cleanWorlds } from './helpers/releaseWorld';

// The release operations against real temporary repositories: the repository's own scripts/release.sh runs (behind a wrapper that records its arguments), the host is a
// function a test gives, and nothing leaves the machine except into a bare repository on disk. The steps run in a worktree of their own (`w.steps`); the person's
// checkout (`w`) is only where it is made from, and no step touches it.

// Hermetic git: nothing of the machine's own configuration reaches the repositories of a test.
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  setLanguage('en');
});
afterAll(() => {
  setLanguage('pt-BR');
  cleanWorlds();
});

const unit = (over: Partial<ReleaseUnit> & Pick<ReleaseUnit, 'op'>): ReleaseUnit => ({ version: '0.5.0', ...over });
const open = (w: ReleaseWorld, pr?: (n: number) => Promise<ReleasePr>) => (u: ReleaseUnit) => runReleaseOp(u, { clone: w.dir, worktree: w.stepsDir, identity: AUTHOR, env: w.scriptEnv(), pr });
const green = (over: Partial<ReleasePr> = {}): ReleasePr => ({ state: 'open', draft: false, sourceBranch: 'feat/x', targetBranch: 'release/0.5.0', sha: '', approved: true, checks: 'success', fork: false, ...over });
const AS = `${AUTHOR.name} <${AUTHOR.email}>`;

/** A world with release/0.5.0 open (in the worktree of the steps) and pushed. */
async function opened(): Promise<{ w: ReleaseWorld; run: (u: ReleaseUnit) => ReturnType<ReturnType<typeof open>> }> {
  const w = new ReleaseWorld();
  const run = open(w);
  await run(unit({ op: 'open' }));
  w.steps.git('push', '-q', '-u', 'origin', 'release/0.5.0');
  return { w, run };
}

describe('the worktree of the steps', () => {
  it('is made from the clone on first use, detached at what the remote has of main, and never holds a branch the person\'s checkout has', async () => {
    const w = new ReleaseWorld();
    expect(existsSync(w.stepsDir)).toBe(false);
    w.advanceMain();
    await open(w)(unit({ op: 'open' }));
    expect(w.git('worktree', 'list', '--porcelain')).toContain(w.stepsDir);
    expect(w.steps.branch).toBe('release/0.5.0');
    // the new branch was cut from origin/main, which this clone had not fetched before the first step, while the person's main is a commit behind it
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(w.remote('rev-parse', 'main'));
    expect(w.git('rev-parse', 'main')).not.toBe(w.remote('rev-parse', 'main'));
  });

  it('is reused by the next step, and a folder that is somebody else\'s is not run in', async () => {
    const { w, run } = await opened();
    await run(unit({ op: 'push-branch' }));
    expect(w.git('worktree', 'list', '--porcelain').split(w.stepsDir).length).toBe(2);
    const other = new ReleaseWorld();
    mkdirSync(other.stepsDir);
    writeFileSync(join(other.stepsDir, 'mine.txt'), 'x');
    await expect(open(other)(unit({ op: 'open' }))).rejects.toThrow(/is not the worktree of this release/);
    const alien = new ReleaseWorld();
    // a worktree of another repository at the path is refused too
    alien.git('worktree', 'add', '--detach', join(w.root, 'alien'), 'main');
    await expect(runReleaseOp(unit({ op: 'push-branch' }), { clone: w.dir, worktree: join(w.root, 'alien'), identity: AUTHOR, env: w.scriptEnv() })).rejects.toThrow(/is not the worktree of this release/);
  });

  it('links the dependencies of the clone into it and keeps the links out of the status the script reads, so the checks can run and the tree is clean', async () => {
    const w = new ReleaseWorld();
    mkdirSync(join(w.dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(w.dir, 'node_modules', 'pkg', 'index.js'), 'x');
    await open(w)(unit({ op: 'open' }));
    expect(existsSync(join(w.stepsDir, 'node_modules', 'pkg', 'index.js'))).toBe(true);
    expect(w.steps.git('status', '--porcelain')).toContain('node_modules');
    // the script itself saw a clean tree (it refuses a dirty one) because its git reads the excludes file too
    w.steps.change('Added', 'a thing');
    await expect(open(w)(unit({ op: 'beta' }))).resolves.toMatchObject({ tag: 'v0.5.0-beta.1' });
  });
});

describe('open', () => {
  it('cuts release/X.Y.Z from main with the script in the worktree, and passes it nothing but the version, the author and --worktree', async () => {
    const w = new ReleaseWorld();
    const main = w.git('rev-parse', 'main');
    const r = await open(w)(unit({ op: 'open' }));
    expect(w.steps.branch).toBe('release/0.5.0');
    expect(r.after).toBe(main);
    expect(w.argv()).toEqual([['open', '0.5.0', '--author', AS, '--worktree']]);
    // nothing was pushed, and the person's checkout is where it was
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
    expect(w.branch).toBe('main');
  });

  it('cuts a patch from the stable tag with --from', async () => {
    const w = new ReleaseWorld();
    await open(w)(unit({ op: 'open', version: '0.4.1', from: 'v0.4.0' }));
    expect(w.steps.branch).toBe('release/0.4.1');
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(w.git('rev-parse', 'v0.4.0^{commit}'));
    expect(w.argv()[0]).toEqual(['open', '0.4.1', '--from', 'v0.4.0', '--author', AS, '--worktree']);
  });

  it('surfaces the refusal of the script, and does nothing else, when the branch exists', async () => {
    const w = new ReleaseWorld();
    w.git('branch', 'release/0.5.0');
    await expect(open(w)(unit({ op: 'open' }))).rejects.toThrow(/release\/0\.5\.0 already exists/);
    expect(w.branch).toBe('main');
  });

  it('does not mind what the person has in their checkout, and leaves it exactly as it was', async () => {
    const w = new ReleaseWorld();
    writeFileSync(join(w.dir, 'dirty.txt'), 'x');
    const before = w.snapshot();
    await open(w)(unit({ op: 'open' }));
    expect(w.snapshot()).toBe(before);
    expect(w.steps.git('status', '--porcelain')).toBe('');
  });

  it('refuses a worktree with changes that are not committed before it runs the script', async () => {
    const { w, run } = await opened();
    writeFileSync(join(w.stepsDir, 'dirty.txt'), 'x');
    const calls = w.argv().length;
    await expect(run(unit({ op: 'beta' }))).rejects.toThrow(/not committed/);
    expect(w.argv()).toHaveLength(calls);
  });

  it('refuses a folder that is not a working checkout', async () => {
    const w = new ReleaseWorld();
    await expect(runReleaseOp(unit({ op: 'open' }), { clone: w.origin, worktree: w.stepsDir, identity: AUTHOR, env: w.scriptEnv() })).rejects.toThrow(/not a working checkout/);
  });
});

describe('merge-pr', () => {
  it('merges the pull request head into the release branch with --no-ff and the identity it was given, after reading it from the remote', async () => {
    const { w, run } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    expect(w.gitOk('cat-file', '-e', head)).toBe(false);
    const asked: number[] = [];
    const r = await open(w, async (n) => {
      asked.push(n);
      return green({ sha: head });
    })(unit({ op: 'merge-pr', pr: 7, head }));
    void run;
    expect(asked).toEqual([7]);
    expect(w.steps.branch).toBe('release/0.5.0');
    expect(w.steps.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
    expect(w.steps.git('log', '-1', '--format=%s')).toBe('Merge pull request #7 from feat/x');
    expect(w.steps.git('log', '-1', '--format=%an <%ae>')).toBe(AS);
    expect(w.steps.git('log', '-1', '--format=%cn <%ce>')).toBe(AS);
    expect(r.after).toBe(w.steps.git('rev-parse', 'HEAD'));
    expect(r.before).not.toBe(r.after);
    // the host's merge button is never used and nothing is pushed
    expect(w.remote('rev-parse', 'release/0.5.0')).not.toBe(r.after);
    // the repository's own configuration was not written
    expect(w.gitOk('config', '--local', '--get', 'user.name')).toBe(false);
  });

  it.each([
    ['a pull request that is not open', { state: 'merged' as const }, /is merged, not open/],
    ['a draft', { draft: true }, /still a draft/],
    ['one that is not approved', { approved: false }, /not approved/],
    ['one whose checks fail', { checks: 'failing' as const }, /checks .* are failing/],
    ['one whose checks are still running', { checks: 'running' as const }, /are running/],
    ['one aimed at another branch', { targetBranch: 'main' }, /aimed at main, not at release\/0\.5\.0/],
    ['one from a fork (or one the host did not say is not)', { fork: true }, /comes from a fork/],
  ])('refuses %s, and merges nothing', async (_name, over, message) => {
    const { w } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const before = w.steps.git('rev-parse', 'HEAD');
    await expect(open(w, async () => green({ sha: head, ...over }))(unit({ op: 'merge-pr', pr: 7, head }))).rejects.toThrow(message);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
    expect(w.steps.git('status', '--porcelain')).toBe('');
  });

  it('refuses a pull request whose head moved since the plan read it, whether the host says so or the fetch does', async () => {
    const { w } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const before = w.steps.git('rev-parse', 'HEAD');
    await expect(open(w, async () => green({ sha: head }))(unit({ op: 'merge-pr', pr: 7, head: 'a'.repeat(40) }))).rejects.toThrow(/plan read it/);
    await expect(open(w, async () => green({ sha: 'b'.repeat(40) }))(unit({ op: 'merge-pr', pr: 7 }))).rejects.toThrow(/plan read it/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
  });

  it('is a no-op for a pull request that is already in the branch', async () => {
    const { w } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const merge = open(w, async () => green({ sha: head }));
    await merge(unit({ op: 'merge-pr', pr: 7, head }));
    const after = w.steps.git('rev-parse', 'HEAD');
    const again = await merge(unit({ op: 'merge-pr', pr: 7, head }));
    expect(again.output).toMatch(/already in release\/0\.5\.0/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(after);
  });

  it('undoes a merge that conflicts and leaves the tree clean', async () => {
    const { w } = await opened();
    writeFileSync(join(w.stepsDir, 'shared.txt'), 'ours\n');
    w.steps.git('add', '-A');
    w.steps.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'ours');
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'main', 'shared.txt', 'theirs\n');
    const before = w.steps.git('rev-parse', 'HEAD');
    await expect(open(w, async () => green({ sha: head }))(unit({ op: 'merge-pr', pr: 7, head }))).rejects.toThrow(/conflicts, and the merge was undone/);
    expect(w.steps.git('rev-parse', 'HEAD')).toBe(before);
    expect(w.steps.git('status', '--porcelain')).toBe('');
    expect(w.steps.gitOk('rev-parse', '-q', '--verify', 'MERGE_HEAD')).toBe(false);
  });

  it('refuses when the code host cannot be read, and when the release branch does not exist', async () => {
    const { w } = await opened();
    await expect(open(w)(unit({ op: 'merge-pr', pr: 7, head: 'a'.repeat(40) }))).rejects.toThrow(/cannot be read right now/);
    const bare = new ReleaseWorld();
    await expect(open(bare, async () => green())(unit({ op: 'merge-pr', pr: 7 }))).rejects.toThrow(/branch release\/0\.5\.0 does not exist/);
  });
});

describe('beta', () => {
  it('cuts the next beta on the release branch with the script and the identity, and never with --emergency or --allow-branch', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    const r = await run(unit({ op: 'beta' }));
    expect(r.tag).toBe('v0.5.0-beta.1');
    expect(w.steps.version).toBe('0.5.0-beta.1');
    expect(w.git('cat-file', '-t', 'refs/tags/v0.5.0-beta.1')).toBe('tag');
    expect(w.steps.git('log', '-1', '--format=%an <%ae>')).toBe(AS);
    w.steps.change('Fixed', 'a fix after the beta');
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    const second = await run(unit({ op: 'beta' }));
    expect(second.tag).toBe('v0.5.0-beta.2');
    expect(w.argv().filter((a) => a[0] === 'beta')).toEqual([['beta', '--author', AS], ['beta', '--author', AS]]);
    expect(w.argv().flat()).not.toContain('--emergency');
    expect(w.argv().flat()).not.toContain('--allow-branch');
    expect(w.argv().flat()).not.toContain('--skip-checks');
    expect(w.remote('tag', '--list')).not.toContain('beta');
  });

  it('says so when the release branch does not exist', async () => {
    const { run } = await opened();
    await expect(run(unit({ op: 'beta', version: '0.9.0' }))).rejects.toThrow(/branch release\/0\.9\.0 does not exist/);
  });
});

describe('stable', () => {
  async function betaCut(): Promise<{ w: ReleaseWorld; run: (u: ReleaseUnit) => ReturnType<ReturnType<typeof open>> }> {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    await run(unit({ op: 'beta' }));
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    w.steps.git('push', '-q', 'origin', 'v0.5.0-beta.1');
    return { w, run };
  }

  it('merges the release branch into what stands for main (a fast-forward here) on a detached HEAD, and cuts the stable on that commit, folding the beta', async () => {
    const { w, run } = await betaCut();
    const mainBefore = w.git('rev-parse', 'main');
    const r = await run(unit({ op: 'stable' }));
    // no branch is checked out twice: the worktree is detached, the person's checkout and its main are where they were
    expect(w.steps.branch).toBe('HEAD');
    expect(w.git('rev-parse', 'main')).toBe(mainBefore);
    expect(w.branch).toBe('main');
    expect(r.tag).toBe('v0.5.0');
    expect(w.steps.version).toBe('0.5.0');
    expect(w.git('cat-file', '-t', 'refs/tags/v0.5.0')).toBe('tag');
    expect(w.git('rev-parse', 'v0.5.0^{commit}')).toBe(w.steps.git('rev-parse', 'HEAD'));
    expect(w.steps.gitOk('merge-base', '--is-ancestor', 'v0.5.0-beta.1', 'HEAD')).toBe(true);
    expect(w.argv().filter((a) => a[0] === 'stable')).toEqual([['stable', '--author', AS, '--worktree']]);
    expect(w.argv().flat()).not.toContain('--emergency');
    // nothing was pushed
    expect(w.remote('rev-parse', 'main')).not.toBe(w.steps.git('rev-parse', 'HEAD'));
  });

  it('makes a merge commit with the identity when main has moved, and starts from what the remote has, not from the local main', async () => {
    const { w, run } = await betaCut();
    // the person has a commit of their own on main that was never pushed; somebody else pushed one
    writeFileSync(join(w.dir, 'mine.txt'), 'unpushed\n');
    w.git('add', '-A');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'mine');
    const mine = w.git('rev-parse', 'main');
    const theirs = w.advanceMain();
    await run(unit({ op: 'stable' }));
    expect(w.steps.git('log', '--merges', '-1', '--format=%s %an <%ae>')).toBe(`Merge release/0.5.0 ${AS}`);
    expect(w.steps.gitOk('merge-base', '--is-ancestor', theirs, 'HEAD')).toBe(true);
    expect(w.steps.gitOk('merge-base', '--is-ancestor', mine, 'HEAD')).toBe(false);
    expect(w.git('tag', '--list', 'v0.5.0')).toBe('v0.5.0');
    expect(w.git('rev-parse', 'main')).toBe(mine);
  });

  it('is refused by the script without a beta, and --emergency is not how it goes on', async () => {
    const { w, run } = await opened();
    await expect(run(unit({ op: 'stable' }))).rejects.toThrow(/refusing the stable|already a stable version/);
    expect(w.argv().flat()).not.toContain('--emergency');
    expect(w.git('tag', '--list', 'v0.5.0')).toBe('');
  });
});

describe('a release branch that only the remote has, or that the person has checked out', () => {
  it('is made local, tracking it, for a merge and for a beta, as `git switch` would', async () => {
    const { w, run } = await opened();
    w.steps.git('switch', '-q', '--detach', 'origin/main');
    w.steps.git('branch', '-D', 'release/0.5.0');
    expect(w.gitOk('show-ref', '--verify', '--quiet', 'refs/heads/release/0.5.0')).toBe(false);
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    await open(w, async () => green({ sha: head }))(unit({ op: 'merge-pr', pr: 7, head }));
    expect(w.steps.branch).toBe('release/0.5.0');
    expect(w.steps.git('rev-parse', '--abbrev-ref', 'release/0.5.0@{upstream}')).toBe('origin/release/0.5.0');
    w.steps.git('switch', '-q', '--detach', 'origin/main');
    w.steps.git('branch', '-D', 'release/0.5.0');
    const cut = await run(unit({ op: 'beta' }));
    expect(cut.tag).toBe('v0.5.0-beta.1');
  });

  it('is not taken from the person: a branch their checkout has is never checked out twice, and their checkout is left alone', async () => {
    const w = new ReleaseWorld();
    w.git('switch', '-q', '-c', 'release/0.5.0');
    w.git('push', '-q', '-u', 'origin', 'release/0.5.0');
    const before = w.snapshot();
    await expect(open(w, async () => green())(unit({ op: 'merge-pr', pr: 7 }))).rejects.toThrow(/checked out in .*and a branch cannot be checked out twice/);
    await expect(open(w)(unit({ op: 'beta' }))).rejects.toThrow(/checked out in/);
    expect(w.snapshot()).toBe(before);
    expect(w.branch).toBe('release/0.5.0');
  });
});

describe('push-branch and push-tag', () => {
  it('push the release branch plainly, and refuse what the remote would not take as a fast-forward (never a force)', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing');
    const sent = await run(unit({ op: 'push-branch' }));
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(w.steps.git('rev-parse', 'HEAD'));
    expect(sent.tag).toBeNull();
    w.pushedBranch('release/0.5.0', 'release/0.5.0', 'theirs.txt');
    const theirs = w.remote('rev-parse', 'release/0.5.0');
    w.steps.change('Added', 'a diverging thing');
    await expect(run(unit({ op: 'push-branch' }))).rejects.toThrow();
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(theirs);
  });

  it('push the tag only after its branch is on the remote, as an annotated tag, plainly', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    const cut = await run(unit({ op: 'beta' }));
    expect(cut.tag).toBe('v0.5.0-beta.1');
    await expect(run(unit({ op: 'push-tag', channel: 'beta' }))).rejects.toThrow(/Push release\/0\.5\.0 first/);
    expect(w.remote('tag', '--list')).not.toContain('beta');
    await run(unit({ op: 'push-branch' }));
    const sent = await run(unit({ op: 'push-tag', channel: 'beta' }));
    expect(sent.tag).toBe('v0.5.0-beta.1');
    expect(w.remote('tag', '--list')).toContain('v0.5.0-beta.1');
  });

  it('sends the latest beta of the version, not an older one, and says when there is none', async () => {
    const { w, run } = await opened();
    await expect(run(unit({ op: 'push-tag', channel: 'beta' }))).rejects.toThrow(/no tag v0\.5\.0-beta\.N/i);
    w.steps.change('Added', 'one');
    await run(unit({ op: 'beta' }));
    w.steps.change('Fixed', 'two');
    await run(unit({ op: 'beta' }));
    expect(await latestBetaTag(w.dir, '0.5.0')).toBe('v0.5.0-beta.2');
    await run(unit({ op: 'push-branch' }));
    const sent = await run(unit({ op: 'push-tag', channel: 'beta' }));
    expect(sent.tag).toBe('v0.5.0-beta.2');
    expect(w.remote('tag', '--list')).not.toContain('beta.1');
  });

  it('refuses a tag that is not annotated', async () => {
    const { w, run } = await opened();
    w.git('tag', 'v0.5.0-beta.1');
    await run(unit({ op: 'push-branch' }));
    await expect(run(unit({ op: 'push-tag', channel: 'beta' }))).rejects.toThrow(/not an annotated tag/);
  });

  it('sends main after the stable was cut: the commit the stable tag names, from the detached HEAD, then the stable tag', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    await run(unit({ op: 'beta' }));
    await run(unit({ op: 'push-branch' }));
    await run(unit({ op: 'push-tag', channel: 'beta' }));
    await expect(run(unit({ op: 'push-branch', branch: 'main' }))).rejects.toThrow(/there is no tag v0\.5\.0 yet/);
    const mainBefore = w.git('rev-parse', 'main');
    await run(unit({ op: 'stable' }));
    await expect(run(unit({ op: 'push-tag', channel: 'stable' }))).rejects.toThrow(/Push main first/);
    // after other steps the worktree is on the release branch again: what is pushed to main is still the stable's commit, never the branch
    w.steps.git('switch', '-q', 'release/0.5.0');
    await run(unit({ op: 'push-branch', branch: 'main' }));
    expect(w.remote('rev-parse', 'main')).toBe(w.git('rev-parse', 'v0.5.0^{commit}'));
    expect(w.steps.branch).toBe('HEAD');
    await run(unit({ op: 'push-tag', channel: 'stable' }));
    expect(w.remote('tag', '--list')).toContain('v0.5.0');
    // the person's main is theirs to update
    expect(w.git('rev-parse', 'main')).toBe(mainBefore);
  });
});

describe('a whole release', () => {
  it('leaves the person\'s checkout as it was: its HEAD, its branch, its status and its main', async () => {
    const w = new ReleaseWorld();
    // the person is in the middle of something: a file that is not committed, and a dependency folder
    mkdirSync(join(w.dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(w.dir, 'node_modules', 'pkg', 'index.js'), 'x');
    writeFileSync(join(w.dir, 'wip.txt'), 'not committed\n');
    const before = w.snapshot();
    const mainBefore = w.git('rev-parse', 'main');
    const run = open(w, async () => green({ sha: head }));
    let head = '';
    await run(unit({ op: 'open' }));
    await run(unit({ op: 'push-branch' }));
    head = w.pushedBranch('feat/x', 'release/0.5.0');
    await run(unit({ op: 'merge-pr', pr: 7, head }));
    await run(unit({ op: 'beta' }));
    await run(unit({ op: 'push-branch' }));
    await run(unit({ op: 'push-tag', channel: 'beta' }));
    await run(unit({ op: 'stable' }));
    await run(unit({ op: 'push-branch', branch: 'main' }));
    await run(unit({ op: 'push-tag', channel: 'stable' }));
    expect(w.remote('tag', '--list').split('\n')).toEqual(expect.arrayContaining(['v0.5.0-beta.1', 'v0.5.0']));
    expect(w.snapshot()).toBe(before);
    expect(w.branch).toBe('main');
    expect(w.git('rev-parse', 'main')).toBe(mainBefore);
    expect(w.git('status', '--porcelain')).toBe('?? node_modules/\n?? wip.txt');
  });
});

describe('what a person is shown', () => {
  it('names the refs a push will use and never a flag that forces', () => {
    const lines = [
      releaseCommandLine(unit({ op: 'open' })),
      releaseCommandLine(unit({ op: 'open', version: '0.4.1', from: 'v0.4.0' })),
      releaseCommandLine(unit({ op: 'merge-pr', pr: 7 })),
      releaseCommandLine(unit({ op: 'beta' })),
      releaseCommandLine(unit({ op: 'stable' })),
      releaseCommandLine(unit({ op: 'push-branch' })),
      releaseCommandLine(unit({ op: 'push-branch', branch: 'main' })),
      releaseCommandLine(unit({ op: 'push-tag', channel: 'stable' })),
    ];
    expect(lines).toContain('git push origin HEAD:refs/heads/release/0.5.0');
    expect(lines).toContain('git push origin HEAD:refs/heads/main');
    expect(lines).toContain('git push origin refs/tags/v0.5.0');
    expect(lines.join('\n')).not.toMatch(/--force|--emergency|--allow-branch|\+refs/);
  });
});

describe('what runs, and when', () => {
  it('runs the steps one at a time per worktree, in the order they were asked, so a stable cannot move HEAD under a push that was asked at the same moment', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    await run(unit({ op: 'beta' }));
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    w.steps.git('push', '-q', 'origin', 'v0.5.0-beta.1');
    const releaseHead = w.steps.git('rev-parse', 'HEAD');
    // a stable (it detaches HEAD and merges), a push of the release branch and a push of main, fired together
    const results = await Promise.allSettled([run(unit({ op: 'stable' })), run(unit({ op: 'push-branch' })), run(unit({ op: 'push-branch', branch: 'main' }))]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    // the release branch got the commit of the release branch, never the stable's commit; main got the stable's
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(releaseHead);
    expect(w.remote('rev-parse', 'main')).toBe(w.git('rev-parse', 'v0.5.0^{commit}'));
    expect(w.remote('rev-parse', 'release/0.5.0')).not.toBe(w.remote('rev-parse', 'main'));
  });

  it('makes two cuts asked together one after the other: the first is made, the second finds nothing new to cut and says so', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    const two = await Promise.allSettled([run(unit({ op: 'beta' })), run(unit({ op: 'beta' }))]);
    expect(two.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(w.git('tag', '--list', 'v0.5.0-beta.*')).toBe('v0.5.0-beta.1');
  });

  it('keeps a step that failed from holding up the ones asked after it', async () => {
    const { run } = await opened();
    const [bad, good] = await Promise.allSettled([run(unit({ op: 'beta', version: '0.9.0' })), run(unit({ op: 'push-branch' }))]);
    expect(bad.status).toBe('rejected');
    expect(good.status).toBe('fulfilled');
  });

  it('sends a commit by name, never HEAD: what is pushed is what the step resolved', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing');
    const head = w.steps.git('rev-parse', 'HEAD');
    await run(unit({ op: 'push-branch' }));
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(head);
    expect(releaseCommandLine(unit({ op: 'push-branch' }))).toContain('HEAD:refs/heads/');
  });

  it('forgets a worktree whose folder was deleted and makes it again', async () => {
    const { w, run } = await opened();
    rmSync(w.stepsDir, { recursive: true, force: true });
    expect(w.git('worktree', 'list', '--porcelain')).toContain(w.stepsDir);
    await run(unit({ op: 'push-branch' }));
    expect(existsSync(join(w.stepsDir, '.git'))).toBe(true);
    expect(w.steps.branch).toBe('release/0.5.0');
  });

  it('says why a worktree could not be made, instead of git\'s own wording alone', async () => {
    const w = new ReleaseWorld();
    // the folder is under a file: it cannot be made
    writeFileSync(join(w.root, 'blocker'), 'x');
    await expect(runReleaseOp(unit({ op: 'open' }), { clone: w.dir, worktree: join(w.root, 'blocker', 'steps'), identity: AUTHOR, env: w.scriptEnv() })).rejects.toThrow();
  });

  it('runs without the hooks of the repository: not when the worktree is made, not when a branch is switched to, and not for the script\'s own commits', async () => {
    const w = new ReleaseWorld();
    const marker = join(w.root, 'hook-ran');
    for (const hook of ['post-checkout', 'post-merge', 'pre-commit', 'commit-msg']) {
      writeFileSync(join(w.dir, '.git', 'hooks', hook), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    }
    // the hook does run for a plain git command (so the test can tell)
    w.git('worktree', 'add', '--detach', join(w.root, 'sanity'), 'main');
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    const run = open(w);
    await run(unit({ op: 'open' }));
    w.steps.change('Added', 'a thing');
    await run(unit({ op: 'beta' }));
    await run(unit({ op: 'push-branch' }));
    expect(existsSync(marker)).toBe(false);
  });

  it('stops a script that outlives its time, with everything it started, and puts the worktree back so the next step can run', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    writeFileSync(join(w.root, 'hang'), '');
    await expect(runReleaseOp(unit({ op: 'beta' }), { clone: w.dir, worktree: w.stepsDir, identity: AUTHOR, env: w.scriptEnv(), scriptTimeoutMs: 700 })).rejects.toThrow(/ran past its limit/);
    const pid = Number(readFileSync(join(w.root, 'sleep.pid'), 'utf8').trim());
    expect(() => process.kill(pid, 0)).toThrow();
    // what the script left (a file, a lock) is gone, and the tree is clean
    expect(existsSync(join(w.stepsDir, 'left-by-script.txt'))).toBe(false);
    expect(w.steps.git('status', '--porcelain')).toBe('');
    rmSync(join(w.root, 'hang'));
    const cut = await run(unit({ op: 'beta' }));
    expect(cut.tag).toBe('v0.5.0-beta.1');
  });
});

describe('what a person is shown for a push of main', () => {
  it('is the commits of the stable the tag names over what the remote has, never the person\'s own main, and says when the stable is not cut yet', async () => {
    const { w, run } = await opened();
    w.steps.change('Added', 'a thing for the version');
    await run(unit({ op: 'beta' }));
    await run(unit({ op: 'push-branch' }));
    await run(unit({ op: 'push-tag', channel: 'beta' }));
    const notCut = await previewRelease(unit({ op: 'push-branch', branch: 'main' }), w.dir);
    expect(notCut).toContain('git push origin HEAD:refs/heads/main');
    expect(notCut).toMatch(/there is no tag v0\.5\.0 yet/);
    // the person has a commit of their own on main that would never be sent
    writeFileSync(join(w.dir, 'mine.txt'), 'x');
    w.git('add', '-A');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'my own unpushed work');
    await run(unit({ op: 'stable' }));
    const shown = await previewRelease(unit({ op: 'push-branch', branch: 'main' }), w.dir);
    expect(shown).toContain('feat: a thing for the version');
    expect(shown).toContain('feat: release 0.5.0');
    expect(shown).not.toContain('my own unpushed work');
  });
});
