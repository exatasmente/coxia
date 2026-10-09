// A mentioned agent's screen (#177, rules 12 to 17): an agent with the switch gets the app's browser in a conversation, with or without a shell and a repository; the screen
// outlives the answer; Stop ends one answer and leaves the screen; Close ends the screen and the answer with it. The browser is a scripted fake and the sandbox runs nothing.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callKey } from '../src/shared/browser';
import { neutralConfig } from '../src/shared/config';
import type { Run } from '../src/shared/runs';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions, type MentionDeps } from '../src/main/mentions/answer';
import { createKeptSessions } from '../src/main/mentions/kept';
import type { MentionPlace } from '../src/main/mentions/place';
import { createCallStops } from '../src/main/mentions/stop';
import { type FakeSandbox, fakeEngine, fakeSandbox } from './helpers/runner';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

let root: string;
let forum: ForumStore;
let screens: FakeScreens;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-mention-screen-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
});
afterEach(() => {
  screens?.dispose();
  rmSync(root, { recursive: true, force: true });
});

const KEY = callKey('squads', 'turn');

const config = (agent: Partial<{ screen: boolean; shell: 'none' | 'sandbox' | 'host'; allowedHosts: string[] }> = {}) => {
  const c = neutralConfig();
  c.language = 'en';
  c.runner.sandbox.display = true;
  c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell: 'none' as const, screen: true, ...agent } : { ...a, permission: 'read' as const, shell: 'none' as const }));
  return c;
};

const say = () => forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn open the page', mentions: ['turn'] })[0];
const noRepo = (): MentionPlace => ({ thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing' });
const withDisplay = (): FakeSandbox => fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/s/x11/X99', kind: 'sandbox' } });

function deps(over: Partial<MentionDeps> = {}) {
  const engine = fakeEngine();
  const stops = createCallStops();
  const kept = createKeptSessions();
  const d: MentionDeps = { forum, config: () => config(), sandbox: withDisplay(), env: () => ({ fallbackCwd: root }), screens: () => ({ sessions: screens.sessions, asks: screens.asks }), kept, stops, ...over, engine };
  return { d, engine, stops, kept };
}

/** Waits until the engine of the call has begun. */
const began = (engine: ReturnType<typeof fakeEngine>, n = 1) => new Promise<void>((resolve) => void (function poll() {
  if (engine.calls.length >= n) resolve();
  else setTimeout(poll, 5);
})());

const lines = (code: string) => forum.read('squads', 0, 200)?.messages.filter((m) => m.code === code) ?? [];

describe('a mentioned agent with a screen', () => {
  it('gets the app\'s browser with no shell and no repository, on a display of the app\'s own, and the screen outlives the answer', async () => {
    screens = fakeScreens();
    const { d, engine } = deps();
    engine.script('turn', () => ({ text: 'Opened.' }));
    await answerMentions(noRepo(), say(), d);
    const call = engine.calls[0];
    expect(call.exec).toBeUndefined();
    expect(call.screen?.browser?.tools().map((t) => t.name)).toContain('browser_navigate');
    expect(call.screen?.confirm).toBeTypeOf('function');
    expect(call.abort).toBeInstanceOf(AbortController);
    expect(screens.starts).toHaveLength(1);
    expect(screens.starts[0].display).toBeNull();
    expect(screens.hubOpened).toEqual([expect.objectContaining({ key: KEY, thread: 'squads', agent: 'turn' })]);
    // The answer is over; the screen is open and counting down.
    expect(screens.sessions.list('squads')).toEqual([expect.objectContaining({ key: KEY, place: 'conversation', closesAt: expect.any(String) })]);
    expect(forum.read('squads', 0, 50)?.messages.some((m) => m.kind === 'post' && m.author.type === 'agent')).toBe(true);
  });

  it('reuses the open screen on the next answer: one browser, one start', async () => {
    screens = fakeScreens();
    const { d, engine } = deps();
    engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(noRepo(), say(), d);
    await answerMentions(noRepo(), say(), d);
    expect(screens.starts).toHaveLength(1);
    expect(engine.calls[1].screen?.browser).toBeTruthy();
  });

  it('works in an empty throwaway folder when the agent has a shell and the place has no repository, and says nothing about missing code', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const { d, engine } = deps({ sandbox, config: () => config({ shell: 'sandbox' }) });
    let dir = '';
    engine.script('turn', (call) => {
      dir = call.cwd;
      return { text: 'Opened.' };
    });
    await answerMentions(noRepo(), say(), d);
    expect(sandbox.opened).toHaveLength(1);
    expect(sandbox.opened[0].options.display).toBe(true);
    expect(lines('runner.mention.noShell')).toHaveLength(0);
    expect(existsSync(dir)).toBe(true);
    // It goes with the screen.
    await screens.sessions.close(KEY, 'person');
    expect(existsSync(dir)).toBe(false);
  });

  it('answers without a browser, and says why in the thread, when another answer of the agent holds the screen', async () => {
    screens = fakeScreens();
    const { d, engine } = deps();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    engine.script('turn', async () => {
      if (engine.calls.length === 1) await gate;
      return { text: 'Done.' };
    });
    const first = answerMentions(noRepo(), say(), d);
    await began(engine);
    await answerMentions(noRepo(), say(), d);
    expect(engine.calls[1].screen?.browser).toBeUndefined();
    expect(screens.lines.filter((l) => l.code === 'runner.screen.inUse')).toHaveLength(1);
    release();
    await first;
    expect(screens.starts).toHaveLength(1);
  });

  it('offers only the confirmation tool to an agent with a host list and no screen', async () => {
    screens = fakeScreens();
    const { d, engine } = deps({ config: () => config({ screen: false, allowedHosts: ['app.example.com'] }) });
    engine.script('turn', () => ({ text: 'Read.' }));
    await answerMentions(noRepo(), say(), d);
    expect(engine.calls[0].screen?.browser).toBeUndefined();
    expect(engine.calls[0].screen?.confirm).toBeTypeOf('function');
    expect(screens.starts).toHaveLength(0);
  });

  it('offers nothing to an agent with none of the switches', async () => {
    screens = fakeScreens();
    const { d, engine } = deps({ config: () => config({ screen: false }) });
    engine.script('turn', () => ({ text: 'Read.' }));
    await answerMentions(noRepo(), say(), d);
    expect(engine.calls[0].screen).toBeUndefined();
    expect(screens.starts).toHaveLength(0);
  });
});

describe('where an agent gets no screen', () => {
  it('a ceremony has none, whatever its agents are set to', async () => {
    screens = fakeScreens();
    const { d, engine } = deps();
    engine.script('turn', () => ({ text: 'Said.' }));
    await answerMentions({ thread: 'squads', kind: 'ceremony', repos: [], ref: 'app#7', title: 'Daily' }, say(), d);
    expect(engine.calls[0].screen).toBeUndefined();
    expect(screens.starts).toHaveLength(0);
  });
});

describe('which calls get the app\'s browser (acceptance 1, for conversations)', () => {
  const places: [string, MentionPlace][] = [
    ['a direct conversation', { thread: 'squads', kind: 'channel', squad: null, owner: 'turn', repos: [], ref: 'app#7', title: 'The thing' }],
    ['a squad channel', { thread: 'squads', kind: 'channel', squad: { id: 's1', name: 'One' } as never, repos: [], ref: 'app#7', title: 'The thing' }],
    ['a general thread', { thread: 'squads', kind: 'general', repos: [], ref: 'app#7', title: 'The thing' }],
    ['a ceremony', { thread: 'squads', kind: 'ceremony', repos: [], ref: 'app#7', title: 'Daily' }],
  ];
  const rows = places.flatMap(([name, place]) =>
    (['none', 'allowlist', 'sandbox', 'host'] as const).flatMap((shell) => [true, false].map((workspace) => ({ name, place, shell, workspace }))),
  );
  it.each(rows)('$name, shell $shell, the workspace\'s display $workspace', async ({ place, shell, workspace }) => {
    screens = fakeScreens({ configure: (c) => void (c.runner.sandbox.display = workspace) });
    const cfg = config({ shell: shell as never });
    cfg.runner.sandbox.display = workspace;
    const { d, engine } = deps({ config: () => cfg });
    engine.script('turn', () => ({ text: 'Said.' }));
    await answerMentions(place, say(), d);
    const gets = place.kind !== 'ceremony' && workspace;
    expect(!!engine.calls[0].screen?.browser).toBe(gets);
    expect(screens.starts).toHaveLength(gets ? 1 : 0);
    // The confirmation tool follows the shell on the computer, with or without a screen; a ceremony has none of it.
    if (place.kind === 'ceremony') expect(engine.calls[0].screen).toBeUndefined();
  });
});

describe('stopping and closing', () => {
  it('stops one answer of the agent, tells the thread, and leaves the screen open', async () => {
    screens = fakeScreens();
    const { d, engine, stops } = deps();
    engine.script('turn', (call) => new Promise((_, reject) => call.abort?.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const answer = answerMentions(noRepo(), say(), d);
    await began(engine);
    expect(stops.running('squads')).toEqual([{ thread: 'squads', agent: 'turn' }]);
    expect(stops.stop('squads', 'turn')).toBe(true);
    await answer;
    expect(engine.calls[0].abort?.signal.aborted).toBe(true);
    expect(lines('runner.mention.stopped')).toEqual([expect.objectContaining({ params: { agent: 'turn' } })]);
    expect(lines('runner.mentionFailed')).toHaveLength(0);
    expect(stops.running()).toEqual([]);
    // The screen stays, with its idle clock started.
    expect(screens.sessions.has(KEY)).toBe(true);
    expect(screens.sessions.list('squads')[0].closesAt).not.toBeNull();
  });

  it('finds no answer to stop when none is running', () => {
    const stops = createCallStops();
    expect(stops.stop('squads', 'turn')).toBe(false);
  });

  it('ends the answer with the screen when the person closes the screen, and writes one line about each', async () => {
    screens = fakeScreens();
    const { d, engine } = deps();
    engine.script('turn', (call) => new Promise((_, reject) => call.screen?.signal?.addEventListener('abort', () => reject(new Error('screen gone')))));
    const answer = answerMentions(noRepo(), say(), d);
    await began(engine);
    await screens.sessions.close(KEY, 'person');
    await answer;
    expect(lines('runner.mention.stoppedScreen')).toHaveLength(1);
    expect(lines('runner.mentionFailed')).toHaveLength(0);
    expect(screens.sessions.has(KEY)).toBe(false);
    expect(screens.lines.filter((l) => l.code === 'runner.screen.closed')).toHaveLength(1);
    expect(screens.log).toContain('close');
  });

  it('stops a call with no screen too: Stop applies to every mention call', async () => {
    screens = fakeScreens();
    const { d, engine, stops } = deps({ config: () => config({ screen: false }) });
    engine.script('turn', (call) => new Promise((_, reject) => call.abort?.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const answer = answerMentions(noRepo(), say(), d);
    await began(engine);
    expect(stops.stop('squads', 'turn')).toBe(true);
    await answer;
    expect(lines('runner.mention.stopped')).toHaveLength(1);
  });
});

describe('in a run\'s thread', () => {
  it('opens the kept session through the runner\'s own door, asks it for a display, and keeps it under the same key', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const wt = join(root, 'wt');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(wt, { recursive: true });
    const run = { id: 'r-1', issue: { iid: 7, ref: 'app#7', title: 'T' }, worktree: wt, stage: 'dev', cycleFolder: 'docs/cycles/7-t', base: 'main', repo: 'app' } as unknown as Run;
    forum.ensureThread({ id: 'run-r-1', kind: 'run', title: 'Run', runId: 'r-1' } as never);
    const place: MentionPlace = { thread: 'run-r-1', kind: 'run', run, repos: [] };
    const asked: { display?: boolean }[] = [];
    const { d, engine, kept } = deps({
      sandbox,
      config: () => config({ shell: 'sandbox' }),
      openSession: async (_p, _def, _cwd, _stage, _signal, _clock, wants) => {
        asked.push({ display: wants?.display });
        return sandbox.open({ worktree: wt, reader: true, config: neutralConfig().runner.sandbox, display: wants?.display });
      },
    });
    engine.script('turn', () => ({ text: 'Read.' }));
    const m = forum.append('run-r-1', { kind: 'post', author: { type: 'person' }, text: '@turn look', mentions: ['turn'] })[0];
    await answerMentions(place, m, d);
    expect(asked).toEqual([{ display: true }]);
    const key = callKey('run-r-1', 'turn');
    expect(screens.sessions.has(key)).toBe(true);
    expect(kept.keys()).toEqual([key]);
    expect(screens.starts[0].display).toEqual({ socket: '/s/x11/X99', name: 'X99' });
    // The run's stage moves on: the screen goes, and so does the session — but the worktree stays.
    await screens.sessions.closeThread('run-r-1', 'stage');
    expect(sandbox.opened[0].session.closed).toBe(true);
    expect(existsSync(wt)).toBe(true);
    expect(kept.keys()).toEqual([]);
  });
});
