// Where an agent named in a channel runs its commands: over a throwaway copy of the place's repositories (one repository itself, or one folder holding a copy of
// each), and no session at all where the place has no repository.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { RepoConfig } from '../src/shared/config/types';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { listAudit } from '../src/main/auditoria';
import { answerMentions } from '../src/main/mentions/answer';
import type { MentionPlace } from '../src/main/mentions/place';
import { fakeEngine, fakeSandbox } from './helpers/runner';

let root: string;
let forum: ForumStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-mention-shell-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function repo(id: string): RepoConfig {
  const path = join(root, 'repos', id);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), `# ${id}\n`);
  return { id, path, remoteUrl: null, vcsId: null, projectPath: `group/${id}` };
}

const config = (shell: 'sandbox' | 'host' | 'none' = 'sandbox') => {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell } : { ...a, permission: 'read' as const, shell: 'none' as const }));
  return c;
};

const message = () => forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn reproduce it', mentions: ['turn'] })[0];

const place = (repos: RepoConfig[]): MentionPlace => ({ thread: 'squads', kind: 'channel', squad: null, repos, ref: 'app#7', title: 'The thing' });

describe('the commands of a mention outside a run', () => {
  it('runs over a throwaway copy, and the copy is gone when the answer ends', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    const dirs: string[] = [];
    engine.script('turn', (call) => {
      dirs.push(call.cwd);
      return { text: 'It fails.' };
    });
    await answerMentions(place([repo('api')]), message(), { forum, config: () => config('sandbox'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(sandbox.opened).toHaveLength(1);
    expect(sandbox.opened[0].options.reader).toBe(false);
    expect(existsSync(dirs[0])).toBe(false);
    expect(sandbox.opened[0].session.closed).toBe(true);
  });

  it('gives the sandbox the agent\'s own hosts, and says in the thread the first refusal of each host and one summary when the session ends, not a line per tunnel', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    engine.script('turn', () => {
      const onProxy = sandbox.opened[0].options.onProxy;
      for (let i = 0; i < 30; i++) onProxy?.({ host: 'app.example.com', port: 443, allowed: true });
      for (let i = 0; i < 12; i++) onProxy?.({ host: 'other.example.com', port: 443, allowed: false, why: 'host' });
      onProxy?.({ host: 'third.example.com', port: 443, allowed: false, why: 'host' });
      onProxy?.({ host: 'Not A Host!', port: 443, allowed: false, why: 'bad-request' });
      return { text: 'Read.' };
    });
    const withHosts = config('sandbox');
    withHosts.agents.team.find((a) => a.id === 'turn')!.allowedHosts = ['app.example.com'];
    await answerMentions(place([repo('api')]), message(), { forum, config: () => withHosts, engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(sandbox.opened[0].options.agent?.allowedHosts).toEqual(['app.example.com']);
    const lines = (code: string) => forum.read('squads', 0, 200)?.messages.filter((m) => m.code === code) ?? [];
    expect(lines('runner.proxy')).toHaveLength(0);
    expect(lines('runner.proxy.firstRefusal').map((m) => m.params)).toEqual([{ agent: 'turn', host: 'other.example.com' }, { agent: 'turn', host: 'third.example.com' }]);
    expect(lines('runner.proxy.summary').map((m) => m.params)).toEqual([{ agent: 'turn', allowed: 30, refused: 14, hosts: 'other.example.com, third.example.com' }]);
    // The audit log gets the same summary, as counts.
    const audited = listAudit().filter((e) => e.origin.kind === 'conversation-proxy');
    expect(audited).toHaveLength(1);
    expect(audited[0].fields).toMatchObject({ agent: 'turn', hostsAllowed: 'app.example.com=30', hostsRefused: expect.stringContaining('other.example.com=12') });
  });

  it('writes no summary for a session whose proxy refused nothing', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    engine.script('turn', () => {
      sandbox.opened[0].options.onProxy?.({ host: 'app.example.com', port: 443, allowed: true });
      return { text: 'Read.' };
    });
    await answerMentions(place([repo('api')]), message(), { forum, config: () => config('sandbox'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(forum.read('squads', 0, 200)?.messages.filter((m) => m.code === 'runner.proxy.summary')).toHaveLength(0);
  });

  it('copies only what git knows of a repository, and lends it the clone\'s dependencies read-only through the sandbox', async () => {
    const r = repo('web');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r.path });
    writeFileSync(join(r.path, '.gitignore'), 'node_modules/\ndist/\n');
    mkdirSync(join(r.path, 'node_modules/dep'), { recursive: true });
    writeFileSync(join(r.path, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
    mkdirSync(join(r.path, 'dist'));
    writeFileSync(join(r.path, 'dist/huge.bin'), 'x');
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    const seen: { readme: boolean; dist: boolean; deps: string | null }[] = [];
    engine.script('turn', (call) => {
      seen.push({ readme: existsSync(join(call.cwd, 'README.md')), dist: existsSync(join(call.cwd, 'dist')), deps: lstatSync(join(call.cwd, 'node_modules')).isSymbolicLink() ? readlinkSync(join(call.cwd, 'node_modules')) : null });
      return { text: 'Read.' };
    });
    await answerMentions(place([r]), message(), { forum, config: () => config('sandbox'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(seen).toEqual([{ readme: true, dist: false, deps: join(r.path, 'node_modules') }]);
    expect(sandbox.opened[0].options.clone).toBe(r.path);
  });

  it('gives several repositories one folder holding a copy of each', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    let cwd = '';
    engine.script('turn', (call) => {
      cwd = call.cwd;
      expect(existsSync(join(call.cwd, 'api', 'README.md'))).toBe(true);
      expect(existsSync(join(call.cwd, 'web', 'README.md'))).toBe(true);
      return { text: 'Both read.' };
    });
    await answerMentions(place([repo('api'), repo('web')]), message(), { forum, config: () => config('sandbox'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(cwd).not.toBe('');
    expect(existsSync(cwd)).toBe(false);
  });

  it('opens no session where there is no repository, and the thread says why', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    engine.script('turn', () => ({ text: 'Read only.' }));
    await answerMentions(place([]), message(), { forum, config: () => config('sandbox'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(sandbox.opened).toHaveLength(0);
    expect(engine.calls[0].exec).toBeUndefined();
    expect(forum.read('squads', 0, 100)?.messages.some((m) => m.code === 'runner.mention.noShell')).toBe(true);
  });

  it('opens no session for an agent with no shell at all', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    engine.script('turn', () => ({ text: 'Read only.' }));
    await answerMentions(place([repo('api')]), message(), { forum, config: () => config('none'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(sandbox.opened).toHaveLength(0);
  });

  it('never runs a host command without asking: with nobody to ask, it is refused', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    const results: { refused?: string; exitCode: number | null }[] = [];
    engine.script('turn', async (call) => {
      if (call.exec) results.push(await call.exec.exec('npm test'));
      return { text: 'Read only.' };
    });
    await answerMentions(place([repo('api')]), message(), { forum, config: () => config('host'), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    expect(sandbox.opened).toHaveLength(1);
    expect(sandbox.opened[0].host).toBe(true);
    expect(results).toMatchObject([{ refused: 'denied' }]);
  });

  it('asks the person about a host command through the command notice, and runs it once allowed, the ask and the answer in the thread', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    const asked: { agent: string; command: string }[] = [];
    const results: { refused?: string; exitCode: number | null }[] = [];
    engine.script('turn', async (call) => {
      if (call.exec) results.push(await call.exec.exec('npm test'));
      return { text: 'Ran it.' };
    });
    await answerMentions(place([repo('api')]), message(), {
      forum,
      config: () => config('host'),
      engine,
      sandbox,
      env: () => ({ fallbackCwd: root }),
      askCommand: async (def, command) => {
        asked.push({ agent: def.id, command });
        return { ok: true };
      },
    });
    expect(asked).toEqual([{ agent: 'turn', command: 'npm test' }]);
    expect(results[0].refused).toBeUndefined();
    const codes = (forum.read('squads', 0, 100)?.messages ?? []).map((m) => m.code).filter(Boolean);
    expect(codes).toEqual(['runner.command.ask', 'runner.command.once', 'runner.exec.host']);
  });

  it('refuses a host command the person did not allow, and the thread keeps the note', async () => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    const results: { refused?: string; exitCode: number | null }[] = [];
    engine.script('turn', async (call) => {
      if (call.exec) results.push(await call.exec.exec('rm -rf build'));
      return { text: 'Did not run it.' };
    });
    await answerMentions(place([repo('api')]), message(), { forum, config: () => config('host'), engine, sandbox, env: () => ({ fallbackCwd: root }), askCommand: async () => ({ ok: false, note: 'not that one' }) });
    expect(results).toMatchObject([{ refused: 'denied' }]);
    const deny = (forum.read('squads', 0, 100)?.messages ?? []).find((m) => m.code === 'runner.command.deny');
    expect(deny?.params).toMatchObject({ agent: 'turn', note: 'not that one' });
  });
});
