import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitMounts } from '../src/main/sandbox/gitView';

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: ENV, stdio: 'ignore' });

let root: string;
let clone: string;
let wt: string;
let work: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-gitview-'));
  clone = join(root, 'clone');
  wt = join(root, 'wt');
  work = join(root, 'stage');
  mkdirSync(clone);
  mkdirSync(work);
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'a\n');
  git(clone, 'add', '.');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
  git(clone, 'remote', 'add', 'origin', 'https://bot:hunter2@example.com/g/p.git');
  git(clone, 'config', 'core.fsmonitor', '/bin/evil');
  git(clone, 'worktree', 'add', '-q', '-b', 'work', wt);
  mkdirSync(join(wt, '.husky'));
  writeFileSync(join(wt, '.gitattributes'), '* text=auto\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('what a sandbox is given of a worktree', () => {
  it('binds the repository directory read-only, the pointer over itself, and replaces the config and the hooks', () => {
    const { binds } = gitMounts(wt, wt, work);
    const common = join(clone, '.git');
    expect(binds).toContainEqual([join(wt, '.git'), join(wt, '.git')]);
    expect(binds).toContainEqual([common, common]);
    const config = binds.find(([, dest]) => dest === join(common, 'config'));
    expect(config).toBeDefined();
    const text = readFileSync(config![0], 'utf8');
    expect(text).toContain('url = https://example.com/g/p.git');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('fsmonitor');
    expect(binds.find(([, dest]) => dest === join(common, 'hooks'))).toBeDefined();
  });

  it('binds read-only the files of the worktree that make git or a package manager run code, when they exist', () => {
    const dests = gitMounts(wt, wt, work).binds.map(([, d]) => d);
    expect(dests).toContain(join(wt, '.husky'));
    expect(dests).toContain(join(wt, '.gitattributes'));
    expect(dests).not.toContain(join(wt, '.githooks'));
  });

  it('takes those files from the copy when the sandbox mounts one, and the pointer from the real worktree', () => {
    const copy = join(root, 'copy');
    mkdirSync(join(copy, '.husky'), { recursive: true });
    const { binds } = gitMounts(wt, copy, work);
    expect(binds).toContainEqual([join(copy, '.husky'), join(wt, '.husky')]);
    expect(binds).toContainEqual([join(wt, '.git'), join(wt, '.git')]);
  });

  it('binds a clone\'s own .git folder over itself and cleans its config', () => {
    const { binds } = gitMounts(clone, clone, work);
    expect(binds).toContainEqual([join(clone, '.git'), join(clone, '.git')]);
    expect(binds.find(([, dest]) => dest === join(clone, '.git', 'config'))).toBeDefined();
  });

  it('has nothing to bind where there is no repository', () => {
    expect(gitMounts(join(root, 'nowhere'), join(root, 'nowhere'), work).binds).toEqual([]);
  });
});
