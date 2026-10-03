// Runs a real `bwrap`, only where it exists and works, with harmless commands in a temporary folder. Never uses the network.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { createSandboxService } from '../src/main/sandbox';
import { probeSandbox } from '../src/main/sandbox/probe';
import type { SandboxService } from '../src/main/sandbox';


const status = await probeSandbox();
const maybe = status.available ? describe : describe.skip;

let root: string;
let worktree: string;
let service: SandboxService;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-bwrap-'));
  const clone = join(root, 'clone');
  worktree = join(root, 'wt');
  mkdirSync(clone);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'a\n');
  git(clone, 'add', '.');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
  // A token in a remote address, which a sandbox must never see.
  git(clone, 'remote', 'add', 'origin', 'https://user:s3cr3t-value@example.com/group/project.git');
  git(clone, 'worktree', 'add', '-q', '-b', 'work', worktree);
  service = createSandboxService({ dir: join(root, 'sandbox'), protect: [root] });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

maybe('a real sandbox', () => {
  const open = (reader = false) => service.open({ worktree, reader, config: neutralSandbox() });

  it('runs a command in the worktree, keeps its files, and cannot write anywhere else', async () => {
    const s = await open();
    try {
      const r = await s.exec('pwd; echo made > made.txt; echo x > /usr/nope 2>&1; echo "usr=$?"; echo y > /etc/nope 2>&1; echo "etc=$?"');
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain(worktree);
      expect(r.output).toMatch(/usr=[1-9]/);
      expect(r.output).toMatch(/etc=[1-9]/);
      expect(readFileSync(join(worktree, 'made.txt'), 'utf8')).toBe('made\n');
    } finally {
      await s.close();
    }
  });

  it('has no home folder, an environment of its own, and no network but its loopback', async () => {
    process.env.COXIA_TEST_SECRET = 'must-not-pass';
    const s = await open();
    try {
      const r = await s.exec(`ls ${homedir()} 2>&1 | head -3; echo "home=$HOME"; env | sort; tail -n +3 /proc/net/dev | cut -d: -f1`);
      expect(r.output).toContain('home=/home/sandbox');
      expect(r.output).not.toContain('COXIA_TEST_SECRET');
      expect(r.output).not.toContain('must-not-pass');
      expect(r.output).not.toMatch(/^\s*(eth|en|wl)\S*$/m);
      expect(r.output).toMatch(/^\s*lo$/m);
      expect(r.output).not.toContain(root.split('/').slice(0, 3).join('/') + '/clone/a.txt');
    } finally {
      delete process.env.COXIA_TEST_SECRET;
      await s.close();
    }
  });

  it('cannot change .git, and reads a repository config without the credential', async () => {
    const s = await open();
    try {
      const r = await s.exec('echo "gitdir: /elsewhere" > .git 2>&1; echo "write=$?"; git config --get remote.origin.url; git log --oneline | head -1; cat "$(sed -n "s/^gitdir: //p" .git)/../../config" 2>&1 | grep -c s3cr3t');
      expect(r.output).toMatch(/write=[1-9]/);
      expect(r.output).toContain('https://example.com/group/project.git');
      expect(r.output).not.toContain('s3cr3t-value');
      expect(readFileSync(join(worktree, '.git'), 'utf8')).toMatch(/^gitdir: .*worktrees/);
    } finally {
      await s.close();
    }
  });

  it('keeps a process started by one command for the next, and ends it with the stage', async () => {
    // A duration no other command line has, so the search finds only this sandbox's process.
    const seconds = 30_000 + Math.floor(Math.random() * 9_000);
    const alive = (): boolean => {
      try {
        return execFileSync('pgrep', ['-f', `^sleep ${seconds}$`], { stdio: 'pipe' }).toString().trim().length > 0;
      } catch {
        return false;
      }
    };
    const s = await open();
    const a = await s.exec(`sleep ${seconds} & echo $! > bg.pid; echo started`);
    expect(a.output).toContain('started');
    const b = await s.exec('kill -0 "$(cat bg.pid)" && echo alive');
    expect(b.output).toContain('alive');
    expect(alive()).toBe(true);
    await s.close();
    // It lived in the sandbox's own process namespace, which ended with the stage (the kernel takes a moment to reap it).
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive()).toBe(false);
  });

  it('stops a command that runs too long and tells so', async () => {
    const config = neutralSandbox();
    config.limits.commandMs = 5_000;
    const s = await service.open({ worktree, reader: false, config });
    try {
      const r = await s.exec('sleep 60');
      expect(r.timedOut).toBe(true);
      expect(r.ms).toBeLessThan(15_000);
    } finally {
      await s.close();
    }
  }, 30_000);

  it('gives a reader a copy: what it writes never reaches the worktree', async () => {
    const s = await open(true);
    try {
      const r = await s.exec('cat a.txt; echo copy > only-in-the-copy.txt; ls');
      expect(r.output).toContain('only-in-the-copy.txt');
    } finally {
      await s.close();
    }
    expect(existsSync(join(worktree, 'only-in-the-copy.txt'))).toBe(false);
  });
});
