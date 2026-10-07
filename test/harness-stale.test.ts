import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGED_KEPT, checkHarness, clearHarnessCache } from '../src/main/harness/stale';
import { scanHarness } from '../src/main/harness/scan';

vi.setConfig({ testTimeout: 30_000 });

// Real temporary repositories, hermetic git (test/setup.ts); nothing here reaches a network.
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
const roots: string[] = [];
beforeEach(() => clearHarnessCache());
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'cerimonias-stale-'));
  constructor() {
    roots.push(this.dir);
    this.git('init', '-q', '-b', 'main');
  }
  git(...args: string[]): string {
    const r = spawnSync('git', [...ID, ...args], { cwd: this.dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  }
  write(rel: string, text: string): void {
    mkdirSync(dirname(join(this.dir, rel)), { recursive: true });
    writeFileSync(join(this.dir, rel), text);
  }
  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '-q', '--no-verify', '-m', message);
    return this.head();
  }
  head = (): string => this.git('rev-parse', 'HEAD');
  /** A rule (or any file of .coxia) checked against a commit. */
  doc(rel: string, commit: string, ...extra: string[]): void {
    this.write(`.coxia/${rel}`, ['---', `checked-commit: ${commit}`, 'checked-date: 2026-10-06', ...extra, '---', '', '# Rule', ''].join('\n'));
  }
  async check(opts?: { timeoutMs?: number }) {
    return checkHarness(await scanHarness(this.dir), opts);
  }
}

/** Code at C1 and a rule that cites it, checked against C1. */
function world(evidence = 'src/a.ts:1-3'): { r: Repo; c1: string } {
  const r = new Repo();
  r.write('src/a.ts', 'one\n');
  r.write('src/dir/b.ts', 'one\n');
  const c1 = r.commit('code');
  r.doc('rules/r.md', c1, `evidence: [${evidence}]`);
  r.commit('rule');
  return { r, c1 };
}

describe('a reference that is an ancestor of HEAD', () => {
  it('is checked while the cited file has not changed, even after other work and a commit that only touches .coxia', async () => {
    const { r, c1 } = world();
    r.write('src/other.ts', 'x\n');
    r.write('.coxia/rules/second.md', '');
    r.commit('other work');
    const c = await r.check();
    expect(c.files['rules/r.md']).toEqual({ state: 'checked' });
    expect(c.head).toBe(r.head());
    expect(c.files['rules/r.md']).not.toHaveProperty('ref');
    expect(c1).not.toBe(r.head());
  });

  it('is stale once a cited file changed after the commit, with the file and the reference', async () => {
    const { r, c1 } = world();
    r.write('src/a.ts', 'two\n');
    r.commit('change');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'stale', ref: c1, changed: ['src/a.ts'], total: 1 });
  });

  it('does not count what changed before the commit it was checked against', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.commit('first');
    r.write('src/a.ts', 'two\n');
    const c2 = r.commit('second');
    r.doc('rules/r.md', c2, 'evidence: [src/a.ts]');
    r.commit('rule');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
  });

  it('counts a cited file that was deleted, and one that was renamed (under the name the rule cites)', async () => {
    const { r, c1 } = world('src/a.ts, src/dir/b.ts');
    r.git('rm', '-q', 'src/dir/b.ts');
    renameSync(join(r.dir, 'src/a.ts'), join(r.dir, 'src/moved.ts'));
    r.commit('delete and move');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'stale', ref: c1, changed: ['src/a.ts', 'src/dir/b.ts'], total: 2 });
  });

  it('counts anything under a folder entry, and nothing outside it', async () => {
    const { r, c1 } = world('src/dir/');
    r.write('src/a.ts', 'two\n');
    r.commit('outside');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
    r.write('src/dir/new/deep.ts', 'x\n');
    r.commit('inside');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'stale', ref: c1, changed: ['src/dir/new/deep.ts'], total: 1 });
  });

  it('counts a change that is not committed yet, staged or not, and clears when it is undone', async () => {
    const { r, c1 } = world('src/a.ts, src/dir/b.ts');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
    r.write('src/a.ts', 'edited\n');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'stale', ref: c1, changed: ['src/a.ts'], total: 1 });
    r.write('src/dir/b.ts', 'staged\n');
    r.git('add', 'src/dir/b.ts');
    expect((await r.check()).files['rules/r.md']).toMatchObject({ state: 'stale', changed: ['src/a.ts', 'src/dir/b.ts'] });
    r.git('checkout', '-q', 'HEAD', '--', 'src');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
  });

  it('keeps the first five changed files and counts them all', async () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`);
    const r = new Repo();
    for (const f of files) r.write(f, 'one\n');
    const c1 = r.commit('code');
    r.doc('rules/r.md', c1, 'evidence: [src/]');
    r.commit('rule');
    for (const f of files) r.write(f, 'two\n');
    r.commit('change all');
    const s = (await r.check()).files['rules/r.md'];
    expect(s).toMatchObject({ state: 'stale', total: 8 });
    expect(s.state === 'stale' && s.changed).toEqual(files.slice(0, CHANGED_KEPT));
  });

  it('does not compare what is in .coxia, so a rule does not go stale by the commit that checked it', async () => {
    const { r, c1 } = world('src/a.ts, .coxia/rules/other.md');
    r.doc('rules/other.md', c1, 'evidence: [src/dir/]');
    r.commit('another rule');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
  });
});

describe('a reference the history no longer has', () => {
  it('is found by the commit that put its value in the file: a squash of the pull request', async () => {
    const { r, c1 } = world();
    r.git('checkout', '-q', '-b', 'pr');
    r.write('src/a.ts', 'two\n');
    const p1 = r.commit('code of the pull request');
    r.doc('rules/r.md', p1, 'evidence: [src/a.ts:1-3]');
    r.commit('rule of the pull request');
    r.git('checkout', '-q', 'main');
    r.git('merge', '--squash', 'pr');
    r.commit('squash');
    r.git('branch', '-q', '-D', 'pr');
    // the commit the rule names is not in the history of main
    expect(spawnSync('git', ['merge-base', '--is-ancestor', p1, 'HEAD'], { cwd: r.dir }).status).toBe(1);
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
    r.write('src/a.ts', 'three\n');
    const after = r.commit('later change');
    expect(after).not.toBe(c1);
    expect((await r.check()).files['rules/r.md']).toMatchObject({ state: 'stale', changed: ['src/a.ts'] });
  });

  it('is found the same way when the commit is not in the repository at all (a rebase, a shallow clone)', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.commit('code');
    r.doc('rules/r.md', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'evidence: [src/a.ts]');
    const written = r.commit('rule');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'checked' });
    r.write('src/a.ts', 'two\n');
    r.commit('change');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'stale', ref: written, changed: ['src/a.ts'], total: 1 });
  });

  it('is unverified when no commit of the history holds the value (a rule not committed yet)', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.commit('code');
    r.doc('rules/r.md', 'deadbeef', 'evidence: [src/a.ts]');
    expect((await r.check()).files['rules/r.md']).toEqual({ state: 'unverified', reason: 'outside-history' });
  });
});

describe('what has nothing to compare, and what cannot be compared', () => {
  it('counts a file with no evidence (overview, skill, role) as checked, and never asks git', async () => {
    const r = new Repo();
    r.doc('README.md', 'deadbeef');
    r.doc('skills/s.md', 'deadbeef', 'evidence: []');
    r.doc('roles/dev.md', 'deadbeef');
    const c = await r.check();
    expect(c.files).toEqual({ 'README.md': { state: 'checked' }, 'skills/s.md': { state: 'checked' }, 'roles/dev.md': { state: 'checked' } });
    expect(c.head).toBeNull();
  });

  it('leaves out a file with no valid header: it is invalid, not stale', async () => {
    const { r } = world();
    r.write('.coxia/rules/bad.md', '# no header');
    expect(Object.keys((await r.check()).files)).toEqual(['rules/r.md']);
  });

  it('says unverified, with the reason, when git cannot read the folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerimonias-stale-plain-'));
    roots.push(dir);
    mkdirSync(join(dir, '.coxia/rules'), { recursive: true });
    writeFileSync(join(dir, '.coxia/rules/r.md'), ['---', 'checked-commit: 0123456', 'checked-date: 2026-10-06', 'evidence: [a.ts]', '---', ''].join('\n'));
    writeFileSync(join(dir, '.coxia/README.md'), ['---', 'checked-commit: 0123456', 'checked-date: 2026-10-06', '---', ''].join('\n'));
    const c = await checkHarness(await scanHarness(dir));
    expect(c.files['rules/r.md']).toEqual({ state: 'unverified', reason: 'git' });
    expect(c.files['README.md']).toEqual({ state: 'checked' });
    expect(c.head).toBeNull();
  });

  it('says unverified, with the reason, when the limit of time is over (a limit of zero is over at once)', async () => {
    const { r } = world();
    const c = await r.check({ timeoutMs: 0 });
    expect(c.files['rules/r.md']).toEqual({ state: 'unverified', reason: 'timeout' });
    // nothing is kept from a check that did not finish
    expect((await r.check()).cached).toBe(false);
  });
});

describe('the cache of a repository', () => {
  it('is reused for the same HEAD and the same files, and is made again when HEAD or a file of .coxia changes', async () => {
    const { r, c1 } = world();
    expect((await r.check()).cached).toBe(false);
    expect((await r.check()).cached).toBe(true);
    r.write('src/a.ts', 'two\n');
    r.commit('change');
    const afterHead = await r.check();
    expect(afterHead.cached).toBe(false);
    expect(afterHead.files['rules/r.md']).toMatchObject({ state: 'stale', ref: c1 });
    expect((await r.check()).cached).toBe(true);
    r.doc('rules/r.md', r.head(), 'evidence: [src/a.ts:1-3]', 'summary: checked again');
    const afterFile = await r.check();
    expect(afterFile.cached).toBe(false);
    expect(afterFile.files['rules/r.md']).toEqual({ state: 'checked' });
  });

  it('serves the committed part from the cache and still sees an edit that is not committed', async () => {
    const { r } = world();
    await r.check();
    r.write('src/a.ts', 'edited\n');
    const c = await r.check();
    expect(c.cached).toBe(true);
    expect(c.files['rules/r.md']).toMatchObject({ state: 'stale', changed: ['src/a.ts'] });
    unlinkSync(join(r.dir, 'src/a.ts'));
    expect((await r.check()).files['rules/r.md']).toMatchObject({ state: 'stale', changed: ['src/a.ts'] });
  });
});
