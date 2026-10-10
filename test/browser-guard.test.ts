import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { AgentDef } from '../src/shared/config/types';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions } from '../src/main/mentions/answer';
import type { MentionPlace } from '../src/main/mentions/place';
import { fakeEngine, fakeSandbox } from './helpers/runner';

// A test workspace never reaches real sites (rule 41 of the spec): the agent's hosts, the logged-in profile and the app's browser for an agent on the computer are
// withheld, with a line in the thread; what a test workspace already allowed (the workspace's own network, a display on the loopback) is untouched. The check fails closed.

const { DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { grantsFor, screenGrants, withheldText } = await import('../src/main/browser/guard');
const { registryPath, setTestFlag } = await import('../src/main/workspaces-core');
const { isTestWorkspace } = await import('../src/main/workspace');

const agent = (over: Partial<Pick<AgentDef, 'screen' | 'allowedHosts' | 'browserProfile' | 'shell'>> = {}) => ({ shell: 'sandbox' as const, ...over });
const all = { screen: true, allowedHosts: ['app.example.com'], browserProfile: true };

describe('what a workspace lets an agent have', () => {
  it('lets everything through in a real workspace', () => {
    expect(screenGrants(agent(all), false)).toEqual({ allowedHosts: ['app.example.com'], profile: true, browser: true, withheld: [] });
    expect(screenGrants(agent({ ...all, shell: 'host' }), false)).toMatchObject({ profile: true, browser: true, withheld: [] });
  });

  it('withholds the hosts and the profile in a test workspace, and keeps the browser of a sandboxed agent', () => {
    expect(screenGrants(agent(all), true)).toEqual({ allowedHosts: [], profile: false, browser: true, withheld: ['hosts', 'profile'] });
    expect(screenGrants({ shell: 'none', ...all }, true)).toMatchObject({ browser: true, withheld: ['hosts', 'profile'] });
  });

  it('withholds the app\'s browser from an agent on the computer, and says nothing about a list it never used', () => {
    expect(screenGrants(agent({ ...all, shell: 'host' }), true)).toEqual({ allowedHosts: [], profile: false, browser: false, withheld: ['profile', 'hostBrowser'] });
    expect(screenGrants(agent({ screen: true, shell: 'host' }), true)).toMatchObject({ browser: false, withheld: ['hostBrowser'] });
  });

  it('says nothing about what the agent never asked for', () => {
    expect(screenGrants(agent({}), true)).toEqual({ allowedHosts: [], profile: false, browser: false, withheld: [] });
    expect(screenGrants(agent({ screen: true }), true)).toEqual({ allowedHosts: [], profile: false, browser: true, withheld: [] });
    expect(screenGrants(agent({ allowedHosts: [] }), true).withheld).toEqual([]);
  });

  it('has a sentence for each thing it withholds', () => {
    for (const w of ['hosts', 'profile', 'hostBrowser'] as const) expect(withheldText(w)).not.toMatch(/^main\.browser\./);
  });
});

describe('the workspace that is running', () => {
  afterEach(() => setTestFlag(DATA_ROOT, WORKSPACE_ID, false));

  it('follows the flag of the registry', () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    expect(grantsFor(agent(all)).withheld).toEqual([]);
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    expect(grantsFor(agent(all)).withheld).toEqual(['hosts', 'profile']);
  });

  it('fails closed: a registry that cannot be read counts as a test workspace', () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    const kept = readFileSync(registryPath(DATA_ROOT), 'utf8');
    try {
      writeFileSync(registryPath(DATA_ROOT), 'broken');
      expect(isTestWorkspace()).toBe(true);
      expect(grantsFor(agent(all))).toMatchObject({ allowedHosts: [], profile: false });
    } finally {
      writeFileSync(registryPath(DATA_ROOT), kept);
    }
  });
});

describe('an agent answering in a conversation', () => {
  let root: string;
  let forum: ForumStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coxia-guard-mention-'));
    forum = createForumStore(join(root, 'forum'));
    forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
    mkdirSync(join(root, 'repo'), { recursive: true });
    writeFileSync(join(root, 'repo', 'README.md'), '# repo\n');
  });
  afterEach(() => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    rmSync(root, { recursive: true, force: true });
  });

  const config = (shell: 'sandbox' | 'host') => {
    const c = neutralConfig();
    c.language = 'en';
    c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell, allowedHosts: ['app.example.com'] } : { ...a, shell: 'none' as const }));
    return c;
  };
  const place: MentionPlace = { thread: 'squads', kind: 'channel', squad: null, repos: [{ id: 'api', path: '', remoteUrl: null, vcsId: null, projectPath: 'group/api' }], ref: 'app#7', title: 'The thing' };
  const ask = async (shell: 'sandbox' | 'host') => {
    const sandbox = fakeSandbox();
    const engine = fakeEngine();
    engine.script('turn', () => ({ text: 'Read.' }));
    const message = forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn go', mentions: ['turn'] })[0];
    const here = { ...place, repos: [{ ...place.repos[0], path: join(root, 'repo') }] };
    await answerMentions(here, message, { forum, config: () => config(shell), engine, sandbox, env: () => ({ fallbackCwd: root }) });
    return { sandbox, lines: forum.read('squads', 0, 100)?.messages.filter((m) => m.code === 'runner.screen.testWorkspace') ?? [] };
  };

  it('gets its hosts in a real workspace, and the thread says nothing', async () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, false);
    const { sandbox, lines } = await ask('sandbox');
    expect(sandbox.opened[0].options.agent?.allowedHosts).toEqual(['app.example.com']);
    expect(lines).toEqual([]);
  });

  it('keeps the workspace\'s own network in a test workspace, and the thread says why', async () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    const { sandbox, lines } = await ask('sandbox');
    expect(sandbox.opened[0].options.agent?.allowedHosts).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].params).toMatchObject({ agent: 'turn', what: withheldText('hosts') });
  });

  it('has nothing to say to an agent on the computer, whose list was never used', async () => {
    setTestFlag(DATA_ROOT, WORKSPACE_ID, true);
    const { sandbox, lines } = await ask('host');
    expect(sandbox.opened[0].host).toBe(true);
    expect(lines).toEqual([]);
  });
});
