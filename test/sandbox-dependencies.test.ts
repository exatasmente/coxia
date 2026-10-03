// The dependency folders the runner links into a worktree (node_modules, .venv) and the sandbox: shared read-only at their own path when the link leads into the run's clone,
// left dangling and said when it leads anywhere else. A reader's copy keeps the links as links.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { type SandboxNote, createSandboxService } from '../src/main/sandbox';
import { dependencyBinds } from '../src/main/sandbox/dependencies';
import { probeSandbox } from '../src/main/sandbox/probe';
import { linkDependencies } from '../src/main/runner/dependencies';

const status = await probeSandbox();
const real = status.available ? describe : describe.skip;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });

let root: string;
let clone: string;
let elsewhere: string;
const worktree = async (name: string): Promise<string> => {
  const wt = join(root, name);
  git(clone, 'worktree', 'add', '-q', '-b', `b-${name}`, wt);
  await linkDependencies(clone, wt);
  return wt;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-deps-'));
  clone = join(root, 'clone');
  mkdirSync(clone);
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, '.gitignore'), 'node_modules/\n.venv/\n');
  writeFileSync(join(clone, 'a.txt'), 'a\n');
  git(clone, 'add', '.');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
  mkdirSync(join(clone, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(clone, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  elsewhere = mkdtempSync(join(root, 'else-'));
  writeFileSync(join(elsewhere, 'secret.txt'), 'NOT-FOR-THE-SANDBOX\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('which dependency links a sandbox shares', () => {
  it('shares, read-only at the link\'s own path, a folder the link leads to inside the clone', async () => {
    const wt = await worktree('dep-ok');
    const r = dependencyBinds(wt, wt, clone);
    expect(r.outside).toEqual([]);
    expect(r.binds).toEqual([[join(clone, 'node_modules'), join(clone, 'node_modules')]]);
  });

  it('leaves a link that leads outside the clone dangling, and says which', async () => {
    const wt = await worktree('dep-out');
    rmSync(join(wt, 'node_modules'));
    symlinkSync(elsewhere, join(wt, 'node_modules'));
    expect(dependencyBinds(wt, wt, clone)).toEqual({ binds: [], outside: ['node_modules'] });
  });

  it('does the same for a link that leads into the worktree itself, to the clone\'s root, or nowhere', async () => {
    const wt = await worktree('dep-odd');
    rmSync(join(wt, 'node_modules'));
    mkdirSync(join(wt, 'vendor'));
    symlinkSync(join(wt, 'vendor'), join(wt, 'node_modules'));
    expect(dependencyBinds(wt, wt, clone).outside).toEqual(['node_modules']);
    rmSync(join(wt, 'node_modules'));
    symlinkSync(clone, join(wt, 'node_modules'));
    expect(dependencyBinds(wt, wt, clone).outside).toEqual(['node_modules']);
    rmSync(join(wt, 'node_modules'));
    symlinkSync(join(root, 'absent'), join(wt, 'node_modules'));
    expect(dependencyBinds(wt, wt, clone).outside).toEqual(['node_modules']);
  });

  it('ignores a dependency folder that is a real folder of the worktree (nothing is linked, nothing is shared)', async () => {
    const wt = await worktree('dep-real');
    rmSync(join(wt, 'node_modules'));
    mkdirSync(join(wt, 'node_modules'));
    expect(dependencyBinds(wt, wt, clone)).toEqual({ binds: [], outside: [] });
  });
});

real('in a real sandbox', () => {
  const service = () => createSandboxService({ dir: join(root, 'sandbox'), protect: [root] });
  it.each([false, true])('a writer and a reader\'s copy read the linked dependencies, and cannot change them (reader=%s)', async (reader) => {
    const wt = await worktree(`dep-box-${reader}`);
    const s = await service().open({ worktree: wt, reader, config: neutralSandbox() });
    try {
      const r = await s.exec('cat node_modules/pkg/index.js; echo x > node_modules/pkg/new.js 2>/dev/null; echo "write=$?"; rm -rf node_modules/pkg 2>/dev/null; echo "rm=$?"; ls node_modules');
      expect(r.output).toContain('module.exports = 1;');
      expect(r.output).toMatch(/write=[1-9]/);
      expect(r.output).toMatch(/rm=[1-9]/);
      expect(r.output).toContain('pkg');
    } finally {
      await s.close();
    }
    expect(execFileSync('ls', [join(clone, 'node_modules', 'pkg')]).toString()).toContain('index.js');
  }, 60_000);

  it('does not share a link that leads elsewhere: the folder is not there for the agent, and the thread is told', async () => {
    const wt = await worktree('dep-box-out');
    rmSync(join(wt, 'node_modules'));
    symlinkSync(elsewhere, join(wt, 'node_modules'));
    const notes: SandboxNote[] = [];
    const s = await service().open({ worktree: wt, reader: false, config: neutralSandbox(), onNote: (n) => notes.push(n) });
    try {
      const r = await s.exec(`ls node_modules 2>&1; cat ${join(elsewhere, 'secret.txt')} 2>&1`);
      expect(r.output).not.toContain('NOT-FOR-THE-SANDBOX');
    } finally {
      await s.close();
    }
    expect(notes).toEqual([{ code: 'runner.sandbox.depsOutside', params: { name: 'node_modules' } }]);
  }, 60_000);
});
