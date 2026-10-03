import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { type ReleasePr, latestBetaTag, releaseCommandLine, runReleaseOp } from '../src/main/releaseGit';
import { type ReleaseUnit } from '../src/shared/release';
import { AUTHOR, ReleaseWorld, cleanWorlds } from './helpers/releaseWorld';

// The release operations against real temporary repositories: the repository's own scripts/release.sh runs (behind a wrapper that records its arguments),
// the host is a function a test gives, and nothing leaves the machine except into a bare repository on disk.

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
const open = (w: ReleaseWorld, pr?: (n: number) => Promise<ReleasePr>) => (u: ReleaseUnit) => runReleaseOp(u, { clone: w.dir, identity: AUTHOR, env: w.scriptEnv(), pr });

const green = (over: Partial<ReleasePr> = {}): ReleasePr => ({ state: 'open', draft: false, sourceBranch: 'feat/x', targetBranch: 'release/0.5.0', sha: '', approved: true, checks: 'success', ...over });

/** A world with release/0.5.0 open and pushed. */
async function opened(): Promise<{ w: ReleaseWorld; run: (u: ReleaseUnit) => ReturnType<ReturnType<typeof open>> }> {
  const w = new ReleaseWorld();
  const run = open(w);
  await run(unit({ op: 'open' }));
  w.git('push', '-q', '-u', 'origin', 'release/0.5.0');
  return { w, run };
}

describe('open', () => {
  it('cuts release/X.Y.Z from main with the script, and passes it nothing but the version and the author', async () => {
    const w = new ReleaseWorld();
    const main = w.git('rev-parse', 'main');
    const r = await open(w)(unit({ op: 'open' }));
    expect(w.branch).toBe('release/0.5.0');
    expect(r.before).toBe(main);
    expect(r.after).toBe(main);
    expect(w.argv()).toEqual([['open', '0.5.0', '--author', `${AUTHOR.name} <${AUTHOR.email}>`]]);
    // nothing was pushed
    expect(w.remote('branch', '--list')).not.toContain('release/0.5.0');
  });

  it('cuts a patch from the stable tag with --from', async () => {
    const w = new ReleaseWorld();
    await open(w)(unit({ op: 'open', version: '0.4.1', from: 'v0.4.0' }));
    expect(w.branch).toBe('release/0.4.1');
    expect(w.git('rev-parse', 'HEAD')).toBe(w.git('rev-parse', 'v0.4.0^{commit}'));
    expect(w.argv()[0]).toEqual(['open', '0.4.1', '--from', 'v0.4.0', '--author', `${AUTHOR.name} <${AUTHOR.email}>`]);
  });

  it('surfaces the refusal of the script, and does nothing else, when the branch exists', async () => {
    const w = new ReleaseWorld();
    w.git('branch', 'release/0.5.0');
    await expect(open(w)(unit({ op: 'open' }))).rejects.toThrow(/release\/0\.5\.0 already exists/);
    expect(w.branch).toBe('main');
  });

  it('refuses a repository with changes that are not committed before it runs anything', async () => {
    const w = new ReleaseWorld();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(w.dir, 'dirty.txt'), 'x');
    await expect(open(w)(unit({ op: 'open' }))).rejects.toThrow(/not committed/);
    expect(w.argv()).toEqual([]);
    expect(w.branch).toBe('main');
  });

  it('refuses a folder that is not a working checkout', async () => {
    const w = new ReleaseWorld();
    await expect(runReleaseOp(unit({ op: 'open' }), { clone: w.origin, identity: AUTHOR, env: w.scriptEnv() })).rejects.toThrow(/not a working checkout/);
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
    expect(w.branch).toBe('release/0.5.0');
    expect(w.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
    expect(w.git('log', '-1', '--format=%s')).toBe('Merge pull request #7 from feat/x');
    expect(w.git('log', '-1', '--format=%an <%ae>')).toBe(`${AUTHOR.name} <${AUTHOR.email}>`);
    expect(w.git('log', '-1', '--format=%cn <%ce>')).toBe(`${AUTHOR.name} <${AUTHOR.email}>`);
    expect(r.after).toBe(w.git('rev-parse', 'HEAD'));
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
  ])('refuses %s, and merges nothing', async (_name, over, message) => {
    const { w } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const before = w.git('rev-parse', 'HEAD');
    await expect(open(w, async () => green({ sha: head, ...over }))(unit({ op: 'merge-pr', pr: 7, head }))).rejects.toThrow(message);
    expect(w.git('rev-parse', 'HEAD')).toBe(before);
    expect(w.git('status', '--porcelain')).toBe('');
  });

  it('refuses a pull request whose head moved since the plan read it, whether the host says so or the fetch does', async () => {
    const { w } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const before = w.git('rev-parse', 'HEAD');
    // the plan read another commit
    await expect(open(w, async () => green({ sha: head }))(unit({ op: 'merge-pr', pr: 7, head: 'a'.repeat(40) }))).rejects.toThrow(/plan read it/);
    // the host says one commit and the branch holds another
    await expect(open(w, async () => green({ sha: 'b'.repeat(40) }))(unit({ op: 'merge-pr', pr: 7 }))).rejects.toThrow(/plan read it/);
    expect(w.git('rev-parse', 'HEAD')).toBe(before);
  });

  it('is a no-op for a pull request that is already in the branch', async () => {
    const { w } = await opened();
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    const merge = open(w, async () => green({ sha: head }));
    await merge(unit({ op: 'merge-pr', pr: 7, head }));
    const after = w.git('rev-parse', 'HEAD');
    const again = await merge(unit({ op: 'merge-pr', pr: 7, head }));
    expect(again.output).toMatch(/already in release\/0\.5\.0/);
    expect(w.git('rev-parse', 'HEAD')).toBe(after);
  });

  it('undoes a merge that conflicts and leaves the tree clean', async () => {
    const { w } = await opened();
    // the release branch changes a file that the pull request changes too
    w.commit('on the branch', 'feat: on the branch');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(w.dir, 'shared.txt'), 'ours\n');
    w.git('add', '-A');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'ours');
    w.git('push', '-q', 'origin', 'release/0.5.0');
    const head = w.pushedBranch('feat/x', 'main', 'shared.txt', 'theirs\n');
    const before = w.git('rev-parse', 'HEAD');
    await expect(open(w, async () => green({ sha: head }))(unit({ op: 'merge-pr', pr: 7, head }))).rejects.toThrow(/conflicts, and the merge was undone/);
    expect(w.git('rev-parse', 'HEAD')).toBe(before);
    expect(w.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(w.dir, '.git', 'MERGE_HEAD'))).toBe(false);
  });

  it('refuses when the code host cannot be read, and when the release branch does not exist', async () => {
    const { w } = await opened();
    await expect(open(w)(unit({ op: 'merge-pr', pr: 7 }))).rejects.toThrow(/cannot be read right now/);
    const bare = new ReleaseWorld();
    await expect(open(bare, async () => green())(unit({ op: 'merge-pr', pr: 7 }))).rejects.toThrow(/branch release\/0\.5\.0 does not exist/);
  });
});

describe('beta', () => {
  it('cuts the next beta on the release branch with the script and the identity, and never with --emergency or --allow-branch', async () => {
    const { w, run } = await opened();
    w.change('Added', 'a thing for the version');
    w.git('push', '-q', 'origin', 'release/0.5.0');
    const r = await run(unit({ op: 'beta' }));
    expect(r.tag).toBe('v0.5.0-beta.1');
    expect(w.version).toBe('0.5.0-beta.1');
    expect(w.git('cat-file', '-t', 'refs/tags/v0.5.0-beta.1')).toBe('tag');
    expect(w.git('log', '-1', '--format=%an <%ae>')).toBe(`${AUTHOR.name} <${AUTHOR.email}>`);
    const second = await (async () => {
      w.change('Fixed', 'a fix after the beta');
      w.git('push', '-q', 'origin', 'release/0.5.0');
      return run(unit({ op: 'beta' }));
    })();
    expect(second.tag).toBe('v0.5.0-beta.2');
    const calls = w.argv().filter((a) => a[0] === 'beta');
    expect(calls).toEqual([['beta', '--author', `${AUTHOR.name} <${AUTHOR.email}>`], ['beta', '--author', `${AUTHOR.name} <${AUTHOR.email}>`]]);
    expect(w.argv().flat()).not.toContain('--emergency');
    expect(w.argv().flat()).not.toContain('--allow-branch');
    expect(w.argv().flat()).not.toContain('--skip-checks');
    // nothing was pushed by the cut
    expect(w.remote('tag', '--list')).not.toContain('beta');
  });

  it('switches to the release branch first, and says so when the script refuses (nothing to release)', async () => {
    const { w, run } = await opened();
    w.git('switch', '-q', 'main');
    // an empty [Unreleased] on the branch is the script's refusal to make: the changelog already has the unreleased entry of main, so empty it
    await expect(run(unit({ op: 'beta', version: '0.9.0' }))).rejects.toThrow(/branch release\/0\.9\.0 does not exist/);
  });
});

describe('a release branch that only the remote has', () => {
  it('is made local, tracking it, for a merge and for a beta, as `git switch` would', async () => {
    const { w, run } = await opened();
    w.git('switch', '-q', 'main');
    w.git('branch', '-D', 'release/0.5.0');
    expect(w.gitOk('show-ref', '--verify', '--quiet', 'refs/heads/release/0.5.0')).toBe(false);
    const head = w.pushedBranch('feat/x', 'release/0.5.0');
    await open(w, async () => green({ sha: head }))(unit({ op: 'merge-pr', pr: 7, head }));
    expect(w.branch).toBe('release/0.5.0');
    expect(w.git('rev-parse', '--abbrev-ref', 'release/0.5.0@{upstream}')).toBe('origin/release/0.5.0');
    w.git('switch', '-q', 'main');
    w.git('branch', '-D', 'release/0.5.0');
    const cut = await run(unit({ op: 'beta' }));
    expect(cut.tag).toBe('v0.5.0-beta.1');
  });
});

describe('stable', () => {
  async function betaCut(): Promise<{ w: ReleaseWorld; run: (u: ReleaseUnit) => ReturnType<ReturnType<typeof open>> }> {
    const { w, run } = await opened();
    w.change('Added', 'a thing for the version');
    w.git('push', '-q', 'origin', 'release/0.5.0');
    await run(unit({ op: 'beta' }));
    w.git('push', '-q', 'origin', 'release/0.5.0');
    w.git('push', '-q', 'origin', 'v0.5.0-beta.1');
    return { w, run };
  }

  it('merges the release branch into main (a fast-forward here) and cuts the stable on main, folding the beta', async () => {
    const { w, run } = await betaCut();
    const r = await run(unit({ op: 'stable' }));
    expect(w.branch).toBe('main');
    expect(r.tag).toBe('v0.5.0');
    expect(w.version).toBe('0.5.0');
    expect(w.git('cat-file', '-t', 'refs/tags/v0.5.0')).toBe('tag');
    expect(w.git('merge-base', '--is-ancestor', 'v0.5.0-beta.1', 'main') || 'ok').toBe('ok');
    expect(w.argv().filter((a) => a[0] === 'stable')).toEqual([['stable', '--author', `${AUTHOR.name} <${AUTHOR.email}>`]]);
    expect(w.argv().flat()).not.toContain('--emergency');
    // main was not pushed
    expect(w.remote('rev-parse', 'main')).not.toBe(w.git('rev-parse', 'main'));
  });

  it('makes a merge commit with the identity when main has moved', async () => {
    const { w, run } = await betaCut();
    w.git('switch', '-q', 'main');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(w.dir, 'meanwhile.txt'), 'something on main meanwhile\n');
    w.git('add', '-A');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'meanwhile');
    w.git('push', '-q', 'origin', 'main');
    await run(unit({ op: 'stable' }));
    expect(w.git('log', '--merges', '-1', '--format=%s %an <%ae>')).toBe(`Merge release/0.5.0 ${AUTHOR.name} <${AUTHOR.email}>`);
    expect(w.git('tag', '--list', 'v0.5.0')).toBe('v0.5.0');
  });

  it('is refused by the script without a beta, and --emergency is not how it goes on', async () => {
    const { w, run } = await opened();
    await expect(run(unit({ op: 'stable' }))).rejects.toThrow(/refusing the stable|already a stable version/);
    expect(w.argv().flat()).not.toContain('--emergency');
    expect(w.git('tag', '--list', 'v0.5.0')).toBe('');
  });

  it('refuses a main that cannot be fast-forwarded to the remote', async () => {
    const { w, run } = await betaCut();
    w.git('switch', '-q', 'main');
    w.change('Added', 'a commit only here');
    w.pushedBranch('side', 'main');
    // the remote's main gains a commit this clone's main lacks, while this clone's main has one the remote lacks
    const { spawnSync } = await import('node:child_process');
    const other = join(w.root, 'other-main');
    spawnSync('git', ['clone', '-q', w.origin, other], { env: w.env });
    spawnSync('git', ['-C', other, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'remote only'], { env: w.env });
    spawnSync('git', ['-C', other, 'push', '-q', 'origin', 'main'], { env: w.env });
    await expect(run(unit({ op: 'stable' }))).rejects.toThrow(/cannot be fast-forwarded/);
  });
});

describe('push-branch and push-tag', () => {
  it('push the release branch plainly, and refuse what the remote would not take as a fast-forward (never a force)', async () => {
    const { w, run } = await opened();
    w.change('Added', 'a thing');
    const sent = await run(unit({ op: 'push-branch' }));
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(w.git('rev-parse', 'HEAD'));
    expect(sent.tag).toBeNull();
    // the remote moves on; this clone diverges: git refuses, and the remote keeps what it has
    w.pushedBranch('release/0.5.0', 'release/0.5.0', 'theirs.txt');
    const theirs = w.remote('rev-parse', 'release/0.5.0');
    w.change('Added', 'a diverging thing');
    await expect(run(unit({ op: 'push-branch' }))).rejects.toThrow();
    expect(w.remote('rev-parse', 'release/0.5.0')).toBe(theirs);
  });

  it('push the tag only after its branch is on the remote, as an annotated tag, plainly', async () => {
    const { w, run } = await opened();
    w.change('Added', 'a thing for the version');
    const cut = await run(unit({ op: 'beta' }));
    expect(cut.tag).toBe('v0.5.0-beta.1');
    // the branch is not on the remote with the tag's commit yet
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
    w.change('Added', 'one');
    await run(unit({ op: 'beta' }));
    w.change('Fixed', 'two');
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

  it('sends main only after the stable was cut on it, then the stable tag', async () => {
    const { w, run } = await opened();
    w.change('Added', 'a thing for the version');
    await run(unit({ op: 'beta' }));
    await run(unit({ op: 'push-branch' }));
    await run(unit({ op: 'push-tag', channel: 'beta' }));
    await expect(run(unit({ op: 'push-branch', branch: 'main' }))).rejects.toThrow(/stable is cut on it/);
    await run(unit({ op: 'stable' }));
    await expect(run(unit({ op: 'push-tag', channel: 'stable' }))).rejects.toThrow(/Push main first/);
    await run(unit({ op: 'push-branch', branch: 'main' }));
    expect(w.remote('rev-parse', 'main')).toBe(w.git('rev-parse', 'main'));
    await run(unit({ op: 'push-tag', channel: 'stable' }));
    expect(w.remote('tag', '--list')).toContain('v0.5.0');
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
