// i18n-lint: allow-file the results a tool gives a model are fixed English sentences, like the other tool texts of the engines
import { randomUUID } from 'node:crypto';
import { keyOf, parseKey } from '../../shared/browser';
import { type HandoffAnswer, type HandoffPaths, type HandoffResult, HANDOFF_ASK_MS, HANDOFF_IDLE_MS, HANDOFF_TEXT_MAX } from '../../shared/handoff';
import { t } from '../../shared/i18n';
import { type AuditSink, type HandoffOutcome, type ScreenMode, type ScreenPlace, auditScreen } from '../browser/audit';
import type { ScreenAsks, ShownAsk } from '../browser/asks';
import type { MaskSet } from '../browser/mask';
import type { StepInput } from '../browser/stepLog';
import { redact } from '../errorlog-core';
import type { Notice } from '../scheduler';
import type { IntervalEnd, ScreenHub } from './hub';
import { type TypedValues, createTypedValues } from './typedValues';

// The hand-off of an agent's screen to the person (#178). One call object per stage attempt or conversation answer (`begin`) holds the typed values of its intervals and the
// gate the shell sessions read; the tool (`request`) asks, waits and gives the agent one of four fixed results; the person's three moves (take, give back, decline) and the
// ends nobody asked for (the limits, the call's abort, the screen going away) all end through one idempotent `finish`. The wait is a promise held here, not a question of the
// runner: a question ends the stage attempt and with it the display, and this wait must keep the page the agent stopped at.
//
// What it never does: hold, write or return what the person typed. The hub collects it for the interval and hands it over once, at the end; `finish` gives it to the call's
// `TypedValues` (memory, for the masker) before the gate opens and before the agent can read anything, and it is in no thread line, audit entry, step or result.

/** What a hand-off is told at its start. */
export interface BeginInput {
  /** The screen (`run:<id>` or `call:<thread>:<agent>`). */
  key: string;
  thread: string;
  place: ScreenPlace;
  /** The stage when the screen is a stage's; empty in a conversation. */
  stage: string;
  /** The issue of the run, for the audit. */
  issue?: number;
  /** The agent's id and the name the person knows it by. */
  agent: string;
  agentName: string;
  /** What the notice says it is about: the issue and its title, or the conversation. Fixed words of the app, never the agent's. */
  about: string;
  /**
   * What this agent has: the warning is worded from it, and the audit says where its commands run. It is read when a request is made, so a caller that begins before it
   * knows what the call got (the call object comes before the session and the screen) fills it in afterwards.
   */
  paths: HandoffPaths;
  /** Stops the clocks of the call; returns the way to start them again. */
  pause(): () => void;
  /** The call's abort: the hand-off ends with no result. */
  signal: AbortSignal;
}

export interface CallHandoff {
  /** What the person typed in this call's intervals, in memory; `mask` and `hits` are the masker, `had` says there was an interval. */
  readonly typed: TypedValues;
  /**
   * The tool. Resolves with the result the agent is given, or null when the call ended (aborted, cancelled, or the screen went away while the person had it) and nobody is
   * left to read one.
   */
  request(input: { what: string; why?: string }): Promise<HandoffResult | null>;
  /** The person holds the screen (or is about to be asked to give it back): the agent's commands and browser calls are refused. */
  active(): boolean;
  /** The call is over: an open hand-off ends with no result, the masks come off and the typed values are forgotten (`had` stays). Idempotent. */
  end(): void;
}

export interface HandoffService {
  begin(input: BeginInput): CallHandoff;
  /** The person takes the screen (after the warning). Withholds first, then turns control on. */
  take(key: string, id: string): Promise<HandoffAnswer>;
  /** The person gives the screen back. */
  give(key: string): HandoffAnswer;
  /** The person declines a request nobody has taken yet. */
  decline(id: string): HandoffAnswer;
  /** The screen of a key ended: a request still waiting for it is answered `unavailable`. */
  closed(key: string): void;
  /** Forgets that the screen had a hand-off (it ended). */
  forget(key: string): void;
  /** Whether a hand-off took place on this screen while it has lived; the values are gone after the call, this stays. */
  hadHandoff(key: string): boolean;
}

export interface HandoffDeps {
  hub: Pick<ScreenHub, 'state' | 'beginInterval' | 'endInterval' | 'control' | 'held'>;
  asks: Pick<ScreenAsks, 'show'>;
  /** A system line in the screen's thread: a catalog code and its parameters (`stage` is empty outside a stage). */
  say(thread: string, stage: string, code: string, params: Record<string, string>): void;
  audit?: AuditSink;
  /** The notice to the person's devices; only fixed text of the app is given to it. */
  notify?(notice: Notice): void;
  /** Whether the person wants notices. */
  notifications?(): boolean;
  /** The masks of the screen's page reads, when the screen has an app browser. */
  masks?(key: string): MaskSet | null;
  /** A step in the screen's log (the procedure memory). */
  step?(key: string, step: StepInput): void;
  schedule?: (ms: number, fn: () => void) => () => void;
  now?: () => number;
  newId?: () => string;
  askMs?: number;
  idleMs?: number;
}

interface Call {
  input: BeginInput;
  typed: TypedValues;
  ended: boolean;
  /** A decline or an expiry ended a hand-off in this call: the agent may not ask again. */
  closedForCall: boolean;
  current: Open | null;
  removeMask: (() => void) | null;
  unlisten: () => void;
}

interface Open {
  id: string;
  call: Call;
  key: string;
  what: string;
  why: string;
  phase: 'asked' | 'taken' | 'settled';
  /** The hub opened an interval for it (the person took the screen and it was withheld). */
  began: boolean;
  /** The end has begun and waits for the hub to put up the person's keys. */
  ending: boolean;
  /** What the end was asked to come to: a result, or null for none. Undefined: the hub ended it by itself. */
  pending: HandoffResult | null | undefined;
  startedAt: number;
  shown: ShownAsk;
  resume: () => void;
  cancelAsk: () => void;
  cancelIdle: () => void;
  settle: (result: HandoffResult | null) => void;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const clean = (text: unknown): string => (typeof text === 'string' ? redact(oneLine(text)).slice(0, HANDOFF_TEXT_MAX) : '');

/** What a result is said as to the agent: fixed sentences, nothing of the person's. */
export function resultText(result: HandoffResult): string {
  switch (result) {
    case 'done':
      return 'The person finished and gave the screen back.';
    case 'declined':
      return 'The person did not want to hand the screen over.';
    case 'expired':
      return 'The person did not respond in time.';
    case 'unavailable':
      return 'The screen is not available.';
  }
}

export function createHandoffService(deps: HandoffDeps): HandoffService {
  const now = deps.now ?? Date.now;
  const schedule =
    deps.schedule ??
    ((ms, fn) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return () => clearTimeout(timer);
    });
  const askMs = deps.askMs ?? HANDOFF_ASK_MS;
  const idleMs = deps.idleMs ?? HANDOFF_IDLE_MS;
  const open = new Map<string, Open>();
  const byKey = new Map<string, Open>();
  const had = new Set<string>();

  const safe = (fn: () => void, what: string): void => {
    try {
      fn();
    } catch (e) {
      console.error(`[handoff] ${what}`, e instanceof Error ? e.message : e);
    }
  };

  const say = (call: Call, code: string, params: Record<string, string> = {}): void =>
    safe(() => deps.say(call.input.thread, call.input.stage, code, { agent: call.input.agent, ...params }), 'could not write a line');

  /** The call is over and nothing of it is open: the masks come off and the values are forgotten. */
  const cleanup = (call: Call): void => {
    safe(() => call.removeMask?.(), 'could not take the mask off');
    call.removeMask = null;
    call.typed.clear();
  };

  const notice = (call: Call): void => {
    if (!deps.notify || deps.notifications?.() === false) return;
    const { key, place, thread, agentName, about } = call.input;
    const parsed = parseKey(key);
    // One object serves both ends: the desktop reads `thread`, the push reads `id`.
    const screen = place === 'stage' && parsed?.kind === 'run' ? { name: 'run', id: parsed.run } : { name: 'forum', id: thread, thread };
    safe(
      () =>
        deps.notify?.({
          title: t('main.handoff.notice.title', { agent: agentName }),
          body: about ? t('main.handoff.notice.bodyAbout', { about }) : t('main.handoff.notice.body'),
          onClick: { type: 'open', screen },
        } as Notice),
      'could not tell about a request',
    );
  };

  const outcomeOf = (result: HandoffResult | null): HandoffOutcome => result ?? 'aborted';

  /** Ends the hand-off, once. The typed values reach the call before the gate opens and before the agent is answered. */
  function finish(o: Open, result: HandoffResult | null, interval: IntervalEnd | null): void {
    if (o.phase === 'settled') return;
    const call = o.call;
    o.cancelAsk();
    o.cancelIdle();
    if (o.began) {
      // A page the agent reads from here on is masked, and a command's output too, before `active()` turns false.
      call.typed.add(interval?.typed ?? []);
      if (!call.removeMask) {
        const masks = deps.masks?.(o.key) ?? null;
        if (masks) call.removeMask = masks.add(call.typed.mask);
      }
      had.add(o.key);
    }
    o.phase = 'settled';
    open.delete(o.id);
    if (byKey.get(o.key) === o) byKey.delete(o.key);
    call.current = null;
    if (result === 'declined' || result === 'expired') call.closedForCall = true;
    o.shown.remove();
    safe(() => o.resume(), 'could not start the clocks again');
    if (result === 'done') say(call, 'runner.screen.handoffBack');
    else if (result === 'declined') say(call, 'runner.screen.handoffDeclined');
    else if (result === 'expired') say(call, 'runner.screen.handoffExpired');
    const outcome = outcomeOf(result);
    const { agent, place, issue, paths } = call.input;
    const via: ScreenMode = paths.shell;
    safe(
      () =>
        auditScreen.handedOver(
          {
            key: o.key,
            agent,
            place,
            ...(issue ? { issue } : {}),
            mode: via,
            what: o.what,
            outcome,
            from: interval ? new Date(interval.from).toISOString() : '',
            to: interval ? new Date(interval.to).toISOString() : '',
          },
          deps.audit,
        ),
      'could not audit',
    );
    // One step, with no name: what was asked stays in the thread and the audit, and nothing of the interval is a step.
    safe(
      () =>
        deps.step?.(o.key, {
          tool: 'screen_handoff',
          site: '',
          path: '',
          class: 'free',
          outcome: result === 'done' ? 'ok' : result === 'declined' || result === 'expired' ? 'declined' : 'not-run',
          ms: Math.max(0, now() - o.startedAt),
        }),
      'could not record the step',
    );
    if (call.ended) cleanup(call);
    o.settle(result);
  }

  /** Asks for the end, whatever the reason. Once the person holds the screen the hub ends the interval first and `finish` follows from its listener. */
  function ending(o: Open, result: HandoffResult | null, why: IntervalEnd['why']): void {
    if (o.phase === 'settled' || o.ending) return;
    if (o.phase === 'asked') {
      finish(o, result, null);
      return;
    }
    o.ending = true;
    o.pending = result;
    o.cancelIdle();
    // The interval is already gone (the screen ended and said so): nothing is left to wait for.
    if (!deps.hub.held(o.key)) {
      finish(o, result, null);
      return;
    }
    deps.hub.endInterval(o.key, why);
  }

  /** What the hub's own end of an interval means for the agent, when nobody asked for it. */
  const resultOfHub = (why: IntervalEnd['why']): HandoffResult | null => (why === 'back' ? 'done' : why === 'expired' ? 'expired' : why === 'lost' ? 'unavailable' : null);

  function onIntervalEnd(o: Open, r: IntervalEnd): void {
    finish(o, o.pending !== undefined ? o.pending : resultOfHub(r.why), r);
  }

  function request(call: Call, ask: { what: string; why?: string }): Promise<HandoffResult | null> {
    const { key, signal } = call.input;
    if (call.ended || signal.aborted) return Promise.resolve(null);
    const what = clean(ask.what);
    if (!what || call.closedForCall || call.current || byKey.has(key) || !deps.hub.state(key)) return Promise.resolve('unavailable');
    const why = clean(ask.why);
    const id = deps.newId?.() ?? randomUUID();
    return new Promise<HandoffResult | null>((resolve) => {
      const o: Open = {
        id,
        call,
        key,
        what,
        why,
        phase: 'asked',
        began: false,
        ending: false,
        pending: undefined,
        startedAt: now(),
        shown: { set: () => undefined, remove: () => undefined },
        resume: () => undefined,
        cancelAsk: () => undefined,
        cancelIdle: () => undefined,
        settle: resolve,
      };
      open.set(id, o);
      byKey.set(key, o);
      call.current = o;
      // The call's clocks stand still while the person is asked and while they hold the screen, and start with what was left when it ends.
      safe(() => (o.resume = call.input.pause()), 'could not stop the clocks');
      o.shown = deps.asks.show({ id, key, agent: call.input.agent, what, ...(why ? { why } : {}), paths: call.input.paths });
      say(call, 'runner.screen.handoffAsked', { what });
      notice(call);
      o.cancelAsk = schedule(askMs, () => ending(o, 'expired', 'expired'));
    });
  }

  return {
    begin(input) {
      const typed = createTypedValues();
      const onAbort = (): void => {
        const o = call.current;
        if (o) ending(o, null, 'aborted');
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
      const call: Call = {
        input,
        typed,
        ended: false,
        closedForCall: false,
        current: null,
        removeMask: null,
        unlisten: () => input.signal.removeEventListener('abort', onAbort),
      };
      return {
        typed,
        request: (ask) => request(call, ask),
        active: () => call.current?.phase === 'taken',
        end() {
          if (call.ended) return;
          call.ended = true;
          call.unlisten();
          const o = call.current;
          if (o) ending(o, null, 'ended');
          // An interval that is being closed still has the hub put up the person's keys: its end cleans up the call.
          if (!call.current) cleanup(call);
        },
      };
    },

    async take(key, id) {
      const o = open.get(id);
      if (!o || o.key !== keyOf(key)) return { ok: false, reason: 'gone' };
      if (o.phase !== 'asked') return { ok: false, reason: o.phase === 'taken' ? 'taken' : 'gone' };
      // Everything up to the first await is one step: the screen is withheld before control is turned on, so a phone that polls twice a second never reads a frame typed into.
      o.cancelAsk();
      o.phase = 'taken';
      const began = deps.hub.beginInterval(o.key, {
        input: () => {
          if (o.phase === 'taken' && !o.ending) {
            o.cancelIdle();
            o.cancelIdle = schedule(idleMs, () => ending(o, 'expired', 'expired'));
          }
        },
        end: (r) => onIntervalEnd(o, r),
      });
      if (!began) {
        finish(o, 'unavailable', null);
        return { ok: false, reason: 'none' };
      }
      o.began = true;
      o.cancelIdle = schedule(idleMs, () => ending(o, 'expired', 'expired'));
      const control = await deps.hub.control(o.key, true);
      if (o.phase !== 'taken') return { ok: false, reason: 'gone' };
      if (!control.ok) {
        ending(o, 'unavailable', 'lost');
        return { ok: false, reason: 'none' };
      }
      if (!o.ending) {
        say(o.call, 'runner.screen.handoffTaken');
        o.shown.set({ taken: true });
      }
      return { ok: true };
    },

    give(key) {
      const o = byKey.get(keyOf(key) ?? '');
      if (!o || o.phase !== 'taken') return { ok: false, reason: 'gone' };
      ending(o, 'done', 'back');
      return { ok: true };
    },

    decline(id) {
      const o = open.get(id);
      if (!o) return { ok: false, reason: 'gone' };
      // Once the person has the screen the way out is giving it back.
      if (o.phase !== 'asked') return { ok: false, reason: 'taken' };
      ending(o, 'declined', 'back');
      return { ok: true };
    },

    closed(key) {
      const o = byKey.get(key);
      if (o && o.phase === 'asked') ending(o, 'unavailable', 'lost');
    },

    forget: (key) => void had.delete(key),
    hadHandoff: (key) => had.has(key),
  };
}
