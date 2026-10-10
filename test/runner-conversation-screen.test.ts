// The screen of an agent a stage calls with `CallAgent` (#177, rules 2 and 12 to 15): a called agent with the switch gets the app's browser and the confirmation tool the way
// a mentioned agent does, under the key of the agent and the thread; the caller's own screen stays the stage's. The browser is a scripted fake and nothing runs a command.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callKey } from '../src/shared/browser';
import { neutralConfig } from '../src/shared/config';
import type { AgentDef } from '../src/shared/config/types';
import { runThreadId } from '../src/shared/forum';
import type { AgentCall } from '../src/main/agents';
import { type ForumStore, createForumStore } from '../src/main/forum-core';
import { type ConversationDeps, runConversation } from '../src/main/runner/conversation';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

let dir: string;
let forum: ForumStore;
let screens: FakeScreens;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-conversation-screen-'));
  forum = createForumStore(join(dir, 'forum'));
  forum.ensureThread({ id: runThreadId('r1'), kind: 'run', runId: 'r1', title: 'app#1' });
});
afterEach(() => {
  screens?.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const agent = (id: string, over: Partial<AgentDef> = {}): AgentDef => ({ id, name: id, permission: 'read', shell: 'none', ...over }) as AgentDef;
const run = { id: 'r1', worktree: '/nowhere', issue: { iid: 1, ref: 'app#1' }, repo: 'app', cycleFolder: 'docs/cycles/1' } as never;
const KEY = callKey(runThreadId('r1'), 'qa');

/** One round: the caller says one thing, the called agent answers, and the engine is told what it was offered. */
async function converse(called: AgentDef, over: Partial<ConversationDeps> = {}, script?: (call: AgentCall) => Promise<unknown> | unknown) {
  const calls: AgentCall[] = [];
  const messages = ['look at the page'];
  const config = neutralConfig();
  config.runner.conversations = { roundsPerConversation: 1, perStage: 3 };
  config.runner.sandbox.display = true;
  const deps: ConversationDeps = {
    run,
    stage: { id: 'implement' } as never,
    caller: agent('developer', { screen: true }),
    called,
    forum,
    config: () => config,
    engine: async (call) => {
      calls.push(call);
      return { data: { texto: (await script?.(call)) ?? 'seen' } };
    },
    commands: [],
    abort: new AbortController(),
    chain: ['developer'],
    place: 'run',
    title: 'talk',
    screens: { sessions: screens.sessions, asks: screens.asks },
    ...over,
  };
  const result = await runConversation(deps, { fromCaller: async () => messages.shift() ?? null, answered: () => undefined });
  return { calls, result, deps };
}

describe('the screen of an agent a stage calls', () => {
  it('gets the app\'s browser and the confirmation tool, and the prompt that says so', async () => {
    screens = fakeScreens();
    const { calls } = await converse(agent('qa', { screen: true }));
    expect(calls).toHaveLength(1);
    expect(calls[0].screen?.browser?.tools().map((x) => x.name)).toContain('browser_navigate');
    expect(calls[0].screen?.confirm).toBeTypeOf('function');
    expect(calls[0].system).toContain('browser_navigate');
    expect(screens.starts).toHaveLength(1);
    // Under the key of the agent and the thread, not the stage's `run:<id>`; it outlives the conversation and counts down.
    expect(screens.sessions.list(runThreadId('r1'))).toEqual([expect.objectContaining({ key: KEY, place: 'conversation', closesAt: expect.any(String) })]);
    expect(screens.sessions.has('run:r1')).toBe(false);
  });

  it('leaves the call as it was for an agent with none of the switches', async () => {
    screens = fakeScreens();
    const plain = await converse(agent('qa'));
    expect(plain.calls[0].screen).toBeUndefined();
    expect(plain.calls[0].system).not.toContain('browser');
    expect(plain.calls[0].abort).toBe(plain.deps.abort);
    expect(screens.starts).toHaveLength(0);
    // And so does a build with no screens at all, whatever the agent is set to.
    const none = await converse(agent('qa', { screen: true }), { screens: null });
    expect(none.calls[0].screen).toBeUndefined();
    expect(none.calls[0].system).toBe(plain.calls[0].system);
    expect(screens.starts).toHaveLength(0);
  });

  it('withholds the browser in a test workspace, and the thread says so', async () => {
    screens = fakeScreens({ test: true });
    const { calls } = await converse(agent('qa', { screen: true, shell: 'host' }));
    expect(calls[0].screen?.browser).toBeUndefined();
    expect(screens.starts).toHaveLength(0);
    expect(screens.lines.filter((l) => l.code === 'runner.screen.testWorkspace')).toHaveLength(1);
  });

  it('lets the lease go when the conversation is over, and the screen stays for the next call', async () => {
    screens = fakeScreens();
    await converse(agent('qa', { screen: true }));
    // The lease is released: the next call of the same agent in the thread finds the open screen idle and reuses it, one browser.
    const again = await converse(agent('qa', { screen: true }));
    expect(again.calls[0].screen?.browser).toBeTruthy();
    expect(screens.starts).toHaveLength(1);
  });

  it('lets the lease go when the called agent fails', async () => {
    screens = fakeScreens();
    await expect(converse(agent('qa', { screen: true }), {}, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    const again = await converse(agent('qa', { screen: true }));
    expect(again.calls[0].screen?.browser).toBeTruthy();
  });

  it('ends the conversation, with a line, when the screen is closed under it', async () => {
    screens = fakeScreens();
    const { calls, result } = await converse(agent('qa', { screen: true }), {}, (call) => {
      expect(call.abort?.signal.aborted).toBe(false);
      return screens.sessions.close(KEY, 'person').then(() => {
        expect(call.abort?.signal.aborted).toBe(true);
        return 'gone';
      });
    });
    expect(calls).toHaveLength(1);
    expect(result.reason).toBe('ended');
    const thread = forum.read(runThreadId('r1'), 0, 200)?.messages ?? [];
    expect(thread.filter((m) => m.code === 'runner.mention.stoppedScreen')).toEqual([expect.objectContaining({ params: { agent: 'qa' } })]);
    expect(screens.sessions.has(KEY)).toBe(false);
  });
});
