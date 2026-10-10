// The shell session of an agent with a screen, kept between its answers (rule 13 of #177): the first answer makes the copy and the session, with a display the app's browser
// draws on; the next ones find them as they were; they end with the screen. The browser is a scripted fake and the sandbox runs nothing.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callKey } from '../src/shared/browser';
import { neutralConfig } from '../src/shared/config';
import type { RepoConfig } from '../src/shared/config/types';
import { listAudit } from '../src/main/auditoria';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions, type MentionDeps } from '../src/main/mentions/answer';
import { createKeptSessions } from '../src/main/mentions/kept';
import type { MentionPlace } from '../src/main/mentions/place';
import { type FakeSandbox, fakeEngine, fakeSandbox } from './helpers/runner';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

let root: string;
let forum: ForumStore;
let screens: FakeScreens;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-mention-kept-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
});
afterEach(() => {
  screens?.dispose();
  rmSync(root, { recursive: true, force: true });
});

function repo(id: string): RepoConfig {
  const path = join(root, 'repos', id);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), `# ${id}\n`);
  return { id, path, remoteUrl: null, vcsId: null, projectPath: `group/${id}` };
}

const KEY = callKey('squads', 'turn');

const config = (over: { screen?: boolean; shell?: 'sandbox' | 'host' } = {}) => {
  const c = neutralConfig();
  c.language = 'en';
  c.runner.sandbox.display = true;
  c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell: over.shell ?? ('sandbox' as const), ...(over.screen === false ? {} : { screen: true }) } : { ...a, permission: 'read' as const, shell: 'none' as const }));
  return c;
};

const say = (text = '@turn go on') => forum.append('squads', { kind: 'post', author: { type: 'person' }, text, mentions: ['turn'] })[0];
const place = (): MentionPlace => ({ thread: 'squads', kind: 'channel', squad: null, repos: [repo('api')], ref: 'app#7', title: 'The thing' });
const withDisplay = (): FakeSandbox => fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/s/x11/X99', kind: 'sandbox' } });

function deps(sandbox: FakeSandbox, over: Partial<MentionDeps> = {}): MentionDeps & { engine: ReturnType<typeof fakeEngine>; kept: ReturnType<typeof createKeptSessions> } {
  const engine = fakeEngine();
  return { forum, config: () => config(), sandbox, env: () => ({ fallbackCwd: root }), screens: () => ({ sessions: screens.sessions, asks: screens.asks }), kept: createKeptSessions(), ...over, engine };
}

describe('a shell session kept for a screen', () => {
  it('opens one session with a display on the first answer, lends it to the browser and keeps the session and its copy', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const d = deps(sandbox);
    const dirs: string[] = [];
    d.engine.script('turn', async (call) => {
      dirs.push(call.cwd);
      await call.exec?.exec('echo one');
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    expect(sandbox.opened).toHaveLength(1);
    expect(sandbox.opened[0].options.display).toBe(true);
    expect(screens.starts[0].display).toEqual({ socket: '/s/x11/X99', name: 'X99' });
    expect(d.engine.calls[0].screen?.browser).toBeTruthy();
    expect(screens.sessions.has(KEY)).toBe(true);
    expect(sandbox.opened[0].session.closed).toBe(false);
    expect(existsSync(dirs[0])).toBe(true);
    expect(d.kept.keys()).toEqual([KEY]);
  });

  it('finds the session, the copy and the screen as they were on the next answer', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const d = deps(sandbox);
    const dirs: string[] = [];
    d.engine.script('turn', async (call) => {
      dirs.push(call.cwd);
      await call.exec?.exec(`echo ${dirs.length}`);
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    await answerMentions(place(), say(), d);
    expect(sandbox.opened).toHaveLength(1);
    expect(dirs[1]).toBe(dirs[0]);
    expect(sandbox.opened[0].session.asked).toEqual(['echo 1', 'echo 2']);
    expect(screens.starts).toHaveLength(1);
    expect(d.engine.calls[1].exec).toBe(sandbox.opened[0].session);
  });

  it('ends the session and removes the copy with the screen, whatever ends the screen', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const d = deps(sandbox);
    let dir = '';
    d.engine.script('turn', (call) => {
      dir = call.cwd;
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    expect(existsSync(dir)).toBe(true);
    await screens.sessions.close(KEY, 'person');
    expect(sandbox.opened[0].session.closed).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(d.kept.keys()).toEqual([]);
    // The browser ended first, then the session: the display is the session's.
    expect(screens.log.indexOf('close')).toBeGreaterThan(-1);
    // The next answer makes a new session and a new screen.
    await answerMentions(place(), say(), d);
    expect(sandbox.opened).toHaveLength(2);
    expect(screens.starts).toHaveLength(2);
  });

  it('gives an answer that comes while the first still runs a session of its own, closed when it ends, and leaves the kept one alone', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const d = deps(sandbox);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    d.engine.script('turn', async (call) => {
      if (d.engine.calls.length === 2) await gate;
      await call.exec?.exec('echo');
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    const first = answerMentions(place(), say(), d);
    // The kept session is held by the second answer: a third gets its own session and no browser.
    await new Promise((r) => setTimeout(r, 50));
    await answerMentions(place(), say(), d);
    expect(sandbox.opened).toHaveLength(2);
    expect(sandbox.opened[1].options.display).toBeFalsy();
    expect(sandbox.opened[1].session.closed).toBe(true);
    expect(d.engine.calls[2].screen?.browser).toBeUndefined();
    expect(sandbox.opened[0].session.closed).toBe(false);
    expect(screens.lines.some((l) => l.code === 'runner.screen.inUse')).toBe(true);
    release();
    await first;
    expect(sandbox.opened[0].session.closed).toBe(false);
  });

  it('keeps nothing when the screen cannot be had: the session is this answer\'s and goes with it', async () => {
    screens = fakeScreens({ browsers: false });
    const sandbox = withDisplay();
    const d = deps(sandbox);
    let dir = '';
    d.engine.script('turn', (call) => {
      dir = call.cwd;
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    expect(sandbox.opened[0].session.closed).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(d.kept.keys()).toEqual([]);
    expect(d.engine.calls[0].screen?.browser).toBeUndefined();
    // The confirmation tool needs no browser: the session has a display.
    expect(d.engine.calls[0].screen?.confirm).toBeTypeOf('function');
    expect(screens.lines.some((l) => l.code === 'runner.screen.noBrowser')).toBe(true);
  });

  it('keeps nothing for an agent with no screen: a session for the answer, as before', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const d = deps(sandbox, { config: () => config({ screen: false }) });
    d.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(place(), say(), d);
    expect(sandbox.opened[0].options.display).toBeFalsy();
    expect(sandbox.opened[0].session.closed).toBe(true);
    expect(screens.starts).toHaveLength(0);
    expect(d.kept.keys()).toEqual([]);
  });

  it('follows the answer that has the session: a host command asks with that answer\'s clock', async () => {
    screens = fakeScreens();
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/s/x11/X99', kind: 'host' } });
    const asked: string[] = [];
    const d = deps(sandbox, {
      config: () => config({ shell: 'host' }),
      askCommand: async (_def, command, signal) => {
        asked.push(`${command}:${signal.aborted}`);
        return { ok: true };
      },
    });
    d.engine.script('turn', async (call) => {
      await call.exec?.exec('make');
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    await answerMentions(place(), say(), d);
    expect(sandbox.opened).toHaveLength(1);
    expect(sandbox.opened[0].host).toBe(true);
    expect(asked).toEqual(['make:false', 'make:false']);
  });

  it('audits the commands of a conversation as a stage\'s are, with the thread and no run', async () => {
    screens = fakeScreens();
    const sandbox = withDisplay();
    const d = deps(sandbox);
    d.engine.script('turn', async (call) => {
      await call.exec?.exec('npm test -- --token=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    const line = listAudit().find((e) => e.kind === 'exec' && e.fields.thread === 'squads');
    expect(line).toMatchObject({ kind: 'exec', via: 'sandbox', issue: 0, ok: true, by: 'turn', fields: { agent: 'turn', thread: 'squads', n: '1' } });
    expect(line?.target).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('the registry of kept sessions', () => {
  const fakeShell = (made: boolean, dir: string) => {
    const calls: string[] = [];
    return {
      calls,
      shell: {
        session: { close: async () => void calls.push('close') } as unknown as import('../src/main/sandbox').SandboxSession,
        source: { cwd: dir, made, reader: false },
        display: null,
        cell: { bound: null },
        life: new AbortController(),
      },
    };
  };

  it('closes a session and removes the copy it made when it is released, and never twice', async () => {
    const kept = createKeptSessions();
    const dir = join(root, 'copy');
    mkdirSync(dir);
    const a = fakeShell(true, dir);
    await kept.keep('k', a.shell);
    expect(kept.get('k')).toBe(a.shell);
    expect(await kept.release('k')).toBe(true);
    expect(a.calls).toEqual(['close']);
    expect(existsSync(dir)).toBe(false);
    expect(a.shell.life.signal.aborted).toBe(true);
    expect(await kept.release('k')).toBe(false);
  });

  it('leaves a worktree that is not its own, and keeps one session per screen', async () => {
    const kept = createKeptSessions();
    const dir = join(root, 'worktree');
    mkdirSync(dir);
    const a = fakeShell(false, dir);
    const b = fakeShell(false, dir);
    await kept.keep('k', a.shell);
    await kept.keep('k', b.shell);
    expect(a.calls).toEqual(['close']);
    expect(kept.get('k')).toBe(b.shell);
    await kept.release('k');
    expect(existsSync(dir)).toBe(true);
  });
});
