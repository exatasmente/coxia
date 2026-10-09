// The screens of the agents that have one (acceptance 9 and 15 of #177): opened by the first answer, reused by the next, held open by what is happening and ended by the first of
// the clocks, the person or the settings. The browser is a scripted fake and the clock is ours; the profile lock is the real one on a throwaway folder.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCREEN_IDLE_MS, SCREEN_OPEN_MAX, callKey, runKey } from '../src/shared/browser';
import { neutralConfig } from '../src/shared/config';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import type { AuditEntry } from '../src/shared/auditoria';
import { createScreenAsks } from '../src/main/browser/asks';
import { screenGrants } from '../src/main/browser/guard';
import { createHostsTally } from '../src/main/browser/hosts';
import { BrowserStartError, type BrowserRuntime, type BrowserStartOptions } from '../src/main/browser/launch';
import { createProfileLocks, openProfile } from '../src/main/browser/profile';
import { type AcquireRequest, type ClosedScreen, type ScreenLease, type SessionDeps, createScreenSessions } from '../src/main/browser/sessions';
import { fakeServer } from './helpers/browserServer';

beforeEach(() => setLanguage('en'));

const MIN = 60_000;

/** A clock and the timers that hang on it, by hand. */
function fakeClock() {
  const c = { t: 1_700_000_000_000 };
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => c.t,
    schedule: (ms: number, fn: () => void) => {
      const timer = { at: c.t + ms, fn, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    /** Moves the clock, firing every timer that falls due on the way, in order. */
    async advance(ms: number) {
      const to = c.t + ms;
      for (;;) {
        const next = timers.filter((x) => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.live = false;
        c.t = Math.max(c.t, next.at);
        next.fn();
        // Whatever the timer set going (a close) is let finish before the next one.
        await new Promise((r) => setImmediate(r));
      }
      c.t = to;
    },
    live: () => timers.filter((x) => x.live).length,
  };
}

const agentOf = (over: Partial<AgentDef> = {}): AcquireRequest['agent'] => ({ id: 'web', screen: true, shell: 'none', ...over }) as AcquireRequest['agent'];

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'coxia-sessions-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup(over: { config?: (c: WorkspaceConfig) => void; test?: boolean; startFails?: BrowserStartError | Error; browsers?: SessionDeps['browsers']; startGate?: Promise<void>; sandboxGate?: () => Promise<void>; keep?: 'kept' | 'not'; noKeep?: boolean; noHub?: boolean; hubOpens?: boolean } = {}) {
  const clock = fakeClock();
  const config = neutralConfig();
  config.runner.sandbox.display = true;
  over.config?.(config);
  const log: string[] = [];
  const lines: { thread: string; stage: string; code: string; params: Record<string, string> }[] = [];
  const audit: Omit<AuditEntry, 'at'>[] = [];
  const changed: string[] = [];
  const server = fakeServer();
  const runtimes: { runtime: BrowserRuntime; options: BrowserStartOptions; closed: boolean; dead: () => void }[] = [];
  const locks = createProfileLocks();
  const asks = createScreenAsks({
    changed: () => undefined,
    audit: (e) => {
      log.push(`audit.${e.kind}`);
      audit.push(e);
    },
  });
  const hubOpened: unknown[] = [];
  const hub = {
    open: vi.fn(async (screen: unknown) => {
      hubOpened.push(screen);
      log.push('hub.open');
      return over.hubOpens ?? true;
    }),
    finish: vi.fn(async () => {
      log.push('hub.finish');
      return null;
    }),
    end: vi.fn(() => void log.push('hub.end')),
    state: vi.fn((_key: string) => ({ stage: '', width: 1280, height: 800, since: '', control: false, recording: 'waiting' as const })),
  };
  const kept: ClosedScreen[] = [];
  const deps: SessionDeps = {
    enabled: true,
    config: () => config,
    browsers: over.browsers ?? (() => ({ ok: true, browsers: '/b', chromium: '/b/chrome' })),
    sandboxReady: async () => {
      await over.sandboxGate?.();
      return true;
    },
    dir: join(root, 'sandbox'),
    grants: (agent) => screenGrants(agent, over.test ?? false),
    openProfile: (agent, owner) => openProfile(root, agent, owner, { locks }),
    start: async (options) => {
      await over.startGate;
      if (over.startFails) throw over.startFails;
      let dead: () => void = () => undefined;
      const runtime: BrowserRuntime = {
        client: Object.assign(server.client, {
          onClose: (fn: () => void) => void (dead = fn),
        }) as unknown as BrowserRuntime['client'],
        display: options.display ? { ...options.display, own: false } : { socket: join(root, 'own/X77'), name: 'X77', own: true },
        network: options.network,
        hosts: createHostsTally(),
        profile: { dir: options.profile ?? join(root, 'throwaway'), fresh: options.profile === null },
        sessionDir: join(root, 'sandbox/s1'),
        close: async () => {
          log.push('runtime.close');
          entry.closed = true;
        },
      };
      const entry = { runtime, options, closed: false, dead: () => dead() };
      runtimes.push(entry);
      return runtime;
    },
    asks,
    ...(over.noHub ? {} : { hub }),
    say: (thread, stage, code, params) => void lines.push({ thread, stage, code, params }),
    ...(over.noKeep
      ? {}
      : {
          keepRecording: async (screen) => {
            log.push('recording');
            kept.push(screen);
            return over.keep ?? 'kept';
          },
        }),
    changed: (key) => void changed.push(key),
    audit: (e) => {
      log.push(`audit.${e.kind}`);
      audit.push(e);
    },
    now: clock.now,
    schedule: clock.schedule,
  };
  const sessions = createScreenSessions(deps);
  const closedSeen: ClosedScreen[] = [];
  sessions.onClosed((s) => {
    log.push('onClosed');
    closedSeen.push(s);
  });
  const req = (over2: Partial<AcquireRequest> = {}): AcquireRequest => ({ key: callKey('general', 'web'), agent: agentOf(), thread: 'general', place: 'conversation', seesImages: true, ...over2 });
  const lease = async (over2: Partial<AcquireRequest> = {}): Promise<ScreenLease> => {
    const r = await sessions.acquire(req(over2));
    if (!r.ok) throw new Error(`refused: ${r.why}`);
    return r.lease;
  };
  return { sessions, clock, config, log, lines, audit, changed, server, runtimes, locks, asks, hub, hubOpened, kept, closedSeen, req, lease };
}

const codes = (s: { lines: { code: string }[] }) => s.lines.map((l) => l.code);

describe('opening a screen', () => {
  it('starts the app\'s browser with the agent\'s network, the display it is lent and the engine\'s eyes, and says so in the thread', async () => {
    const s = setup({ config: (c) => ((c.runner.sandbox.network = 'registry'), (c.runner.sandbox.registryHosts = ['registry.example.com'])) });
    const lease = await s.lease({ agent: agentOf({ shell: 'sandbox', allowedHosts: ['app.example.com'] }), display: { socket: '/stage/x11/X99', kind: 'sandbox' }, seesImages: false, issue: 12, message: 4 });
    expect(s.runtimes).toHaveLength(1);
    expect(s.runtimes[0].options).toMatchObject({
      network: { mode: 'proxy', hosts: ['registry.example.com', 'app.example.com'] },
      display: { socket: '/stage/x11/X99', name: 'X99' },
      profile: null,
      seesImages: false,
      browsers: '/b',
      chromium: '/b/chrome',
    });
    expect(lease.display).toMatchObject({ socket: '/stage/x11/X99', own: false });
    expect(lease.profile).toBe('none');
    expect(s.lines).toEqual([{ thread: 'general', stage: '', code: 'runner.screen.opened', params: { agent: 'web', minutes: '10' } }]);
    expect(s.audit.filter((e) => e.kind === 'screen-open')).toHaveLength(1);
    expect(s.audit[0]).toMatchObject({ kind: 'screen-open', by: 'web', via: 'sandbox', issue: 12, fields: { place: 'conversation', path: 'both', profile: 'none', message: '4' } });
  });

  it('starts a display of its own when the agent has no shell session to lend one, and uses the shell: none mode', async () => {
    const s = setup();
    const lease = await s.lease();
    expect(s.runtimes[0].options.display).toBeNull();
    expect(lease.display).toMatchObject({ own: true });
    expect(s.audit[0]).toMatchObject({ via: 'none', fields: { path: 'app-browser' } });
  });

  it('puts a conversation screen on the viewer, under its key and thread, and leaves a stage\'s to the executor', async () => {
    const s = setup();
    await s.lease({ thread: 'squad-web' , key: callKey('squad-web', 'web') });
    expect(s.hubOpened).toEqual([{ key: 'call:squad-web:web', thread: 'squad-web', stage: '', agent: 'web', socket: join(root, 'own/X77'), kind: 'sandbox' }]);
    const stage = setup();
    await stage.lease({ key: runKey('r1'), thread: 'run-r1', place: 'stage', stage: 'qa', display: { socket: '/s/X99', kind: 'host' } });
    expect(stage.hub.open).not.toHaveBeenCalled();
    expect(stage.sessions.list('run-r1')[0]).toMatchObject({ key: 'run:r1', place: 'stage' });
  });

  it('says once that the screen cannot be watched when the viewer cannot connect, and still works', async () => {
    const s = setup({ hubOpens: false });
    await s.lease();
    expect(codes(s)).toEqual(['runner.screen.opened', 'runner.screen.noWatch']);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    // A screen the viewer could not connect to cannot be taken by the person.
    expect(s.sessions.watched(callKey('general', 'web'))).toBe(false);
  });

  it('says whether a screen is registered with the viewer, so the person could take it: only an open one that the hub has', async () => {
    const s = setup();
    expect(s.sessions.watched(callKey('general', 'web'))).toBe(false);
    await s.lease();
    expect(s.sessions.watched(callKey('general', 'web'))).toBe(true);
    await s.sessions.close(callKey('general', 'web'), 'person');
    expect(s.sessions.watched(callKey('general', 'web'))).toBe(false);
  });

  it('lists the screens of a thread with their closing time, size and pending questions', async () => {
    const s = setup();
    const lease = await s.lease();
    await s.lease({ key: callKey('other', 'web'), thread: 'other' });
    const list = s.sessions.list('general');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'call:general:web', agent: 'web', thread: 'general', place: 'conversation', closesAt: null, width: 1280, height: 800, control: false, recording: 'waiting', profile: 'none', pending: [] });
    expect(list[0].since).toBe(new Date(s.clock.now()).toISOString());
    expect(s.sessions.list()).toHaveLength(2);
    lease.release();
    expect(s.sessions.list('general')[0].closesAt).toBe(new Date(s.clock.now() + SCREEN_IDLE_MS).toISOString());
  });
});

describe('what a screen is not opened for', () => {
  it('does nothing for an agent without the switch, off Linux, or with the workspace\'s display off, and says why only where the person can act', async () => {
    const s = setup();
    expect(await s.sessions.acquire(s.req({ agent: agentOf({ screen: false }) }))).toEqual({ ok: false, why: 'agent' });
    expect(s.lines).toEqual([]);
    const off = setup({ config: (c) => void (c.runner.sandbox.display = false) });
    expect(await off.sessions.acquire(off.req())).toEqual({ ok: false, why: 'disabled' });
    expect(codes(off)).toEqual(['runner.screen.noBrowser']);
    expect(off.runtimes).toEqual([]);
  });

  it('says once, not at every message, that there is no browsers folder', async () => {
    const s = setup({ browsers: () => ({ ok: false, why: 'unset' }) });
    for (let i = 0; i < 3; i++) expect(await s.sessions.acquire(s.req())).toMatchObject({ ok: false, why: 'no-browsers' });
    expect(codes(s)).toEqual(['runner.screen.noBrowser']);
    expect(s.lines[0].params.reason).toMatch(/folder of browsers/);
  });

  it('withholds the app\'s browser from an agent on the computer in a test workspace, and says what it withheld', async () => {
    const s = setup({ test: true });
    const r = await s.sessions.acquire(s.req({ agent: agentOf({ shell: 'host', browserProfile: true }) }));
    expect(r).toEqual({ ok: false, why: 'withheld' });
    expect(s.lines.map((l) => l.code)).toEqual(['runner.screen.testWorkspace', 'runner.screen.testWorkspace']);
    expect(s.runtimes).toEqual([]);
  });

  it('opens the browser of a sandboxed agent in a test workspace, without its hosts or its logins', async () => {
    const s = setup({ test: true });
    const lease = await s.lease({ agent: agentOf({ shell: 'sandbox', allowedHosts: ['a.example.com'], browserProfile: true }) });
    expect(s.runtimes[0].options.network).toEqual({ mode: 'off', hosts: [] });
    expect(s.runtimes[0].options.profile).toBeNull();
    expect(lease.profile).toBe('none');
    expect(codes(s)).toContain('runner.screen.testWorkspace');
  });

  it('reports a browser that could not start, frees what it took, and leaves nothing registered', async () => {
    const s = setup({ startFails: new BrowserStartError('display', 'no xvfb') });
    const r = await s.sessions.acquire(s.req({ agent: agentOf({ browserProfile: true }) }));
    expect(r).toEqual({ ok: false, why: 'start-failed', detail: 'display' });
    expect(codes(s)).toEqual(['runner.screen.startFailed']);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
    // The profile was let go: another screen of the agent can take it.
    expect(s.locks.holder(join(root, 'browser', 'web'))).toBeNull();
    expect(s.audit).toEqual([]);
  });
});

describe('keeping a screen between messages', () => {
  it('reuses the open screen for the next message: one browser, started once', async () => {
    const s = setup();
    const first = await s.lease();
    first.release();
    const again = await s.lease();
    expect(s.runtimes).toHaveLength(1);
    expect(again.display).toEqual(first.display);
    expect(s.hub.open).toHaveBeenCalledTimes(1);
    expect(s.audit.filter((e) => e.kind === 'screen-open')).toHaveLength(1);
    // Holding it again stops the clock that release started.
    expect(s.clock.live()).toBe(1);
    await s.clock.advance(SCREEN_IDLE_MS + MIN);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
  });

  it('goes without a browser, saying so once, for a second answer while the first is still working', async () => {
    const s = setup();
    await s.lease();
    for (let i = 0; i < 2; i++) expect(await s.sessions.acquire(s.req())).toEqual({ ok: false, why: 'in-use' });
    expect(codes(s).filter((c) => c === 'runner.screen.inUse')).toHaveLength(1);
    expect(s.runtimes).toHaveLength(1);
  });

  it('leaves at most four conversation screens open, and does not count a stage\'s', async () => {
    const s = setup();
    for (let i = 0; i < SCREEN_OPEN_MAX; i++) await s.lease({ key: callKey('t', `a${i}`), agent: agentOf({ id: `a${i}` }) });
    await s.lease({ key: runKey('r1'), thread: 'run-r1', place: 'stage', stage: 'qa' });
    const fifth = await s.sessions.acquire(s.req({ key: callKey('t', 'a9'), agent: agentOf({ id: 'a9' }) }));
    expect(fifth).toEqual({ ok: false, why: 'cap' });
    expect(s.lines.find((l) => l.code === 'runner.screen.capped')?.params).toMatchObject({ agent: 'a9', max: '4' });
    // Closing one makes room.
    await s.sessions.close(callKey('t', 'a0'));
    expect((await s.sessions.acquire(s.req({ key: callKey('t', 'a9'), agent: agentOf({ id: 'a9' }) }))).ok).toBe(true);
  });
});

describe('the idle clock', () => {
  it('closes the screen 10 minutes after the last answer ended, keeping the recording', async () => {
    const s = setup();
    const lease = await s.lease();
    await s.clock.advance(3 * SCREEN_IDLE_MS);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    lease.release();
    await s.clock.advance(SCREEN_IDLE_MS - 1);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    await s.clock.advance(1);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
    expect(s.runtimes[0].closed).toBe(true);
    expect(s.log).toContain('hub.finish');
    expect(s.kept).toHaveLength(1);
    expect(s.audit.find((e) => e.kind === 'screen-close')).toMatchObject({ fields: { reason: 'idle', recording: 'kept' } });
    expect(codes(s).slice(-1)).toEqual(['runner.screen.idleClosed']);
    expect(s.sessions.list()).toEqual([]);
  });

  it('is held open by a browser step in progress', async () => {
    const s = setup();
    const agent = agentOf({ shell: 'sandbox', allowedHosts: ['example.com'] });
    const lease = await s.lease({ agent });
    lease.release();
    const again = await s.lease({ agent });
    let finish!: () => void;
    s.server.state.onAct = () => void 0;
    const slow = s.server.client.callTool;
    s.server.client.callTool = async (name: string, args: Record<string, unknown>) => {
      if (name === 'browser_navigate') await new Promise<void>((r) => (finish = r));
      return slow(name, args);
    };
    const call = again.browser.call('browser_navigate', { url: 'https://example.com/' });
    await new Promise((r) => setImmediate(r));
    // The answer is over but the step is not: the clock does not run.
    again.release();
    expect(s.sessions.list()[0].closesAt).toBeNull();
    await s.clock.advance(2 * SCREEN_IDLE_MS);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    finish();
    await call;
    expect(s.sessions.list()[0].closesAt).not.toBeNull();
    await s.clock.advance(SCREEN_IDLE_MS);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
  });

  it('is held open by a question waiting for the person, and starts again when it is answered', async () => {
    const s = setup();
    const lease = await s.lease();
    const asked = s.asks.confirm({ ...lease.context, confirmKind: 'send', words: 'send the report' });
    lease.release();
    expect(s.sessions.list()[0].closesAt).toBeNull();
    expect(s.sessions.list()[0].pending).toHaveLength(1);
    await s.clock.advance(5 * SCREEN_IDLE_MS);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    s.asks.answer(s.asks.list()[0].id, 'yes', 'window');
    await expect(asked).resolves.toEqual({ answer: 'yes' });
    expect(s.sessions.list()[0].closesAt).not.toBeNull();
    await s.clock.advance(SCREEN_IDLE_MS);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
  });

  it('stops the clocks of the call that holds the screen while a question waits, and starts them when it is answered', async () => {
    const s = setup();
    const events: string[] = [];
    const lease = await s.lease({ pause: () => (events.push('pause'), () => void events.push('resume')) });
    const asked = s.asks.confirm({ ...lease.context, confirmKind: 'send', words: 'send the report' });
    expect(events).toEqual(['pause']);
    s.asks.answer(s.asks.list()[0].id, 'no', 'window');
    await asked;
    expect(events).toEqual(['pause', 'resume']);
    // The call is over: its clock is no longer the screen's to stop.
    lease.release();
    const again = await s.lease();
    const next = s.asks.confirm({ ...again.context, confirmKind: 'send', words: 'send it again' });
    s.asks.answer(s.asks.list()[0].id, 'no', 'window');
    await next;
    expect(events).toEqual(['pause', 'resume']);
  });

  it('starts over when the person uses the screen, and is not touched by someone only watching', async () => {
    const s = setup();
    const lease = await s.lease();
    lease.release();
    await s.clock.advance(SCREEN_IDLE_MS - MIN);
    // Watching is a read of the viewer: nothing in the sessions hears of it.
    s.hub.state(callKey('general', 'web'));
    s.sessions.touch(callKey('general', 'web'));
    await s.clock.advance(SCREEN_IDLE_MS - MIN);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    await s.clock.advance(MIN);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
  });

  it('closes at the workspace\'s time limit however busy the screen is', async () => {
    const s = setup({ config: (c) => void (c.runner.stageMaxMs = 2 * 60 * MIN) });
    await s.lease();
    await s.clock.advance(2 * 60 * MIN - 1);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(true);
    await s.clock.advance(1);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
    expect(s.audit.find((e) => e.kind === 'screen-close')).toMatchObject({ fields: { reason: 'max' } });
    expect(s.lines.at(-1)).toMatchObject({ code: 'runner.screen.closed' });
  });
});

describe('closing a screen', () => {
  it('does its steps in order: the app\'s calls stop, the questions are declined, the recording is kept, the audit is written, the browser ends, the profile is let go', async () => {
    const s = setup();
    const lease = await s.lease({ agent: agentOf({ browserProfile: true }) });
    expect(lease.profile).toBe('own');
    s.log.length = 0;
    const asked = s.asks.confirm({ ...lease.context, confirmKind: 'delete', words: 'delete it' });
    const held = s.locks.holder(join(root, 'browser', 'web'));
    expect(held).toBe('call:general:web');
    let signal = false;
    lease.closed.addEventListener('abort', () => (signal = true));
    await s.sessions.close(callKey('general', 'web'), 'person');
    await expect(asked).resolves.toEqual({ answer: 'closed' });
    expect(signal).toBe(true);
    expect(s.log).toEqual(['audit.screen-confirm', 'hub.finish', 'recording', 'audit.screen-close', 'onClosed', 'runtime.close']);
    expect(s.locks.holder(join(root, 'browser', 'web'))).toBeNull();
    // A call after the close is refused and never reaches the browser.
    const after = await lease.browser.call('browser_snapshot', {});
    expect(after.isError).toBe(true);
    expect(s.server.acts()).toEqual([]);
    expect(codes(s).slice(-1)).toEqual(['runner.screen.closed']);
    expect(s.lines.at(-1)?.params.reason).toBe('the person closed it');
  });

  it('writes one audit line with the steps by tool, the hosts and the way it ended', async () => {
    const s = setup();
    const lease = await s.lease();
    await lease.browser.call('browser_snapshot', {});
    await lease.browser.call('browser_snapshot', {});
    s.runtimes[0].runtime.hosts.decide({ host: 'app.example.com', allowed: true, why: '' } as never);
    s.runtimes[0].runtime.hosts.decide({ host: 'cdn.example.net', allowed: false, why: 'no' } as never);
    await s.sessions.close(callKey('general', 'web'));
    const close = s.audit.filter((e) => e.kind === 'screen-close');
    expect(close).toHaveLength(1);
    expect(close[0].fields).toMatchObject({ reason: 'person', steps: 'browser_snapshot=2', hostsAllowed: 'app.example.com=1', hostsRefused: 'cdn.example.net=1', recording: 'kept' });
    expect(s.lines.find((l) => l.code === 'runner.screen.hostsSummary')?.params).toMatchObject({ allowed: '1', refused: '1', hosts: 'cdn.example.net' });
  });

  it('hands what the screen did to those who learn from it, before the browser is gone', async () => {
    const s = setup();
    const lease = await s.lease({ thread: 'run-r1', key: callKey('run-r1', 'web') });
    await lease.browser.call('browser_snapshot', {});
    expect(s.sessions.stepsOf(callKey('run-r1', 'web'))).toHaveLength(1);
    await s.sessions.close(callKey('run-r1', 'web'), 'stage');
    expect(s.closedSeen).toHaveLength(1);
    expect(s.closedSeen[0]).toMatchObject({ key: 'call:run-r1:web', agent: 'web', thread: 'run-r1', place: 'conversation', reason: 'stage', recording: 'kept' });
    expect(s.closedSeen[0].steps.map((x) => x.tool)).toEqual(['browser_snapshot']);
    expect(s.log.indexOf('onClosed')).toBeLessThan(s.log.indexOf('runtime.close'));
    expect(s.sessions.stepsOf(callKey('run-r1', 'web'))).toEqual([]);
  });

  it('takes a step that is not a call of the browser (the hand-off, #178) into the log, and none for a screen that is not open', async () => {
    const s = setup();
    await s.lease({ thread: 'run-r1', key: callKey('run-r1', 'web') });
    s.sessions.recordStep(callKey('run-r1', 'web'), { tool: 'screen_handoff', site: '', path: '', class: 'free', outcome: 'ok', ms: 4 });
    s.sessions.recordStep(callKey('run-r1', 'gone'), { tool: 'screen_handoff', site: '', path: '', class: 'free', outcome: 'ok', ms: 4 });
    expect(s.sessions.stepsOf(callKey('run-r1', 'web'))).toMatchObject([{ n: 1, tool: 'screen_handoff', class: 'free', outcome: 'ok', site: '', path: '' }]);
    expect(s.sessions.stepsOf(callKey('run-r1', 'web'))[0]).not.toHaveProperty('name');
    await s.sessions.close(callKey('run-r1', 'web'), 'stage');
    expect(s.closedSeen[0].steps.map((x) => x.tool)).toEqual(['screen_handoff']);
  });

  it('throws the recording away when nothing keeps it, and says "none" in the audit', async () => {
    const s = setup({ noKeep: true });
    await s.lease();
    await s.sessions.close(callKey('general', 'web'));
    expect(s.hub.end).toHaveBeenCalledTimes(1);
    expect(s.hub.finish).not.toHaveBeenCalled();
    expect(s.audit.find((e) => e.kind === 'screen-close')).toMatchObject({ fields: { recording: 'none' } });
  });

  it('is idempotent, and false for a key that is not open', async () => {
    const s = setup();
    await s.lease();
    const key = callKey('general', 'web');
    const [a, b] = await Promise.all([s.sessions.close(key), s.sessions.close(key)]);
    expect([a, b]).toEqual([true, true]);
    expect(await s.sessions.close(key)).toBe(false);
    expect(s.log.filter((x) => x === 'runtime.close')).toHaveLength(1);
    expect(s.audit.filter((e) => e.kind === 'screen-close')).toHaveLength(1);
  });

  it('runs what the owner kept for it (a shell session), after the browser, and then the key is free again', async () => {
    const s = setup();
    const onClose = vi.fn(async () => void s.log.push('owner.close'));
    await s.lease({ onClose });
    await s.sessions.close(callKey('general', 'web'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(s.log.slice(-1)).toEqual(['owner.close']);
    expect(s.log.indexOf('runtime.close')).toBeLessThan(s.log.indexOf('owner.close'));
    expect((await s.sessions.acquire(s.req())).ok).toBe(true);
    expect(s.runtimes).toHaveLength(2);
  });

  it('closes when the server ends by itself', async () => {
    const s = setup();
    await s.lease();
    s.runtimes[0].dead();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
    expect(s.audit.find((e) => e.kind === 'screen-close')).toMatchObject({ fields: { reason: 'failed' } });
  });

  it('closes a screen the person closed while its browser was still starting, and the answer goes without it', async () => {
    let start!: () => void;
    const s = setup({ startGate: new Promise<void>((r) => (start = r)) });
    const key = callKey('general', 'web');
    const pending = s.sessions.acquire(s.req());
    // The key is registered as soon as the screen begins to open.
    await vi.waitFor(() => expect(s.sessions.has(key)).toBe(true));
    expect(await s.sessions.close(key, 'person')).toBe(true);
    start();
    expect(await pending).toEqual({ ok: false, why: 'closing' });
    expect(s.sessions.has(key)).toBe(false);
    expect(s.runtimes[0].closed).toBe(true);
  });
});

describe('what closes the screens of a group', () => {
  it('closes by thread, by agent, and all of them when the app quits', async () => {
    const s = setup();
    await s.lease({ key: callKey('t1', 'web'), thread: 't1' });
    await s.lease({ key: callKey('t2', 'web'), thread: 't2' });
    await s.lease({ key: callKey('t2', 'ops'), thread: 't2', agent: agentOf({ id: 'ops' }) });
    expect(await s.sessions.closeThread('t1')).toBe(1);
    expect(s.sessions.keysOfAgent('web')).toEqual(['call:t2:web']);
    expect(await s.sessions.closeAgent('web')).toBe(1);
    expect(s.sessions.list().map((x) => x.key)).toEqual(['call:t2:ops']);
    await s.sessions.endAll();
    expect(s.sessions.list()).toEqual([]);
    expect(s.audit.filter((e) => e.kind === 'screen-close').map((e) => e.fields.reason)).toEqual(['thread', 'config', 'quit']);
  });

  it.each([
    ['the agent is removed', (c: WorkspaceConfig) => void (c.agents.team = c.agents.team.filter((a) => a.id !== 'web'))],
    ['its switch goes off', (c: WorkspaceConfig) => void (c.agents.team.find((a) => a.id === 'web')!.screen = false)],
    ['its shell changes', (c: WorkspaceConfig) => void (c.agents.team.find((a) => a.id === 'web')!.shell = 'host')],
    ['the workspace\'s display goes off', (c: WorkspaceConfig) => void (c.runner.sandbox.display = false)],
  ])('closes when %s, and leaves a screen whose agent is untouched', async (_name, change) => {
    const s = setup();
    const base = neutralConfig();
    const team = (shell: AgentDef['shell']) => ({ ...base.agents.team[0], id: 'web', screen: true, shell }) as AgentDef;
    s.config.agents.team = [...s.config.agents.team, team('none'), { ...team('none'), id: 'ops' }];
    await s.lease({ key: callKey('t', 'web'), thread: 't' });
    await s.lease({ key: callKey('t', 'ops'), thread: 't', agent: agentOf({ id: 'ops' }) });
    const next = structuredClone(s.config);
    change(next);
    const closed = await s.sessions.reconcile(next);
    if (change.toString().includes('display')) expect(closed).toBe(2);
    else {
      expect(closed).toBe(1);
      expect(s.sessions.list().map((x) => x.key)).toEqual(['call:t:ops']);
    }
    expect(s.audit.filter((e) => e.kind === 'screen-close').every((e) => (e.fields as Record<string, string>).reason === 'config')).toBe(true);
  });

  it.each([
    ['its hosts change', (c: WorkspaceConfig) => void (c.agents.team.find((a) => a.id === 'web')!.allowedHosts = ['app.example.com'])],
    ['its logged-in browser is switched on', (c: WorkspaceConfig) => void (c.agents.team.find((a) => a.id === 'web')!.browserProfile = true)],
    ['the workspace\'s network changes', (c: WorkspaceConfig) => void ((c.runner.sandbox.network = 'registry'), (c.runner.sandbox.registryHosts = ['registry.example.com']))],
  ])('closes the open screen, saying so, when %s, and leaves the screen of an agent the change does not touch', async (_name, change) => {
    const s = setup();
    const base = neutralConfig();
    const team = (id: string) => ({ ...base.agents.team[0], id, screen: true, shell: 'sandbox' }) as AgentDef;
    s.config.agents.team = [...s.config.agents.team, team('web'), team('ops')];
    await s.lease({ key: callKey('t', 'web'), thread: 't', agent: agentOf({ shell: 'sandbox' }) });
    await s.lease({ key: callKey('t', 'ops'), thread: 't', agent: agentOf({ id: 'ops', shell: 'sandbox' }) });
    const next = structuredClone(s.config);
    change(next);
    const closed = await s.sessions.reconcile(next);
    // A change to the workspace's network reaches every screen; one agent's own switches reach that agent's.
    expect(closed).toBe(change.toString().includes('runner') ? 2 : 1);
    if (closed === 1) expect(s.sessions.list().map((x) => x.key)).toEqual(['call:t:ops']);
    expect(s.audit.filter((e) => e.kind === 'screen-close').every((e) => (e.fields as Record<string, string>).reason === 'config')).toBe(true);
    expect(codes(s)).toContain('runner.screen.closed');
  });

  it('leaves everything open when the settings changed in something that does not matter to a screen', async () => {
    const s = setup();
    s.config.agents.team = [...s.config.agents.team, { ...s.config.agents.team[0], id: 'web', screen: true, shell: 'none' } as AgentDef];
    await s.lease();
    const next = structuredClone(s.config);
    next.runner.maxConcurrentRuns = 7;
    expect(await s.sessions.reconcile(next)).toBe(0);
  });
});

describe('the logged-in browser', () => {
  it('goes to the first screen of the agent, and a second one gets a fresh browser with a line that says so', async () => {
    const s = setup();
    const first = await s.lease({ agent: agentOf({ browserProfile: true }) });
    expect(first.profile).toBe('own');
    expect(s.runtimes[0].options.profile).toBe(join(root, 'browser', 'web'));
    const second = await s.lease({ key: callKey('t2', 'web'), thread: 't2', agent: agentOf({ browserProfile: true }) });
    expect(second.profile).toBe('fresh');
    expect(s.runtimes[1].options.profile).toBeNull();
    const busy = s.lines.find((l) => l.code === 'runner.screen.profileBusy');
    expect(busy).toMatchObject({ thread: 't2', params: { agent: 'web', owner: 'call:general:web' } });
    expect(s.sessions.list().map((x) => [x.key, x.profile])).toEqual([['call:general:web', 'own'], ['call:t2:web', 'fresh']]);
  });

  it('is let go when the screen closes, so the next screen has it again', async () => {
    const s = setup();
    await s.lease({ agent: agentOf({ browserProfile: true }) });
    await s.sessions.close(callKey('general', 'web'));
    const next = await s.lease({ key: callKey('t2', 'web'), thread: 't2', agent: agentOf({ browserProfile: true }) });
    expect(next.profile).toBe('own');
  });

  it('is not taken by an agent that did not ask for it', async () => {
    const s = setup();
    const lease = await s.lease();
    expect(lease.profile).toBe('none');
    expect(s.locks.holder(join(root, 'browser', 'web'))).toBeNull();
  });

  it('falls back to a fresh browser, saying why, when the folder cannot be made safe', async () => {
    const s = setup();
    // The agent's id is a folder name: one that is not a plain id cannot have a profile.
    const lease = await s.lease({ agent: agentOf({ id: 'Web/..', browserProfile: true }) });
    expect(lease.profile).toBe('fresh');
    expect(s.lines.find((l) => l.code === 'runner.screen.profileFailed')?.params.reason).toMatch(/id/);
  });
});

describe('the lifecycle of a screen that is starting', () => {
  const settled = (p: Promise<unknown>): Promise<boolean> => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30))]);

  it('checks the cap again once the sandbox has answered, so two answers that began together do not both take the last place', async () => {
    let gate: Promise<void> = Promise.resolve();
    const s = setup({ sandboxGate: () => gate });
    for (let i = 0; i < SCREEN_OPEN_MAX - 1; i++) await s.lease({ key: callKey(`c${i}`, 'web'), thread: `c${i}` });
    let ready!: () => void;
    gate = new Promise<void>((r) => (ready = r));
    const a = s.sessions.acquire(s.req({ key: callKey('x1', 'web'), thread: 'x1' }));
    const b = s.sessions.acquire(s.req({ key: callKey('x2', 'web'), thread: 'x2' }));
    ready();
    const got = await Promise.all([a, b]);
    expect(got.filter((r) => r.ok)).toHaveLength(1);
    expect(got.filter((r) => !r.ok)).toEqual([{ ok: false, why: 'cap' }]);
    expect(s.sessions.list()).toHaveLength(SCREEN_OPEN_MAX);
  });

  it('gives a start up when the call is stopped, closes the browser that comes up late and lets the profile go', async () => {
    let start!: () => void;
    const s = setup({ startGate: new Promise<void>((r) => (start = r)) });
    const stop = new AbortController();
    const pending = s.sessions.acquire(s.req({ agent: agentOf({ browserProfile: true }), signal: stop.signal }));
    await vi.waitFor(() => expect(s.sessions.has(callKey('general', 'web'))).toBe(true));
    stop.abort();
    expect(await pending).toEqual({ ok: false, why: 'closing' });
    // The browser has not come up yet: the profile is still held, and the key with it.
    expect(s.locks.holder(join(root, 'browser', 'web'))).not.toBeNull();
    start();
    await vi.waitFor(() => expect(s.sessions.has(callKey('general', 'web'))).toBe(false));
    expect(s.runtimes[0].closed).toBe(true);
    expect(s.locks.holder(join(root, 'browser', 'web'))).toBeNull();
    expect(s.audit.filter((e) => e.kind === 'screen-open' || e.kind === 'screen-close')).toEqual([]);
    expect((await s.sessions.acquire(s.req())).ok).toBe(true);
  });

  it('does not begin to start for a call that was stopped already', async () => {
    const s = setup();
    const stop = new AbortController();
    stop.abort();
    expect(await s.sessions.acquire(s.req({ signal: stop.signal }))).toEqual({ ok: false, why: 'closing' });
    expect(s.runtimes).toHaveLength(0);
  });

  it('gives up when the call is stopped while the sandbox is being asked', async () => {
    let ready!: () => void;
    const gate = new Promise<void>((r) => (ready = r));
    const s = setup({ sandboxGate: () => gate });
    const stop = new AbortController();
    const pending = s.sessions.acquire(s.req({ signal: stop.signal }));
    stop.abort();
    ready();
    expect(await pending).toEqual({ ok: false, why: 'closing' });
    expect(s.runtimes).toHaveLength(0);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
  });

  it('waits at quit for a screen that is still starting, and no browser is left up behind it', async () => {
    let start!: () => void;
    const s = setup({ startGate: new Promise<void>((r) => (start = r)) });
    const pending = s.sessions.acquire(s.req());
    await vi.waitFor(() => expect(s.sessions.has(callKey('general', 'web'))).toBe(true));
    const ending = s.sessions.endAll();
    expect(await settled(ending)).toBe(false);
    start();
    await ending;
    expect(await pending).toEqual({ ok: false, why: 'closing' });
    expect(s.runtimes[0].closed).toBe(true);
    expect(s.sessions.has(callKey('general', 'web'))).toBe(false);
    // And nothing opens after the app said it was done.
    expect(await s.sessions.acquire(s.req())).toEqual({ ok: false, why: 'closing' });
  });
});
