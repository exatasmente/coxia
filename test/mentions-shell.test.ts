// Where an agent named in a channel runs its commands: over a throwaway copy of the place's repositories (one repository itself, or one folder holding a copy of
// each), and no session at all where the place has no repository.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { RepoConfig } from '../src/shared/config/types';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
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
});
