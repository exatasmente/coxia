import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyTracked, copyTree, treeSize } from '../src/main/sandbox/copy';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-copy-'));
  mkdirSync(join(root, 'from/src'), { recursive: true });
  mkdirSync(join(root, 'from/.git'));
  writeFileSync(join(root, 'from/.git/config'), 'secret');
  writeFileSync(join(root, 'from/src/a.ts'), 'export const a = 1;\n');
  symlinkSync('/etc/hostname', join(root, 'from/outside'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the copy of a tree', () => {
  it('copies files and folders, keeps a link as a link, and leaves .git out', async () => {
    await copyTree(join(root, 'from'), join(root, 'to'), 1e6);
    expect(readFileSync(join(root, 'to/src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(lstatSync(join(root, 'to/outside')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, 'to/outside'))).toBe('/etc/hostname');
    expect(existsSync(join(root, 'to/.git'))).toBe(false);
  });

  it('measures files only, without following a link', async () => {
    expect(await treeSize(join(root, 'from'))).toBe('export const a = 1;\n'.length);
  });

  it('refuses a tree over the limit before copying anything', async () => {
    await expect(copyTree(join(root, 'from'), join(root, 'to'), 5)).rejects.toThrow(/too large|grande demais/);
    expect(existsSync(join(root, 'to'))).toBe(false);
  });
});

describe('the copy of what git knows', () => {
  const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });

  it('takes the tracked files and the new ones that are not ignored, as they are now, and leaves what is built or installed', async () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\ndist/\n');
    writeFileSync(join(repo, 'src/a.ts'), 'committed\n');
    writeFileSync(join(repo, 'src/gone.ts'), 'deleted later\n');
    symlinkSync('src/a.ts', join(repo, 'link.ts'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '.');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
    writeFileSync(join(repo, 'src/a.ts'), 'changed, not committed\n');
    writeFileSync(join(repo, 'src/new.ts'), 'new\n');
    rmSync(join(repo, 'src/gone.ts'));
    mkdirSync(join(repo, 'node_modules/big'), { recursive: true });
    writeFileSync(join(repo, 'node_modules/big/index.js'), 'x'.repeat(4096));
    mkdirSync(join(repo, 'dist'));
    writeFileSync(join(repo, 'dist/app.AppImage'), 'x'.repeat(4096));
    const to = join(root, 'copy');
    // The limit counts only what is copied: the ignored folders weigh more than it.
    await copyTracked(repo, to, 1024, undefined);
    expect(readFileSync(join(to, 'src/a.ts'), 'utf8')).toBe('changed, not committed\n');
    expect(readFileSync(join(to, 'src/new.ts'), 'utf8')).toBe('new\n');
    expect(existsSync(join(to, 'src/gone.ts'))).toBe(false);
    expect(lstatSync(join(to, 'link.ts')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(to, 'link.ts'))).toBe('src/a.ts');
    expect(existsSync(join(to, 'node_modules'))).toBe(false);
    expect(existsSync(join(to, 'dist'))).toBe(false);
    expect(existsSync(join(to, '.git'))).toBe(false);
  });

  it('refuses before copying anything when what git knows is over the limit, and copies a folder git cannot list whole', async () => {
    const repo = join(root, 'repo2');
    mkdirSync(repo);
    writeFileSync(join(repo, 'big.txt'), 'x'.repeat(4096));
    git(repo, 'init', '-q', '-b', 'main');
    await expect(copyTracked(repo, join(root, 'too-big'), 1024, undefined)).rejects.toThrow();
    expect(existsSync(join(root, 'too-big'))).toBe(false);
    await copyTracked(join(root, 'from'), join(root, 'plain'), 1024 * 1024, undefined);
    expect(readFileSync(join(root, 'plain/src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });
});
