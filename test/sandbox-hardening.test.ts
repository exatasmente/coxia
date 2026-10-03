// What a hostile command can leave behind for the app to read or mount, and the limits of what it is given: the findings of the security review of #30, one test each.
// The ones that need a real `bwrap` run only where it works; the rest need no sandbox.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { readOnlyPathProblem } from '../src/shared/sandboxPaths';
import { SandboxError, assertBindsSafe, createSandboxService, holdsRepository } from '../src/main/sandbox';
import { gitMounts } from '../src/main/sandbox/gitView';
import { bwrapArgs } from '../src/main/sandbox/policy';
import { probeSandbox } from '../src/main/sandbox/probe';
import { readTailNoFollow } from '../src/main/sandbox/session';
import { copyTree } from '../src/main/sandbox/copy';
import type { SandboxService } from '../src/main/sandbox';

const status = await probeSandbox();
const real = status.available ? describe : describe.skip;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });

let root: string;
let clone: string;
let secret: string;
const worktree = (name: string): string => {
  const wt = join(root, name);
  git(clone, 'worktree', 'add', '-q', '-b', `b-${name}`, wt);
  return wt;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-harden-'));
  clone = join(root, 'clone');
  mkdirSync(clone);
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'a\n');
  git(clone, 'add', '.');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
  secret = join(root, 'HOST-SECRET.txt');
  writeFileSync(secret, 'TOP-SECRET-HOST-CONTENT-12345\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('B1: what the app reads of a command\'s output', () => {
  it('reads a plain file, and nothing at all through a link or from a pipe', () => {
    const dir = mkdtempSync(join(root, 'out-'));
    writeFileSync(join(dir, 'plain'), 'hello\nworld\n');
    symlinkSync(secret, join(dir, 'link'));
    execFileSync('mkfifo', [join(dir, 'pipe')]);
    expect(readTailNoFollow(join(dir, 'plain'), 5)).toBe('orld\n');
    expect(readTailNoFollow(join(dir, 'link'), 1000)).toBeNull();
    // A pipe nobody writes to: opening it for reading without waiting is what keeps the app from hanging on it.
    const started = Date.now();
    expect(readTailNoFollow(join(dir, 'pipe'), 1000)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(readTailNoFollow(join(dir, 'missing'), 1000)).toBeNull();
    expect(readTailNoFollow(dir, 1000)).toBeNull();
  });
});

real('B1 and B2, in a real sandbox', () => {
  let service: SandboxService;
  beforeAll(() => {
    service = createSandboxService({ dir: join(root, 'sandbox'), protect: [root] });
  });
  const open = (wt: string, reader = false) => service.open({ worktree: wt, reader, config: neutralSandbox() });

  it('B1: a link planted as the output of the next command reaches no prompt, and a pipe does not hang the app', async () => {
    const wt = worktree('b1');
    const config = neutralSandbox();
    config.limits.commandMs = 5_000;
    const s = await service.open({ worktree: wt, reader: false, config });
    try {
      await s.exec(`ln -s ${secret} /coxia/out/out.2; mkfifo /coxia/out/out.3; echo planted`);
      const linked = await s.exec('echo hello');
      expect(linked.output).not.toContain('TOP-SECRET');
      expect(linked.outputUnavailable).toBe(true);
      const started = Date.now();
      // Its output file is a pipe nobody reads: the command cannot even start writing, the time limit ends it, and the app reads nothing.
      const piped = await s.exec('echo again');
      expect(piped.outputUnavailable).toBe(true);
      expect(piped.timedOut).toBe(true);
      expect(Date.now() - started).toBeLessThan(20_000);
      // The sandbox goes on working after both.
      expect((await s.exec('echo fine')).output).toBe('fine');
    } finally {
      await s.close();
    }
  }, 60_000);

  it.each([false, true])('B2: a link where a file that runs code should be refuses the sandbox, and shares no folder of this computer (reader=%s)', async (reader) => {
    const wt = worktree(`b2-${reader}`);
    symlinkSync('../..', join(wt, '.husky'));
    await expect(open(wt, reader)).rejects.toBeInstanceOf(SandboxError);
    await expect(open(wt, reader)).rejects.toThrow(/\.husky.*symbolic link|link simbólico/);
    // Nothing of the sandbox was left behind.
    expect(existsSync(join(root, 'sandbox')) ? execFileSync('ls', [join(root, 'sandbox')]).toString().trim() : '').toBe('');
  }, 60_000);

  it('S1: /dev cannot be written to, and /dev/shm is capped like /tmp', async () => {
    const wt = worktree('s1');
    const s = await open(wt);
    try {
      const r = await s.exec('echo x > /dev/foo 2>/dev/null; echo "dev=$?"; df -k /dev/shm | tail -1');
      expect(r.output).toMatch(/dev=[1-9]/);
      expect(r.output).toContain('524288');
    } finally {
      await s.close();
    }
  }, 60_000);
});

describe('B2: the binds', () => {
  it('refuse a link at any of the files that run code, and at .git, in the worktree or in its copy', () => {
    const wt = worktree('b2-unit');
    symlinkSync('../..', join(wt, '.githooks'));
    expect(() => gitMounts(wt, wt, mkdtempSync(join(root, 'w-')))).toThrow(SandboxError);
    rmSync(join(wt, '.githooks'));
    symlinkSync(secret, join(wt, '.gitattributes'));
    expect(() => gitMounts(wt, wt, mkdtempSync(join(root, 'w-')))).toThrow(SandboxError);
    rmSync(join(wt, '.gitattributes'));
    // A pipe or a socket in that place is not bound (and is not an error).
    execFileSync('mkfifo', [join(wt, '.gitmodules')]);
    expect(gitMounts(wt, wt, mkdtempSync(join(root, 'w-'))).binds.map(([, d]) => d)).not.toContain(join(wt, '.gitmodules'));
    // .git itself is the app's: a link in its place is refused.
    const linked = join(root, 'wt-linked-git');
    mkdirSync(linked);
    symlinkSync(join(clone, '.git'), join(linked, '.git'));
    expect(() => gitMounts(linked, linked, mkdtempSync(join(root, 'w-')))).toThrow(SandboxError);
  });

  it('are checked once more before the sandbox is built: no link inside the worktree on either side, and outside it a path that is its own real path', () => {
    const wt = worktree('assert');
    symlinkSync('../..', join(wt, '.husky'));
    expect(() => assertBindsSafe([[join(wt, '.husky'), join(wt, '.husky')]], wt, wt)).toThrow(SandboxError);
    expect(() => assertBindsSafe([[join(wt, 'x'), join(wt, '.husky')]], wt, wt)).toThrow(SandboxError);
    expect(() => assertBindsSafe([[join(wt, 'nothing'), join(wt, 'nothing')]], wt, wt)).not.toThrow();
    const alias = join(root, 'alias');
    symlinkSync(clone, alias);
    expect(() => assertBindsSafe([[alias, alias]], wt, wt)).toThrow(SandboxError);
    expect(() => assertBindsSafe([[join(clone, '.git'), join(clone, '.git')]], wt, wt)).not.toThrow();
    expect(() => assertBindsSafe([[join(root, 'gone'), join(root, 'gone')]], wt, wt)).toThrow(SandboxError);
  });
});

describe('S1: the argument list', () => {
  it('makes /dev read-only after it is made, and gives /dev/shm and /tmp a size', () => {
    const a = bwrapArgs({ worktree: '/w', tree: null, stageDir: '/s', system: { roDirs: ['/usr'], links: [] }, roBinds: [], pathDirs: [], network: 'off', limits: neutralSandbox().limits, tmpMb: 64 });
    const at = (flag: string, arg: string) => a.findIndex((x, i) => x === flag && a[i + 1] === arg);
    expect(at('--dev', '/dev')).toBeGreaterThan(-1);
    expect(at('--tmpfs', '/dev/shm')).toBeGreaterThan(at('--dev', '/dev'));
    expect(at('--remount-ro', '/dev')).toBeGreaterThan(at('--tmpfs', '/dev/shm'));
    expect(a[at('--tmpfs', '/dev/shm') - 2]).toBe('--size');
    expect(a[at('--tmpfs', '/tmp') - 2]).toBe('--size');
  });
});

describe('N6: the copy of a tree', () => {
  it('keeps a link as a link without following it out, and copies a file whose name looks like an option', async () => {
    const from = mkdtempSync(join(root, 'from-'));
    writeFileSync(join(from, '-rf'), 'odd name');
    symlinkSync(secret, join(from, 'out'));
    symlinkSync('../..', join(from, 'up'));
    mkdirSync(join(from, '.git'));
    const to = join(root, `to-${Date.now()}`);
    await copyTree(from, to, 1e6);
    expect(existsSync(join(to, '-rf'))).toBe(true);
    expect(execFileSync('readlink', [join(to, 'out')]).toString().trim()).toBe(secret);
    expect(existsSync(join(to, '.git'))).toBe(false);
  });
});

describe('N3: the system places a read-only folder cannot be', () => {
  it('refuses /proc, /sys, /dev, /run, /var (and what is under them) and /tmp', () => {
    for (const p of ['/proc', '/proc/1', '/sys/kernel', '/dev', '/dev/shm', '/run', '/run/user/1000', '/var', '/var/run', '/var/lib/docker', '/var/run/docker.sock', '/tmp', '/tmp/x']) expect(readOnlyPathProblem(p), p).toBe('secret');
    for (const p of ['/opt/node-v20', '/var2/tools', '/tmpx/tools', '/usr/local/node', '~/.nvm/versions/node/v20']) expect(readOnlyPathProblem(p), p).toBeNull();
  });
});

describe('N9: a listed folder that holds a repository', () => {
  it('is noticed when it is a repository or has one as a direct child, and not otherwise', () => {
    expect(holdsRepository(clone)).toBe(true);
    const parent = mkdtempSync(join(root, 'tools-'));
    mkdirSync(join(parent, 'nvm', '.git'), { recursive: true });
    expect(holdsRepository(parent)).toBe(true);
    const plain = mkdtempSync(join(root, 'plain-'));
    mkdirSync(join(plain, 'bin'));
    expect(holdsRepository(plain)).toBe(false);
    expect(holdsRepository(join(root, 'nowhere'))).toBe(false);
  });
});

describe('S4 and S5: what VcsRead reads and of which projects', () => {
  const mr = { project: 'acme/app', iid: 7, title: 'Fix it', state: 'open', draft: false, sourceBranch: 'b', targetBranch: 'main', sha: 'abc', webUrl: 'https://example.com/acme/app/pulls/7', author: 'ana', reviewers: [], approvals: null, ci: null, description: 'd'.repeat(2000) };
  const provider = (): never => ({ linkedMrs: async (project: string, iid: number) => (project === 'acme/app' && iid === 12 ? [mr] : []), getIssue: async () => ({ iid: 12 }) }) as never;

  it('S4: reads the merge or pull requests linked to an issue, with a cut description', async () => {
    const { runVcsRead, VCS_READ_OPS } = await import('../src/main/vcs/readTool');
    expect(VCS_READ_OPS).toContain('issue_linked_mrs');
    const out = JSON.parse(await runVcsRead(provider(), { op: 'issue_linked_mrs', project: 'acme/app', iid: 12 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ iid: 7, title: 'Fix it' });
    expect(out[0].description.length).toBeLessThan(500);
    expect(JSON.parse(await runVcsRead(provider(), { op: 'issue_linked_mrs', project: 'acme/app', iid: 99 }))).toEqual([]);
  });

  it('S5: refuses a project that is not one of the workspace\'s, whatever the case, and says which are', async () => {
    const { runVcsRead, projectAllowed } = await import('../src/main/vcs/readTool');
    const allowed = ['acme/app', 'acme/Lib'];
    await expect(runVcsRead(provider(), { op: 'issue', project: 'other/private', iid: 1 }, allowed)).rejects.toThrow(/other\/private.*acme\/app/s);
    await expect(runVcsRead(provider(), { op: 'issue_linked_mrs', project: 'acme/app', iid: 12 }, allowed)).resolves.toContain('Fix it');
    expect(projectAllowed('ACME/lib', allowed)).toBe(true);
    expect(projectAllowed('acme/app-secret', allowed)).toBe(false);
    // A workspace that names no project has no limit to apply to the ceremonies, as its cards are every project the host lists for the person...
    expect(projectAllowed('any/thing', [])).toBe(true);
    await expect(runVcsRead(provider(), { op: 'issue', project: 'any/thing', iid: 1 }, [])).resolves.toContain('12');
    // ...and nothing at all to a team agent of a run, which is told what to configure.
    expect(projectAllowed('any/thing', [], true)).toBe(false);
    await expect(runVcsRead(provider(), { op: 'issue', project: 'any/thing', iid: 1 }, [], true)).rejects.toThrow(/names no issue project and no repository project.*set the issue project or the repositories/s);
    await expect(runVcsRead(provider(), { op: 'issue', project: 'acme/app', iid: 1 }, ['acme/app'], true)).resolves.toContain('12');
  });

  it('S5: only the call of a team agent of a run is strict: the tool of the engines refuses it with no project, and the ceremonies\' call does not', async () => {
    const { vcsReadToolImpl } = await import('../src/main/vcs/engineTool');
    const ctx = { outputMax: 10_000 } as never;
    const run = vcsReadToolImpl(provider, () => [], true);
    const ceremony = vcsReadToolImpl(provider, () => []);
    await expect(run.run({ op: 'issue', project: 'x/y', iid: 1 }, ctx)).rejects.toThrow(/names no issue project/);
    const ok = await ceremony.run({ op: 'issue', project: 'x/y', iid: 1 }, ctx);
    expect(ok.render(ok.response)).toContain('12');
  });

  it('S5: the tool of the engines carries the limit, and the list is the issue project and the projects of the repositories', async () => {
    const { vcsReadToolImpl } = await import('../src/main/vcs/engineTool');
    const { workspaceProjects } = await import('../src/main/agents');
    const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
    const c = structuredClone(getConfig());
    c.projects.issues.project = 'acme/app';
    c.projects.repos = [{ id: 'lib', path: '/x', remoteUrl: null, vcsId: null, projectPath: 'acme/lib' }, { id: 'none', path: '/y', remoteUrl: null, vcsId: null, projectPath: null }] as never;
    saveConfig(c);
    expect(workspaceProjects()).toEqual(['acme/app', 'acme/lib']);
    const tool = vcsReadToolImpl(provider, workspaceProjects);
    const ctx = { outputMax: 10_000 } as never;
    await expect(tool.run({ op: 'issue', project: 'other/private', iid: 1 }, ctx)).rejects.toThrow(/not one of this workspace/);
    const ok = await tool.run({ op: 'issue_linked_mrs', project: 'acme/app', iid: 12 }, ctx);
    expect(ok.render(ok.response)).toContain('Fix it');
  });
});

describe('S2: the proxy under load', () => {
  it('holds only so many bare client sockets, and counts a tunnel from the moment its name is being looked up', async () => {
    const { connect } = await import('node:net');
    const { createRegistryProxy } = await import('../src/main/sandbox/proxy');
    const dir = mkdtempSync(join(root, 'proxy-'));
    const sock = join(dir, 'p.sock');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const decisions: string[] = [];
    const proxy = await createRegistryProxy({ socketPath: sock, hosts: ['registry.example.com'], maxConnections: 2, maxClients: 20, resolve: async () => (await gate, ['93.184.216.34']), onDecision: (d) => decisions.push(d.allowed ? 'ok' : d.why) });
    try {
      // Many bare connections: the proxy holds no more than its cap.
      const bare = Array.from({ length: 200 }, () => {
        const c = connect(sock);
        c.on('error', () => undefined);
        return c;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(bare.filter((c) => !c.destroyed && c.readyState === 'open').length).toBeLessThanOrEqual(20);
      bare.forEach((c) => c.destroy());
      await new Promise((r) => setTimeout(r, 200));
      // Requests whose lookup is still out already count against the tunnel cap.
      const answers: string[] = [];
      const asks = Array.from({ length: 5 }, () => {
        const c = connect(sock);
        c.on('error', () => undefined);
        c.on('connect', () => c.write('CONNECT registry.example.com:443 HTTP/1.1\r\n\r\n'));
        c.on('data', (d) => answers.push(String(d).split('\r\n')[0]));
        return c;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(answers.filter((a) => a.includes('429'))).toHaveLength(3);
      release();
      asks.forEach((c) => c.destroy());
    } finally {
      release();
      await proxy.close();
    }
    expect(decisions.filter((d) => d === 'limit')).toHaveLength(3);
  });
});

describe('N7: a template file that brings agents with powers', () => {
  it('says, before anything is applied, which agents may run commands or read the host', async () => {
    const { parseTemplate } = await import('../src/shared/cycles/apply');
    const check = parseTemplate({ id: 'mine', name: 'Mine', devCycle: {}, team: [
      { id: 'runner-one', name: 'R1', stages: [], permission: 'worktree', shell: 'sandbox', tracker: 'read' },
      { id: 'lister', name: 'L', stages: [], permission: 'worktree', shell: 'allowlist' },
      { id: 'quiet', name: 'Q', stages: [], permission: 'read' },
    ] });
    expect(check.ok).toBe(true);
    expect(check.powers).toEqual([{ agent: 'runner-one', shell: 'sandbox', tracker: 'read' }, { agent: 'lister', shell: 'allowlist', tracker: 'none' }]);
    const said = check.warnings.map((w) => `${w.path}: ${w.message}`).join('\n');
    expect(said).toMatch(/template\.team\[runner-one\]\.shell: the agent may run any command, inside a sandbox/);
    expect(said).toMatch(/template\.team\[runner-one\]\.tracker: the agent may read the code host \(never write\)/);
    expect(said).toMatch(/template\.team\[lister\]\.shell: .*outside any sandbox/);
    expect(said).not.toContain('quiet');
    expect(parseTemplate({ id: 'plain', name: 'P', devCycle: {} }).powers).toEqual([]);
  });
});

describe('N1: what the supervisor says without a line end', () => {
  it('is held to its end, so a process writing to the pipe for ever does not grow the app', async () => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    const { openSession } = await import('../src/main/sandbox/session');
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const child = new EventEmitter() as never as import('node:child_process').ChildProcess;
    Object.assign(child, { stdin, stdout, stderr: new PassThrough(), stdio: [stdin, stdout, new PassThrough(), new PassThrough()], pid: undefined, kill: () => { queueMicrotask(() => child.emit('exit', null, 'SIGKILL')); return true; } });
    setImmediate(() => stdout.write('ready\n'));
    const dir = mkdtempSync(join(root, 'n1-'));
    const session = await openSession({ stageDir: dir, args: [], limits: neutralSandbox().limits, proxy: false }, { spawn: () => child });
    for (let i = 0; i < 50; i++) stdout.write('x'.repeat(100_000));
    await new Promise((r) => setTimeout(r, 100));
    // A real answer after the noise still gets through: the noise was cut, not the protocol.
    const pending = session.exec('echo hi');
    await new Promise((r) => setTimeout(r, 50));
    const line = String(stdin.read());
    const [id, token] = line.trim().split(' ');
    stdout.write(`\ndone ${id} ${token} 0\n`);
    await expect(pending).resolves.toMatchObject({ exitCode: 0 });
    await session.close();
  });
});

describe('the removal of what a sandbox made (second review, 1)', () => {
  it('goes through folders a command made read-only, and never throws', async () => {
    const { removeTree } = await import('../src/main/sandbox/remove');
    const { chmodSync, writeFileSync: write, mkdirSync: mk } = await import('node:fs');
    const dir = mkdtempSync(join(root, 'rm-'));
    mk(join(dir, 'home', 'go', 'pkg', 'mod'), { recursive: true });
    write(join(dir, 'home', 'go', 'pkg', 'mod', 'x.go'), 'package x');
    symlinkSync(secret, join(dir, 'home', 'link-out'));
    chmodSync(join(dir, 'home', 'go', 'pkg', 'mod'), 0o500);
    chmodSync(join(dir, 'home', 'go', 'pkg'), 0o500);
    expect(removeTree(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
    // A link inside is removed as a link: what it pointed at is untouched.
    expect(existsSync(secret)).toBe(true);
    expect(removeTree(join(root, 'never-there'))).toBe(true);
  });
});

real('the stage folder, closed over read-only folders, and a data folder under a link', () => {
  const GO_CACHE = 'mkdir -p $HOME/go/pkg/mod/x && echo package > $HOME/go/pkg/mod/x/a.go && chmod -R a-w $HOME/go';
  it.each([false, true])('close() removes a stage whose home holds read-only folders, and the stage folder is gone (reader=%s)', async (reader) => {
    const dir = join(root, `sandbox-ro-${reader}`);
    const service = createSandboxService({ dir, protect: [root] });
    const wt = worktree(`ro-${reader}`);
    const s = await service.open({ worktree: wt, reader, config: neutralSandbox() });
    const r = await s.exec(reader ? `${GO_CACHE}; mkdir -p ro && echo x > ro/f && chmod a-w ro` : GO_CACHE);
    expect(r.exitCode).toBe(0);
    await expect(s.close()).resolves.toBeUndefined();
    expect(execFileSync('ls', [dir]).toString().trim()).toBe('');
    // A worktree the writer made read-only is the worktree's: it is not the app's to take away.
    expect(existsSync(wt)).toBe(true);
    execFileSync('chmod', ['-R', 'u+w', wt]);
  }, 60_000);

  it('works when the data folder is reached through a link (/home -> /var/home), where a comparison with the real path used to refuse every sandbox', async () => {
    const real = join(root, 'real-data');
    mkdirSync(real);
    const via = join(root, 'link-data');
    symlinkSync(real, via);
    const service = createSandboxService({ dir: join(via, 'sandbox'), protect: [root] });
    const s = await service.open({ worktree: worktree('linked'), reader: false, config: neutralSandbox() });
    try {
      expect((await s.exec('git log --oneline | head -1')).exitCode).toBe(0);
    } finally {
      await s.close();
    }
    expect(execFileSync('ls', [join(real, 'sandbox')]).toString().trim()).toBe('');
  }, 60_000);

  it('works when the worktree itself is reached through a link, and mounts it by its real path', async () => {
    const wt = worktree('real-wt');
    const via = join(root, 'link-wt');
    symlinkSync(wt, via);
    const service = createSandboxService({ dir: join(root, 'sandbox-wtlink'), protect: [root] });
    const s = await service.open({ worktree: via, reader: false, config: neutralSandbox() });
    try {
      const r = await s.exec('pwd; echo ok > made-via-link.txt');
      expect(r.output).toContain(wt);
    } finally {
      await s.close();
    }
    expect(existsSync(join(wt, 'made-via-link.txt'))).toBe(true);
  }, 60_000);
});

describe('the .git pointer is trusted only when it belongs to the worktree (N1)', () => {
  it('refuses a pointer whose directory does not name this worktree, and a common directory with no HEAD', () => {
    const wt = worktree('n1');
    const other = worktree('n1-other');
    // The pointer of one worktree copied into another: the directory it names says it belongs to the first.
    writeFileSync(join(wt, '.git'), execFileSync('cat', [join(other, '.git')]).toString());
    expect(() => gitMounts(wt, wt, mkdtempSync(join(root, 'w-')))).toThrow(SandboxError);
    const bare = mkdtempSync(join(root, 'nohead-'));
    mkdirSync(join(bare, '.git'));
    expect(() => gitMounts(bare, bare, mkdtempSync(join(root, 'w-')))).toThrow(SandboxError);
  });

  it('cleans the config of a submodule\'s repository, at any depth, like the main one', () => {
    const wt = worktree('n1-mod');
    const common = join(clone, '.git');
    const modules = join(common, 'modules', 'lib');
    mkdirSync(join(modules, 'modules', 'inner'), { recursive: true });
    writeFileSync(join(modules, 'config'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://bot:hunter2@example.com/g/lib.git\n');
    writeFileSync(join(modules, 'modules', 'inner', 'config'), '[remote "origin"]\n\turl = https://bot:hunter3@example.com/g/inner.git\n');
    try {
      const { binds } = gitMounts(wt, wt, mkdtempSync(join(root, 'w-')));
      const cleaned = binds.filter(([, d]) => d.startsWith(join(common, 'modules')));
      expect(cleaned.map(([, d]) => d).sort()).toEqual([join(modules, 'config'), join(modules, 'modules', 'inner', 'config')].sort());
      for (const [src] of cleaned) expect(execFileSync('cat', [src]).toString()).not.toMatch(/hunter/);
    } finally {
      rmSync(join(common, 'modules'), { recursive: true, force: true });
    }
  });
});

describe('the copy (N2)', () => {
  it('fails with one error that names no path of this computer, and stops on abort', async () => {
    const dir = mkdtempSync(join(root, 'c-'));
    const gone = join(dir, 'nowhere');
    const err = await copyTree(gone, join(dir, 'to'), 1e6).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SandboxError);
    expect((err as SandboxError).code).toBe('copy-failed');
    expect((err as Error).message).not.toContain(dir);
    const from = mkdtempSync(join(root, 'cf-'));
    writeFileSync(join(from, 'a'), 'a');
    const stop = new AbortController();
    stop.abort();
    await expect(copyTree(from, join(dir, 'to2'), 1e6, stop.signal)).rejects.toMatchObject({ code: 'copy-failed' });
  });
});

describe('N3, N5, N6: what the reads, the main bind and the evidence count', () => {
  it('N3: the merge requests an issue links to are shown only for the allowed projects', async () => {
    const { runVcsRead } = await import('../src/main/vcs/readTool');
    const mk = (project: string, iid: number) => ({ project, iid, title: `t${iid}`, state: 'open', draft: false, sourceBranch: 'b', targetBranch: 'main', sha: 's', webUrl: 'u', author: 'a', reviewers: [], approvals: null, ci: null, description: '' });
    const provider = { linkedMrs: async () => [mk('acme/app', 1), mk('other/private', 2)] } as never;
    const out = JSON.parse(await runVcsRead(provider, { op: 'issue_linked_mrs', project: 'acme/app', iid: 9 }, ['acme/app'], true));
    expect(out.map((m: { iid: number }) => m.iid)).toEqual([1]);
    expect(JSON.parse(await runVcsRead(provider, { op: 'issue_linked_mrs', project: 'acme/app', iid: 9 })).map((m: { iid: number }) => m.iid)).toEqual([1, 2]);
  });

  it('N5: the main bind must be a real folder at its own real path', () => {
    const wt = worktree('n5');
    const alias = join(root, 'n5-alias');
    symlinkSync(wt, alias);
    expect(() => assertBindsSafe([], alias, alias)).toThrow(SandboxError);
    expect(() => assertBindsSafe([], join(wt, 'a.txt'), join(wt, 'a.txt'))).toThrow(SandboxError);
    expect(() => assertBindsSafe([], join(root, 'absent'), join(root, 'absent'))).toThrow(SandboxError);
    expect(() => assertBindsSafe([], wt, wt)).not.toThrow();
  });

  it('N6: only a command the agent ran backs an executed claim; the app\'s own commands do not', async () => {
    const { backEvidence } = await import('../src/shared/runs');
    const log = [{ n: 1, exitCode: 0, timedOut: false, by: 'app' as const }, { n: 2, exitCode: 0, timedOut: false, by: 'agent' as const }];
    const s = (commands: number[]) => ({ name: 'x', result: 'pass' as const, detail: '', evidence: 'executed' as const, commands });
    expect(backEvidence([s([1])], log, true)[0]).toMatchObject({ evidence: 'read', unbacked: true });
    expect(backEvidence([s([1, 2])], log, true)[0]).toMatchObject({ evidence: 'executed', commands: [2] });
  });
});
