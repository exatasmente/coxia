import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SdkEvent } from '../src/shared/wizard';
import { SDK_PKG, SDK_RANGE, clearProgress, fallbackVcsProbe, fsScanDeps, installSdk, installedVersion, normalizeTemplates, normalizeVcsProbe, placeholderTemplates, readProgress, scanDocsFallback, scanRepos, vcsUserRequest, writeProgress } from '../src/main/wizard-core';

const tmp = () => mkdtempSync(join(tmpdir(), 'coxia-wizard-'));

function repo(dir: string, remote?: string): void {
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'config'), `[core]\n\tbare = false\n${remote ? `[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n` : ''}`);
}

describe('wizard progress file', () => {
  it('round-trips, resumes and clears', () => {
    const dir = tmp();
    expect(readProgress(dir).step).toBe('language');
    const saved = writeProgress(dir, { step: 'projects', done: ['language', 'models'], skipped: ['sdk'] }, new Date('2026-10-02T10:00:00Z'));
    expect(saved.updatedAt).toBe('2026-10-02T10:00:00.000Z');
    expect(readProgress(dir)).toEqual(saved);
    writeFileSync(join(dir, 'wizard.json'), '{broken');
    expect(readProgress(dir).step).toBe('language');
    clearProgress(dir);
    expect(readProgress(dir).done).toEqual([]);
  });
});

describe('scanRepos', () => {
  it('finds checkouts two levels down with their remotes, ids and shrunk paths, skipping vendor folders', () => {
    const home = tmp();
    const root = join(home, 'work');
    repo(join(root, 'api'), 'git@gitlab.example.com:team/api.git');
    repo(join(root, 'group', 'web'), 'https://github.com/acme/web.git');
    repo(join(root, 'local-only'));
    repo(join(root, 'node_modules', 'dep'), 'https://github.com/x/y.git');
    repo(join(root, '.hidden'), 'https://github.com/x/z.git');
    mkdirSync(join(root, 'docs'), { recursive: true });
    const repos = scanRepos(['~/work'], fsScanDeps(home));
    expect(repos.map((r) => r.id).sort()).toEqual(['api', 'local-only', 'web']);
    const api = repos.find((r) => r.id === 'api');
    expect(api).toMatchObject({ path: '~/work/api', host: 'gitlab.example.com', projectPath: 'team/api', kind: 'gitlab' });
    expect(repos.find((r) => r.id === 'web')?.kind).toBe('github');
    expect(repos.find((r) => r.id === 'local-only')).toMatchObject({ remoteUrl: null, host: null });
  });

  it('treats a folder that is itself a checkout as one repo, and reads a linked worktree through commondir', () => {
    const home = tmp();
    repo(join(home, 'solo'), 'git@github.com:a/b.git');
    expect(scanRepos([join(home, 'solo')], fsScanDeps(home)).map((r) => r.path)).toEqual(['~/solo']);

    const main = join(home, 'main');
    repo(main, 'git@github.com:a/main.git');
    mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
    const wt = join(home, 'wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`);
    const found = scanRepos([wt], fsScanDeps(home));
    expect(found[0]).toMatchObject({ projectPath: 'a/main' });
  });

  it('makes ids unique and valid, and ignores a missing root', () => {
    const home = tmp();
    repo(join(home, 'r', 'a', 'app'));
    repo(join(home, 'r', 'b', 'app'));
    repo(join(home, 'r', '_x'));
    const ids = scanRepos([join(home, 'r'), join(home, 'nope')], fsScanDeps(home)).map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9_-]{0,47}$/);
  });
});

describe('scanDocsFallback', () => {
  it('finds CLAUDE.md, .claude folders and .mcp.json in the projects and in ~/.claude', () => {
    const home = tmp();
    const proj = join(home, 'p');
    mkdirSync(join(proj, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(proj, '.claude', 'rules'), { recursive: true });
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(proj, 'CLAUDE.md'), '# x');
    writeFileSync(join(proj, '.mcp.json'), '{}');
    writeFileSync(join(home, '.claude.json'), '{}');
    const found = scanDocsFallback([proj, join(home, 'empty')], { home, exists: (p) => fsScanDeps(home).exists(p) });
    expect(found.claudeMdRoots).toEqual(['~/p']);
    expect(found.skillsDirs).toEqual(['~/p/.claude/skills']);
    expect(found.rulesDirs).toEqual(['~/p/.claude/rules']);
    expect(found.agentsDirs).toEqual(['~/.claude/agents']);
    expect(found.mcpConfigFiles).toEqual(['~/p/.mcp.json', '~/.claude.json']);
    expect(found.knowledgeDirs).toEqual([]);
  });
});

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };

describe('installSdk', () => {
  function fakeNpm(script: (child: FakeChild, cwd: string) => void) {
    const calls: { args: string[]; cwd: string }[] = [];
    const spawnNpm = (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill() {
          this.emit('close', null);
        },
      }) as FakeChild;
      queueMicrotask(() => script(child, cwd));
      return child as never;
    };
    return { calls, spawnNpm };
  }

  const place = (cwd: string, version: string) => {
    const dir = join(cwd, 'node_modules', SDK_PKG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: SDK_PKG, version }));
  };

  it('installs into its own package, streams the log and reports the version', async () => {
    const dir = join(tmp(), 'claude-sdk');
    const events: SdkEvent[] = [];
    const npm = fakeNpm((child, cwd) => {
      child.stderr.emit('data', Buffer.from('npm http fetch GET 200 https://registry.npmjs.org/x 12ms\n'));
      place(cwd, '0.3.290');
      child.emit('close', 0);
    });
    await installSdk(dir, { spawnNpm: npm.spawnNpm, emit: (e) => events.push(e), readVersion: installedVersion }).done;
    expect(npm.calls[0].args).toEqual(['install', `${SDK_PKG}@${SDK_RANGE}`, '--no-audit', '--no-fund', '--loglevel=http']);
    expect(npm.calls[0].cwd).toBe(dir);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toMatchObject({ private: true });
    expect(events.map((e) => e.phase)).toEqual(['start', 'log', 'done']);
    expect(events[1]).toEqual({ phase: 'log', line: 'fetch GET 200 https://registry.npmjs.org/x 12ms' });
    expect(events[2]).toEqual({ phase: 'done', version: '0.3.290', path: dir });
  });

  it('reports npm missing, a failed install with its last lines, and a package that did not land', async () => {
    const run = async (script: (child: FakeChild, cwd: string) => void) => {
      const events: SdkEvent[] = [];
      await installSdk(join(tmp(), 'd'), { spawnNpm: fakeNpm(script).spawnNpm, emit: (e) => events.push(e), readVersion: installedVersion }).done;
      return events[events.length - 1];
    };
    expect(await run((child) => child.emit('error', Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' })))).toEqual({ phase: 'error', message: 'npm-missing' });
    const failed = await run((child) => {
      child.stderr.emit('data', 'npm error code E404\nnpm error 404 not found\n');
      child.emit('close', 1);
    });
    expect(failed).toMatchObject({ phase: 'error' });
    expect((failed as { message: string }).message).toContain('404 not found');
    expect(await run((child) => child.emit('close', 0))).toEqual({ phase: 'error', message: 'installed-but-missing' });
  });

  it('cancel kills npm and reports cancelled, not an error', async () => {
    const events: SdkEvent[] = [];
    const npm = fakeNpm(() => undefined);
    const run = installSdk(join(tmp(), 'd'), { spawnNpm: npm.spawnNpm, emit: (e) => events.push(e), readVersion: installedVersion });
    await new Promise((r) => setTimeout(r, 20));
    run.cancel();
    await run.done;
    expect(events[events.length - 1]).toEqual({ phase: 'cancelled' });
  });

  it('pins the SDK range the app was built against', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies[SDK_PKG]).toBe(SDK_RANGE);
  });
});

describe('minimal VCS call', () => {
  it('builds the user request per provider, including a GitHub Enterprise host', () => {
    expect(vcsUserRequest({ kind: 'gitlab', host: 'git.example.com', apiUrl: '', user: '' }, 't')).toEqual({ url: 'https://git.example.com/api/v4/user', headers: expect.objectContaining({ 'PRIVATE-TOKEN': 't' }) });
    expect(vcsUserRequest({ kind: 'github', host: 'github.com', apiUrl: '', user: '' }, 't').url).toBe('https://api.github.com/user');
    expect(vcsUserRequest({ kind: 'github', host: 'ghe.corp.io', apiUrl: '', user: '' }, 't').url).toBe('https://ghe.corp.io/api/v3/user');
    expect(vcsUserRequest({ kind: 'bitbucket', host: 'bitbucket.org', apiUrl: '', user: '' }, 't').headers.Authorization).toBe('Bearer t');
    expect(vcsUserRequest({ kind: 'bitbucket', host: 'bitbucket.org', apiUrl: '', user: 'me' }, 't').headers.Authorization).toBe(`Basic ${Buffer.from('me:t').toString('base64')}`);
  });

  it('reads the login, and names the failure', async () => {
    const v = { kind: 'gitlab' as const, host: 'g.io', apiUrl: '', user: '' };
    const ok = await fallbackVcsProbe(v, 'tok', async () => ({ ok: true, status: 200, json: async () => ({ username: 'ana' }) }));
    expect(ok).toEqual({ ok: true, user: 'ana', source: 'fallback', status: 200, message: 'ok' });
    const denied = await fallbackVcsProbe(v, 'tok', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(denied).toMatchObject({ ok: false, status: 401, message: 'http-401' });
    expect(await fallbackVcsProbe(v, null, async () => { throw new Error('unused'); })).toMatchObject({ ok: false, message: 'no-token' });
    const down = await fallbackVcsProbe(v, 'tok', async () => { throw new Error('getaddrinfo ENOTFOUND g.io'); });
    expect(down).toMatchObject({ ok: false, message: 'getaddrinfo ENOTFOUND g.io' });
  });

  it('normalises whatever probeVcs answers', () => {
    expect(normalizeVcsProbe({ ok: true, user: 'ana' })).toMatchObject({ ok: true, user: 'ana', source: 'vcs' });
    expect(normalizeVcsProbe({ ok: false, error: 'bad token' })).toMatchObject({ ok: false, message: 'bad token' });
    expect(normalizeVcsProbe({ user: { login: 'bo' } })).toMatchObject({ ok: true, user: 'bo' });
    expect(normalizeVcsProbe(null).ok).toBe(false);
  });
});

describe('cycle templates', () => {
  it('reads templates with a patch, an array or a map, and drops the unreadable', () => {
    const raw = [
      { id: 'scrum', name: 'Scrum', description: 'd', patch: { devCycle: { templateId: 'scrum', ceremonies: { preDaily: true, retro: false }, stages: [{ id: 'todo', label: 'To do' }] } } },
      { id: 'plain', label: 'Plain' },
      { nope: 1 },
      'x',
    ];
    const list = normalizeTemplates(raw);
    expect(list.map((t) => t.id)).toEqual(['scrum', 'plain']);
    expect(list[0]).toMatchObject({ name: 'Scrum', available: true, ceremonies: { preDaily: true, retro: false }, stages: [{ id: 'todo', label: 'To do' }] });
    expect(list[1]).toMatchObject({ name: 'Plain', patch: null, ceremonies: null });
    expect(normalizeTemplates({ a: { id: 'a' } }).map((t) => t.id)).toEqual(['a']);
    expect(normalizeTemplates(undefined)).toEqual([]);
  });

  it('the placeholder list has "no cycle" available and the rest coming', () => {
    const p = placeholderTemplates();
    expect(p.filter((t) => t.available).map((t) => t.id)).toEqual(['none']);
    expect(p.length).toBeGreaterThan(1);
  });
});
