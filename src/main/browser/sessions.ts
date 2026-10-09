import { basename } from 'node:path';
import { SCREEN_IDLE_MS, SCREEN_OPEN_MAX, type OpenScreenInfo, type StepEntry, parseKey } from '../../shared/browser';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import type { RecordingOutcome } from '../screen/recorder';
import type { ScreenHub } from '../screen/hub';
import { type AuditSink, type ScreenEnd, type ScreenMode, type ScreenPlace, auditScreen } from './audit';
import { type AskContext, type ScreenAsks } from './asks';
import { type ScreenGrants, withheldText } from './guard';
import { type Intermediary, createIntermediary } from './intermediary';
import { BrowserStartError, type BrowserRuntime, type BrowserStartOptions } from './launch';
import { safeHost, summaryParams } from './hosts';
import { type MaskSet, createMaskSet } from './mask';
import { type OpenedProfile, ProfileError } from './profile';
import { browserNetwork } from './policy';
import { type StepInput, type StepLog, createStepLog } from './stepLog';

// The screens of the agents that have one: a registry of open sessions, one per screen key. A session holds the app's browser (the server, the browser and the profile lock), the
// intermediary the agent's calls pass through, the display it draws on and the clocks that end it. It is opened by the first answer of an agent that has a screen, reused by the next
// ones, and ends at the first of: the person closes it, 10 minutes without use, two hours, the agent or the settings change, its thread or its run's stage goes away, the app quits.
//
// What keeps a screen open: an answer that is running (the lease), a step of the browser in progress, a question waiting for the person, and the person's own input on the
// screen. Watching does not: a viewer left open on a phone pins nothing. Everything outside this file (the browser, the display, the recording, the thread, the clocks) comes in
// as an argument, so the tests drive it with a fake clock and a fake browser.

export type Refusal = 'agent' | 'platform' | 'disabled' | 'withheld' | 'cap' | 'in-use' | 'closing' | 'no-browsers' | 'no-sandbox' | 'start-failed';

/** What an answer holds while it works with a screen. */
export interface ScreenLease {
  key: string;
  /** The app's browser: its tools and its calls. Calls are taken one at a time and never throw. */
  browser: Pick<Intermediary, 'tools' | 'call'>;
  /** Where a question to the person comes from; `screen_confirm` asks through it. */
  context: AskContext;
  profile: 'own' | 'fresh' | 'none';
  display: { socket: string; name: string; own: boolean } | null;
  /** Aborted when the screen closes: an answer that is running stops with it. */
  closed: AbortSignal;
  /** The answer is over: the screen's idle clock starts when nothing else holds it. Idempotent. */
  release(): void;
}

export type Acquired = { ok: true; lease: ScreenLease } | { ok: false; why: Refusal; detail?: string };

export interface AcquireRequest {
  key: string;
  agent: Pick<AgentDef, 'id' | 'screen' | 'allowedHosts' | 'browserProfile' | 'shell'>;
  thread: string;
  place: ScreenPlace;
  /** The stage, when the screen is a stage's. */
  stage?: string;
  /** The issue of the run the screen belongs to (for the audit). */
  issue?: number;
  /** The number of the message that asked (for the audit). */
  message?: number;
  /** The display of the agent's shell session, lent to the browser; absent: the app starts a display of its own. */
  display?: { socket: string; kind: 'sandbox' | 'host' } | null;
  /** Whether the agent's engine takes images. */
  seesImages: boolean;
  /** Runs when the screen ends, after the browser is gone: whatever the caller kept for it (a shell session). */
  onClose?: () => Promise<void> | void;
  /** The clocks of the call that holds the screen (a stage's watchdog, an answer's): they stand still while a question to the person waits. */
  pause?: () => () => void;
  /** Aborted when the call is stopped: a screen that is still starting is given up (the browser that comes up late is closed), and nothing is left open for it. */
  signal?: AbortSignal;
}

/** What the screen was when it ended, handed to those who learn from it (the procedure memory) before its folder is removed. */
export interface ClosedScreen {
  key: string;
  agent: string;
  thread: string;
  place: ScreenPlace;
  stage: string;
  reason: ScreenEnd;
  sites: string[];
  steps: readonly StepEntry[];
  recording: 'kept' | 'not' | 'none';
}

export interface BrowsersFound {
  ok: true;
  browsers: string;
  chromium: string;
}

export interface SessionDeps {
  /** Linux only: the display, the sandbox and the browser exist nowhere else. */
  enabled: boolean;
  config(): WorkspaceConfig;
  /** The browsers folder and the Chromium in it, or why there is none. */
  browsers(): BrowsersFound | { ok: false; why: string };
  /** Whether a sandbox can be made on this computer. */
  sandboxReady(): Promise<boolean>;
  /** Where the session folders are made (the sandbox's own, which the start-up purge walks). */
  dir: string;
  /** What the workspace lets through of the agent's three switches. */
  grants(agent: AcquireRequest['agent']): ScreenGrants;
  /** The agent's logged-in profile, locked for the screen; throws `ProfileError`. */
  openProfile(agentId: string, owner: string): OpenedProfile;
  start(options: BrowserStartOptions): Promise<BrowserRuntime>;
  asks: ScreenAsks;
  /** The live screen of the display: the viewer, control and the recording. Absent: the screen cannot be watched. */
  hub?: Pick<ScreenHub, 'open' | 'finish' | 'end' | 'state'>;
  /** A line the app writes in the thread (a system line with a catalog code and its parameters). */
  say(thread: string, stage: string, code: string, params: Record<string, string>): void;
  /** Keeps the recording of a screen that closes; answers whether it did. Absent: the recording is thrown away. */
  keepRecording?(screen: ClosedScreen, outcome: RecordingOutcome | null): Promise<'kept' | 'not'> | 'kept' | 'not';
  /** A session opened, got a closing time, or ended: the lists refresh. It carries the screen's key. */
  changed?(key: string): void;
  audit?: AuditSink;
  now?: () => number;
  /** Calls `fn` after `ms`; returns what cancels it. */
  schedule?: (ms: number, fn: () => void) => () => void;
  idleMs?: number;
  openMax?: number;
}

interface Session {
  key: string;
  agent: string;
  thread: string;
  stage: string;
  place: ScreenPlace;
  issue?: number;
  mode: ScreenMode;
  /** What the agent's switches were when the screen opened: a change closes it. */
  shell: AgentDef['shell'];
  /** The network the browser has and whether the agent's logged-in profile was granted, as they were when the screen opened: a change closes it. */
  setup: string;
  profile: 'own' | 'fresh' | 'none';
  since: number;
  state: 'opening' | 'open' | 'closing';
  runtime: BrowserRuntime | null;
  inter: Intermediary | null;
  masks: MaskSet;
  log: StepLog;
  /** The highest step number the procedure memory has drafted past (#187): a draft starts after it. Starts at 0 with the screen and dies with it. */
  mark: number;
  /** Which opening of the key this is: 1, 2, … for the app's life. A key is reused by every stage of a run and every screen of a thread, so only this tells two screens apart. */
  instance: number;
  /** Answers that hold the screen now. */
  answers: number;
  /** The clocks of the calls that hold it, stopped together with the screen's own while a question waits. */
  pauses: Set<() => () => void>;
  /** Steps of the browser in progress. */
  steps: number;
  /** Questions to the person that wait (they stop the clocks). */
  paused: number;
  idleAt: number | null;
  cancelIdle: (() => void) | null;
  cancelMax: (() => void) | null;
  abort: AbortController;
  hubOwned: boolean;
  releaseProfile: (() => void) | null;
  onClose?: () => Promise<void> | void;
  closing: Promise<void> | null;
  /** A close that was asked while the browser was still starting: done as soon as it is up. */
  pendingClose: ScreenEnd | null;
  /** Gives up the start of the browser (the app is quitting). */
  startAbort: AbortController;
  /** Settles when the screen is gone from the registry, whichever way it got there. */
  ended: Promise<void>;
  markEnded: () => void;
}

export interface ScreenSessions {
  /** Opens the screen of a key, or reuses the one that is open and idle; or says in the thread why it cannot, once. */
  acquire(request: AcquireRequest): Promise<Acquired>;
  /** The open screens, of one thread or of all. */
  list(thread?: string): OpenScreenInfo[];
  /** Whether a screen is open, or opening, for the key. */
  has(key: string): boolean;
  /** Whether an open screen is registered with the live hub, so the person can watch it and take it. */
  watched(key: string): boolean;
  /** The agent's screens that hold its profile or not: the keys of its open screens. */
  keysOfAgent(agent: string): string[];
  /** The steps the app's browser took on an open screen, for the procedure memory; empty when there is none. */
  stepsOf(key: string): readonly StepEntry[];
  /** The step number the next screen draft starts after; 0 for a screen with no mark yet and for one that is not open. */
  markOf(key: string): number;
  /** Moves an open screen's draft mark to a step number (#187); nothing when there is no such screen. The caller keeps it from going back. */
  mark(key: string, n: number): void;
  /** Which opening of the key an open screen is (never 0); 0 when there is none. A mark belongs to one opening: a screen opened again under the same key starts over. */
  instanceOf(key: string): number;
  /** Adds a step that is not a call of the app's browser (the hand-off, #178) to an open screen's log; nothing when there is no such screen. */
  recordStep(key: string, step: StepInput): void;
  /** The masks of an open screen: the place where what the page shows is filtered before the agent reads it. */
  masksOf(key: string): MaskSet | null;
  /** The person used the screen: its idle clock starts over. */
  touch(key: string): void;
  /** Ends a screen; false when there is none. Idempotent. */
  close(key: string, reason?: ScreenEnd): Promise<boolean>;
  closeThread(thread: string, reason?: ScreenEnd): Promise<number>;
  closeAgent(agent: string, reason?: ScreenEnd): Promise<number>;
  /** The settings changed: closes the screens whose agent is gone, lost the screen or changed its shell, whose hosts, logged-in profile or network changed, or whose workspace display went off. */
  reconcile(config: WorkspaceConfig): Promise<number>;
  /** The app is quitting: every screen ends, those still starting included (they are waited for). */
  endAll(): Promise<void>;
  /** Told once for each screen that ends, with what it did, before its folder is removed. Returns the way to stop being told. */
  onClosed(fn: (screen: ClosedScreen) => void): () => void;
}

/** What a screen was opened with that a change of the settings must close it for: the network of its browser, and whether its agent's logged-in profile was granted. */
const setupOf = (network: unknown, profile: boolean): string => JSON.stringify([network, profile]);
const modeOf = (shell: AgentDef['shell']): ScreenMode => (shell === 'host' ? 'host' : shell === 'sandbox' ? 'sandbox' : 'none');

export function createScreenSessions(d: SessionDeps): ScreenSessions {
  const now = d.now ?? Date.now;
  const schedule =
    d.schedule ??
    ((ms, fn) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return () => clearTimeout(timer);
    });
  const idleMs = d.idleMs ?? SCREEN_IDLE_MS;
  const openMax = d.openMax ?? SCREEN_OPEN_MAX;
  const sessions = new Map<string, Session>();
  let quitting = false;
  let opened = 0;
  const listeners = new Set<(screen: ClosedScreen) => void>();
  /** The refusals already said, by key and reason: a conversation says why it has no screen once, not at every message. */
  const said = new Set<string>();

  const changed = (key: string): void => {
    try {
      d.changed?.(key);
    } catch {
      // A listener that fails is not the screen's to know.
    }
  };
  const tell = (s: { thread: string; stage?: string }, code: string, params: Record<string, string>): void => {
    try {
      d.say(s.thread, s.stage ?? '', `runner.screen.${code}`, params);
    } catch (e) {
      console.error('[browser] could not write a line about a screen', e instanceof Error ? e.message : e);
    }
  };
  const tellOnce = (req: AcquireRequest, code: string, params: Record<string, string>): void => {
    const mark = `${req.key}|${code}|${params.reason ?? params.what ?? ''}`;
    if (said.has(mark)) return;
    said.add(mark);
    tell({ thread: req.thread, stage: req.stage }, code, { agent: req.agent.id, ...params });
  };

  /** The idle clock follows what holds the screen: running while nothing does, stopped while something does. */
  const settle = (s: Session): void => {
    if (s.state !== 'open') return;
    const busy = s.answers + s.steps + s.paused > 0;
    if (busy) {
      if (s.cancelIdle) {
        s.cancelIdle();
        s.cancelIdle = null;
        s.idleAt = null;
        changed(s.key);
      }
      return;
    }
    if (s.cancelIdle) return;
    s.idleAt = now() + idleMs;
    s.cancelIdle = schedule(idleMs, () => {
      s.cancelIdle = null;
      s.idleAt = null;
      void close(s.key, 'idle');
    });
    changed(s.key);
  };

  /** The same clock started over from now (the person used the screen). */
  const touch = (key: string): void => {
    const s = sessions.get(key);
    if (!s || s.state !== 'open' || !s.cancelIdle) return;
    s.cancelIdle();
    s.cancelIdle = null;
    s.idleAt = null;
    settle(s);
  };

  async function end(s: Session, reason: ScreenEnd): Promise<void> {
    s.state = 'closing';
    s.abort.abort();
    s.cancelIdle?.();
    s.cancelIdle = null;
    s.idleAt = null;
    s.cancelMax?.();
    s.cancelMax = null;
    changed(s.key);
    // 1. Nothing new is taken; 2. what waits for the person is declined and the passes are forgotten.
    s.inter?.close();
    d.asks.declineAll(s.key);
    d.asks.forget(s.key);

    const rt = s.runtime;
    const steps = s.log.entries();
    // The recording is kept while the browser and the display are still there.
    let recording: 'kept' | 'not' | 'none' = 'none';
    const base = { key: s.key, agent: s.agent, thread: s.thread, place: s.place, stage: s.stage, reason };
    if (s.hubOwned && d.hub) {
      try {
        if (d.keepRecording) {
          const outcome = await d.hub.finish(s.key).catch(() => null);
          recording = await Promise.resolve(d.keepRecording({ ...base, sites: [], steps, recording: 'none' }, outcome)).catch(() => 'not' as const);
        } else d.hub.end(s.key);
      } catch (e) {
        console.error('[browser] could not keep the recording of a screen', e instanceof Error ? e.message : e);
        recording = 'not';
      }
    }

    // 3. The audit line and the thread's: counts, never a value.
    const summary = rt?.hosts.summary() ?? { allowed: {}, refused: {} };
    try {
      auditScreen.closed({ key: s.key, agent: s.agent, place: s.place, ...(s.issue ? { issue: s.issue } : {}), mode: s.mode, reason, ms: now() - s.since, steps: s.log.counts(), hostsAllowed: summary.allowed, hostsRefused: summary.refused, recording }, d.audit);
    } catch (e) {
      console.error('[browser] could not audit a screen', e instanceof Error ? e.message : e);
    }
    const sites = [...new Set([...steps.map((x) => x.site), ...Object.keys(summary.allowed)].filter(Boolean))];
    for (const fn of [...listeners]) {
      try {
        fn({ ...base, sites, steps, recording });
      } catch (e) {
        console.error('[browser] a screen\'s listener failed', e instanceof Error ? e.message : e);
      }
    }

    // 4. The server, the browser, the proxy and a display of its own: only the runtime ends them. 5. Then the profile is let go.
    try {
      await rt?.close();
    } catch (e) {
      console.error('[browser] could not close a screen\'s browser', e instanceof Error ? e.message : e);
    }
    try {
      s.releaseProfile?.();
    } catch {
      // The lock is in memory and goes with the process anyway.
    }
    s.releaseProfile = null;
    try {
      await s.onClose?.();
    } catch (e) {
      console.error('[browser] could not release what a screen kept', e instanceof Error ? e.message : e);
    }
    sessions.delete(s.key);
    s.markEnded();
    for (const mark of [...said]) if (mark.startsWith(`${s.key}|`)) said.delete(mark);
    if (reason === 'idle') tell(s, 'idleClosed', { agent: s.agent, minutes: String(Math.round(idleMs / 60_000)) });
    else tell(s, 'closed', { agent: s.agent, reason: t(`main.browser.end.${reason}`) });
    const line = summaryParams(summary);
    if (line) tell(s, 'hostsSummary', { agent: s.agent, allowed: String(line.allowed), refused: String(line.refused), hosts: line.hosts });
    changed(s.key);
  }

  function close(key: string, reason: ScreenEnd = 'person'): Promise<boolean> {
    const s = sessions.get(key);
    if (!s) return Promise.resolve(false);
    if (s.state === 'opening') {
      s.pendingClose ??= reason;
      return Promise.resolve(true);
    }
    s.closing ??= end(s, reason).catch((e) => console.error('[browser] a screen did not close cleanly', e instanceof Error ? e.message : e));
    return s.closing.then(() => true);
  }

  const leaseOf = (s: Session, context: AskContext, pause?: () => () => void): ScreenLease => {
    let released = false;
    if (pause) s.pauses.add(pause);
    return {
      key: s.key,
      browser: s.inter as Intermediary,
      context,
      profile: s.profile,
      display: s.runtime?.display ?? null,
      closed: s.abort.signal,
      release() {
        if (released) return;
        released = true;
        if (pause) s.pauses.delete(pause);
        s.answers = Math.max(0, s.answers - 1);
        settle(s);
      },
    };
  };

  const contextOf = (s: Session): AskContext => ({
    key: s.key,
    agent: s.agent,
    place: s.place,
    ...(s.issue ? { issue: s.issue } : {}),
    // A question to the person stops the clocks of the screen, and of the calls that hold it, while it waits.
    pause: () => {
      s.paused++;
      settle(s);
      const calls: (() => void)[] = [];
      for (const p of s.pauses) {
        try {
          calls.push(p());
        } catch {
          // A clock that cannot be stopped is the caller's.
        }
      }
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        for (const resume of calls) {
          try {
            resume();
          } catch {
            // Likewise.
          }
        }
        s.paused = Math.max(0, s.paused - 1);
        settle(s);
      };
    },
  });

  async function acquire(req: AcquireRequest): Promise<Acquired> {
    if (!req.agent.screen) return { ok: false, why: 'agent' };
    if (!d.enabled) return { ok: false, why: 'platform' };
    if (quitting || req.signal?.aborted) return { ok: false, why: 'closing' };
    const config = d.config();
    if (!config.runner.sandbox.display) {
      tellOnce(req, 'noBrowser', { reason: t('main.browser.noBrowser.disabled') });
      return { ok: false, why: 'disabled' };
    }

    const open = sessions.get(req.key);
    if (open) {
      // A screen keeps its agent's answer: a second answer for the same key while the first runs goes without a browser.
      if (open.state !== 'open' || open.answers > 0) {
        if (open.state === 'open') tellOnce(req, 'inUse', {});
        return { ok: false, why: open.state === 'open' ? 'in-use' : 'closing' };
      }
      open.answers++;
      settle(open);
      return { ok: true, lease: leaseOf(open, contextOf(open), req.pause) };
    }

    const grants = d.grants(req.agent);
    for (const w of grants.withheld) tellOnce(req, 'testWorkspace', { what: withheldText(w) });
    if (!grants.browser) return { ok: false, why: 'withheld' };

    const capped = (): boolean => {
      if (req.place !== 'conversation' || [...sessions.values()].filter((s) => s.place === 'conversation').length < openMax) return false;
      tellOnce(req, 'capped', { max: String(openMax) });
      return true;
    };
    if (capped()) return { ok: false, why: 'cap' };

    const found = d.browsers();
    if (!found.ok) {
      tellOnce(req, 'noBrowser', { reason: t(`main.browser.noBrowser.${found.why}`) });
      return { ok: false, why: 'no-browsers', detail: found.why };
    }
    if (!(await d.sandboxReady())) {
      tellOnce(req, 'noBrowser', { reason: t('main.browser.noBrowser.noSandbox') });
      return { ok: false, why: 'no-sandbox' };
    }
    // Another answer may have taken the key while the sandbox was being asked, or the last place under the cap; the call may have been stopped.
    if (quitting || req.signal?.aborted) return { ok: false, why: 'closing' };
    if (sessions.has(req.key)) return acquire(req);
    if (capped()) return { ok: false, why: 'cap' };

    const network = browserNetwork(config.runner.sandbox, req.agent, grants.allowedHosts);
    let markEnded: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => (markEnded = resolve));
    const s: Session = {
      key: req.key,
      agent: req.agent.id,
      thread: req.thread,
      stage: req.stage ?? '',
      place: req.place,
      ...(req.issue ? { issue: req.issue } : {}),
      mode: modeOf(req.agent.shell),
      shell: req.agent.shell,
      setup: setupOf(network, grants.profile),
      profile: 'none',
      since: now(),
      state: 'opening',
      runtime: null,
      inter: null,
      masks: createMaskSet(),
      log: createStepLog(undefined, now),
      mark: 0,
      instance: ++opened,
      answers: 1,
      pauses: new Set(),
      steps: 0,
      paused: 0,
      idleAt: null,
      cancelIdle: null,
      cancelMax: null,
      abort: new AbortController(),
      hubOwned: false,
      releaseProfile: null,
      onClose: req.onClose,
      closing: null,
      pendingClose: null,
      startAbort: new AbortController(),
      ended,
      markEnded,
    };
    sessions.set(req.key, s);

    // The profile: the agent's logged-in one when the person gave it and nobody else has it, a fresh one when it is in use or cannot be made safe.
    let profileDir: string | null = null;
    if (grants.profile) {
      try {
        const opened = d.openProfile(req.agent.id, req.key);
        if (opened.ok) {
          profileDir = opened.dir;
          s.releaseProfile = opened.release;
          s.profile = 'own';
        } else {
          s.profile = 'fresh';
          tell(req, 'profileBusy', { agent: req.agent.id, owner: opened.owner });
        }
      } catch (e) {
        s.profile = 'fresh';
        tell(req, 'profileFailed', { agent: req.agent.id, reason: e instanceof ProfileError ? t(`main.browser.profile.${e.code}`) : t('main.browser.profile.create') });
      }
    }

    const display = req.display ? { socket: req.display.socket, name: basename(req.display.socket) } : null;
    let runtime: BrowserRuntime;
    const starting = d.start({
      dir: d.dir,
      config: config.runner.sandbox,
      network,
      profile: profileDir,
      display,
      browsers: found.browsers,
      chromium: found.chromium,
      seesImages: req.seesImages,
      onFirstRefusal: (host) => {
        const shown = safeHost(host);
        if (shown) tell(s, 'firstRefusal', { agent: s.agent, host: shown });
      },
    });
    // A call that is stopped, or an app that quits, gives the start up; the browser that comes up late is closed, and only then is the profile let go.
    const stop = new Promise<'given-up'>((resolve) => {
      const fire = (): void => resolve('given-up');
      for (const sig of [req.signal, s.startAbort.signal]) {
        if (!sig) continue;
        if (sig.aborted) fire();
        else sig.addEventListener('abort', fire, { once: true });
      }
    });
    try {
      const first = await Promise.race([starting, stop]);
      if (first === 'given-up') {
        s.state = 'closing';
        // Nothing was opened, so there is nothing for `end` to audit or say: a close that comes now just waits for this.
        s.closing = s.ended;
        changed(s.key);
        void starting
          .then((late) => late.close())
          .catch(() => undefined)
          .finally(() => {
            try {
              s.releaseProfile?.();
            } catch {
              // Let go with the process at the latest.
            }
            s.releaseProfile = null;
            sessions.delete(req.key);
            s.markEnded();
            changed(s.key);
          });
        return { ok: false, why: 'closing' };
      }
      runtime = first;
    } catch (e) {
      sessions.delete(req.key);
      s.markEnded();
      try {
        s.releaseProfile?.();
      } catch {
        // Let go with the process at the latest.
      }
      s.releaseProfile = null;
      const code = e instanceof BrowserStartError ? e.code : 'server';
      if (!(e instanceof BrowserStartError)) console.error('[browser] the app\'s browser did not start', e instanceof Error ? e.message : e);
      else console.error('[browser] the app\'s browser did not start:', e.message.slice(0, 300));
      tell(req, 'startFailed', { agent: s.agent, reason: t(`main.browser.start.${code}`) });
      return { ok: false, why: 'start-failed', detail: code };
    }
    s.runtime = runtime;

    const context = contextOf(s);
    s.inter = createIntermediary({
      client: runtime.client,
      network,
      hosts: runtime.hosts,
      masks: s.masks,
      log: s.log,
      gate: d.asks.gate(context),
      seesImages: req.seesImages,
      hide: [`${runtime.sessionDir}/out`],
      onStep: (phase) => {
        s.steps = Math.max(0, s.steps + (phase === 'start' ? 1 : -1));
        settle(s);
      },
      now,
    });
    // The server ending by itself ends the screen: nothing is left to drive.
    runtime.client.onClose(() => void close(s.key, 'failed'));

    tell(s, 'opened', { agent: s.agent, minutes: String(Math.round(idleMs / 60_000)) });
    // The viewer: the screen is registered with the hub, whose recording and input marks it shares. A stage's screen is the executor's own (`run:<id>`).
    const parsed = parseKey(req.key);
    if (d.hub && parsed?.kind === 'call' && runtime.display) {
      const watched = await d.hub.open({ key: req.key, thread: req.thread, stage: s.stage, agent: s.agent, socket: runtime.display.socket, kind: req.display?.kind ?? 'sandbox' });
      s.hubOwned = watched;
      if (!watched) tell(req, 'noWatch', { agent: s.agent });
    }

    s.state = 'open';
    // Closed while the browser was starting (the person closed it, the settings changed): it is closed now, and the answer goes without it.
    if (s.pendingClose) {
      await close(s.key, s.pendingClose);
      return { ok: false, why: 'closing' };
    }
    const max = Math.max(1, config.runner.stageMaxMs);
    s.cancelMax = schedule(max, () => void close(s.key, 'max'));
    try {
      auditScreen.opened({ key: s.key, agent: s.agent, place: s.place, ...(s.issue ? { issue: s.issue } : {}), mode: s.mode, path: req.display ? 'both' : 'app-browser', profile: s.profile, ...(req.message !== undefined ? { message: req.message } : {}) }, d.audit);
    } catch (e) {
      console.error('[browser] could not audit a screen', e instanceof Error ? e.message : e);
    }
    changed(s.key);
    // Stopped while the last of it was being done: the answer does not use the screen, which stays for the idle clock to end.
    if (req.signal?.aborted) {
      s.answers = Math.max(0, s.answers - 1);
      settle(s);
      return { ok: false, why: 'closing' };
    }
    return { ok: true, lease: leaseOf(s, context, req.pause) };
  }

  const infoOf = (s: Session): OpenScreenInfo => {
    const live = d.hub?.state(s.key) ?? null;
    return {
      key: s.key,
      agent: s.agent,
      thread: s.thread,
      place: s.place,
      since: new Date(s.since).toISOString(),
      closesAt: s.idleAt === null ? null : new Date(s.idleAt).toISOString(),
      width: live?.width ?? 0,
      height: live?.height ?? 0,
      control: live?.control ?? false,
      recording: live?.recording ?? 'stopped',
      profile: s.profile,
      pending: d.asks.list(s.key),
    };
  };

  const where = (pick: (s: Session) => boolean) => [...sessions.values()].filter(pick);
  const closeAll = async (list: Session[], reason: ScreenEnd): Promise<number> => {
    await Promise.all(list.map((s) => close(s.key, reason)));
    return list.length;
  };

  return {
    acquire,
    list: (thread) => where((s) => s.state === 'open' && (thread === undefined || s.thread === thread)).map(infoOf),
    has: (key) => sessions.has(key),
    watched: (key) => {
      const s = sessions.get(key);
      return !!s && s.state === 'open' && s.hubOwned;
    },
    keysOfAgent: (agent) => where((s) => s.agent === agent).map((s) => s.key),
    stepsOf: (key) => sessions.get(key)?.log.entries() ?? [],
    markOf: (key) => sessions.get(key)?.mark ?? 0,
    instanceOf: (key) => sessions.get(key)?.instance ?? 0,
    mark(key, n) {
      const s = sessions.get(key);
      if (s) s.mark = n;
    },
    masksOf: (key) => sessions.get(key)?.masks ?? null,
    recordStep(key, step) {
      sessions.get(key)?.log.add(step);
    },
    touch,
    close,
    closeThread: (thread, reason = 'thread') => closeAll(where((s) => s.thread === thread), reason),
    closeAgent: (agent, reason = 'config') => closeAll(where((s) => s.agent === agent), reason),
    reconcile(config) {
      return closeAll(
        where((s) => {
          const a = config.agents.team.find((x) => x.id === s.agent);
          if (!a || a.screen !== true || a.shell !== s.shell || config.runner.sandbox.display !== true) return true;
          // The hosts, the logged-in profile and the workspace's network were fixed when the browser started: a screen left open would keep the old ones.
          const grants = d.grants(a);
          return s.setup !== setupOf(browserNetwork(config.runner.sandbox, a, grants.allowedHosts), grants.profile);
        }),
        'config',
      );
    },
    async endAll() {
      quitting = true;
      const all = [...sessions.values()];
      // A screen still starting gives its start up and is waited for, so no browser comes up after the app has said it is done.
      for (const s of all) if (s.state === 'opening') s.startAbort.abort();
      await closeAll(all, 'quit');
      await Promise.all(all.map((s) => s.ended));
    },
    onClosed(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
