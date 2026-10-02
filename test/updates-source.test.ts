import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_SOURCE_COMMITS } from '../src/shared/updates';
import { parseCommitLog, readSourceState } from '../src/main/updates-source';

// Source-ahead detection against throwaway repositories: nothing real is read.
const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const run = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'cerimonias-updates-source-'));
  roots.push(root);
  return root;
}

// A repository whose main has `count` commits; returns the hashes, oldest first.
function repo(count: number, dir = join(scratch(), 'tree')): { dir: string; hashes: string[] } {
  mkdirSync(dir, { recursive: true });
  run(dir, 'init', '-q', '-b', 'main');
  const hashes: string[] = [];
  for (let i = 1; i <= count; i++) {
    writeFileSync(join(dir, 'f.txt'), `${i}\n`);
    run(dir, 'add', '-A');
    run(dir, 'commit', '-q', '-m', `commit ${i}`);
    hashes.push(run(dir, 'rev-parse', '--short', 'HEAD'));
  }
  return { dir, hashes };
}

// Everything a read-only check must leave alone.
function fingerprint(dir: string): string {
  return [run(dir, 'rev-parse', 'HEAD'), run(dir, 'for-each-ref'), run(dir, 'status', '--porcelain'), readFileSync(join(dir, '.git/index')).toString('base64'), readdirSync(join(dir, '.git')).sort().join(',')].join('\n');
}

describe('readSourceState', () => {
  it('counts the commits main has beyond the installed build and lists them, newest first', async () => {
    const { dir, hashes } = repo(4);
    const state = await readSourceState(dir, hashes[1], { fetch: false });
    expect(state.error).toBeNull();
    expect(state.installed).toBe(hashes[1]);
    expect(state.head).toBe(hashes[3]);
    expect(state.ahead).toBe(2);
    expect(state.commits.map((c) => c.subject)).toEqual(['commit 4', 'commit 3']);
    expect(state.commits.map((c) => c.commit)).toEqual([hashes[3], hashes[2]]);
    expect(Number.isNaN(Date.parse(state.commits[0].date))).toBe(false);
    expect(state.fetched).toBe(false);
    expect(state.checkedAt).not.toBeNull();
  });

  it('is up to date when the installed build is the tip of main', async () => {
    const { dir, hashes } = repo(3);
    const state = await readSourceState(dir, hashes[2], { fetch: false });
    expect(state).toMatchObject({ error: null, ahead: 0, commits: [] });
  });

  it('ignores the +dirty stamp of a build made over uncommitted changes', async () => {
    const { dir, hashes } = repo(3);
    const state = await readSourceState(dir, `${hashes[0]}+dirty`, { fetch: false });
    expect(state.installed).toBe(hashes[0]);
    expect(state.ahead).toBe(2);
  });

  it('follows main, not the checked out branch or the working tree', async () => {
    const { dir, hashes } = repo(3);
    run(dir, 'checkout', '-q', '-b', 'topic', hashes[0]);
    writeFileSync(join(dir, 'f.txt'), 'uncommitted\n');
    const state = await readSourceState(dir, hashes[0], { fetch: false });
    expect(state.ahead).toBe(2);
    expect(state.head).toBe(hashes[2]);
  });

  it('caps the list but not the count', async () => {
    const { dir, hashes } = repo(MAX_SOURCE_COMMITS + 5);
    const state = await readSourceState(dir, hashes[0], { fetch: false });
    expect(state.ahead).toBe(MAX_SOURCE_COMMITS + 4);
    expect(state.commits).toHaveLength(MAX_SOURCE_COMMITS);
  }, 60_000);

  it('does not write anything: HEAD, refs, index, work tree and the .git folder are the same afterwards', async () => {
    const { dir, hashes } = repo(3);
    writeFileSync(join(dir, 'untracked.txt'), 'x\n');
    const before = fingerprint(dir);
    await readSourceState(dir, hashes[0], { fetch: false });
    expect(fingerprint(dir)).toBe(before);
  });

  it('says so when the installed commit is not in the tree', async () => {
    const { dir } = repo(2);
    const state = await readSourceState(dir, '1234567', { fetch: false });
    expect(state).toMatchObject({ error: 'commit-unknown', errorDetail: '1234567', ahead: null });
    expect(state.head).not.toBeNull();
  });

  it('has nothing to compare for a dev build or a stamp that is not a commit', async () => {
    const { dir } = repo(2);
    expect((await readSourceState(dir, 'dev', { fetch: false })).error).toBe('commit-unknown');
    expect((await readSourceState(dir, '', { fetch: false })).error).toBe('commit-unknown');
  });

  it('reports a missing folder, a folder that is not a repository, and a repository without main', async () => {
    expect((await readSourceState(null, 'abc1234', { fetch: false })).error).toBe('no-dir');
    expect((await readSourceState(join(scratch(), 'nope'), 'abc1234', { fetch: false })).error).toBe('no-dir');
    const plain = scratch();
    expect((await readSourceState(plain, 'abc1234', { fetch: false })).error).toBe('not-a-repo');
    const other = join(scratch(), 'tree');
    mkdirSync(other);
    run(other, 'init', '-q', '-b', 'trunk');
    writeFileSync(join(other, 'f'), '1');
    run(other, 'add', '-A');
    run(other, 'commit', '-q', '-m', 'one');
    expect((await readSourceState(other, run(other, 'rev-parse', '--short', 'HEAD'), { fetch: false })).error).toBe('no-main');
  });

  it('works in a linked worktree, where .git is a file', async () => {
    const { dir, hashes } = repo(3);
    const linked = join(scratch(), 'linked');
    run(dir, 'worktree', 'add', '-q', '-b', 'other', linked, hashes[1]);
    const state = await readSourceState(linked, hashes[0], { fetch: false });
    expect(state.ahead).toBe(2);
  });
});

describe('readSourceState with git fetch', () => {
  // origin is a bare repository; the tree is a clone of it. A third clone pushes new commits to origin.
  function clones(): { origin: string; tree: string; pusher: string; installed: string } {
    const root = scratch();
    const seed = repo(2, join(root, 'seed'));
    const origin = join(root, 'origin.git');
    execFileSync('git', ['clone', '-q', '--bare', seed.dir, origin]);
    const tree = join(root, 'tree');
    execFileSync('git', ['clone', '-q', origin, tree]);
    const pusher = join(root, 'pusher');
    execFileSync('git', ['clone', '-q', origin, pusher]);
    return { origin, tree, pusher, installed: seed.hashes[1] };
  }

  const pushFrom = (pusher: string, n: number): void => {
    for (let i = 0; i < n; i++) {
      writeFileSync(join(pusher, 'f.txt'), `remote ${i}\n`);
      run(pusher, 'add', '-A');
      run(pusher, 'commit', '-q', '-m', `remote ${i}`);
    }
    run(pusher, 'push', '-q', 'origin', 'main');
  };

  it('does not fetch unless asked: the remote stays unknown', async () => {
    const c = clones();
    pushFrom(c.pusher, 2);
    const state = await readSourceState(c.tree, c.installed, { fetch: false });
    expect(state.fetched).toBe(false);
    expect(state.ahead).toBe(0);
    expect(state.remoteAhead).toBe(0);
  });

  it('fetches when asked and reports what origin/main has beyond the local main, without moving main', async () => {
    const c = clones();
    pushFrom(c.pusher, 2);
    const mainBefore = run(c.tree, 'rev-parse', 'main');
    const state = await readSourceState(c.tree, c.installed, { fetch: true });
    expect(state.fetched).toBe(true);
    expect(state.fetchError).toBeNull();
    expect(state.remoteAhead).toBe(2);
    expect(state.ahead).toBe(0);
    expect(run(c.tree, 'rev-parse', 'main')).toBe(mainBefore);
  });

  it('keeps the local answer when the fetch fails', async () => {
    const c = clones();
    run(c.tree, 'remote', 'set-url', 'origin', join(scratch(), 'gone.git'));
    const state = await readSourceState(c.tree, c.installed, { fetch: true });
    expect(state.fetched).toBe(false);
    expect(state.fetchError).toBeTruthy();
    expect(state.ahead).toBe(0);
    expect(state.error).toBeNull();
  });
});

describe('parseCommitLog', () => {
  it('reads hash, date and subject, and keeps a subject that contains the separator', () => {
    expect(parseCommitLog('a0547e8\x1f2026-10-02T11:30:00-03:00\x1ffix: one\n1111111\x1f2026-10-01T00:00:00Z\x1fa\x1fb\n')).toEqual([
      { commit: 'a0547e8', date: '2026-10-02T11:30:00-03:00', subject: 'fix: one' },
      { commit: '1111111', date: '2026-10-01T00:00:00Z', subject: 'a\x1fb' },
    ]);
  });

  it('skips anything that is not a commit line', () => {
    expect(parseCommitLog('')).toEqual([]);
    expect(parseCommitLog('fatal: bad revision\nxyz')).toEqual([]);
  });

});
