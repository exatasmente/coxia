import { randomUUID } from 'node:crypto';
import { ASK_DECISIONS, ASK_TIMEOUT_MS, type AskDecision, type ConfirmKind, type HeldAnswer, type HoldWhy, type PendingAsk, type StepWords } from '../../shared/browser';
import type { HandoffCard } from '../../shared/handoff';
import { t } from '../../shared/i18n';
import { describeStep } from '../../shared/stepWords';
import { type AnsweredThrough, type AuditSink, type ScreenPlace, auditScreen } from './audit';
import type { HoldGate } from './intermediary';

// The questions the app's screen asks the person: a step it holds before it reaches the browser, and a confirmation the agent asked for. It has the shape of the command store
// the ceremonies use: `ask` returns a promise and waits, an unanswered question counts as declined after 15 minutes (fail closed), the pending ones are listed and published
// whenever they change, and every answer is audited, with who gave it. The person can give a pass ("yes for the rest of this screen on this site") only for a step the app could
// not read; a step it called irreversible asks every time. Nothing here knows the window: the channels and the card are the ones that call `answer`.

/** Where a question comes from: the screen, the agent, and the clocks to stop while the question waits. */
export interface AskContext {
  /** The screen (`run:<id>` or `call:<thread>:<agent>`). */
  key: string;
  agent: string;
  place: ScreenPlace;
  /** The issue of the run the screen belongs to; absent in a conversation outside a run. */
  issue?: number;
  /** Stops the clocks of the call and of the screen's idleness; returns the way to start them again. */
  pause?: () => () => void;
}

export interface HoldAsk extends AskContext {
  why: HoldWhy;
  step: StepWords;
  site: string;
  agentWords?: string;
}

export interface ConfirmAsk extends AskContext {
  confirmKind: ConfirmKind;
  /** The step in a sentence, as the agent wrote it. */
  words: string;
  site?: string;
}

/** What a question came to. `note` is what the person wrote when they said no (cut to what fits in a tool result). */
export interface AskResult {
  answer: HeldAnswer;
  note?: string;
}

/** A request to hand the screen over, as the list shows it (#178). The service that owns it decides when it ends; the list only holds the entry. */
export interface ShownHandoff {
  id: string;
  key: string;
  agent: string;
  /** What the agent needs of the person, as it wrote it. */
  what: string;
  why?: string;
  paths: HandoffCard['paths'];
  since?: string;
}

/** The entry of a request in the list: it can change (the screen was taken) and goes away. */
export interface ShownAsk {
  set(patch: Partial<Pick<HandoffCard, 'taken'>>): void;
  /** Takes the entry out of the list. Idempotent. */
  remove(): void;
}

export interface ScreenAsksDeps {
  /** Told with every pending question of every screen whenever the list changes (the event the card and the viewer read). */
  changed(asks: PendingAsk[]): void;
  /** Told when a question starts waiting: the notification that opens the conversation. */
  asked?(ask: PendingAsk): void;
  /** The audit log's writer; replaced in tests. */
  audit?: AuditSink;
  timeoutMs?: number;
  newId?: () => string;
  now?: () => Date;
}

export class AskGone extends Error {
  constructor() {
    super('ask-gone');
    this.name = 'AskGone';
  }
}

export interface ScreenAsks {
  /** Holds a step for the person. Aborting the signal counts as `closed`. */
  hold(ask: HoldAsk, signal?: AbortSignal): Promise<AskResult>;
  /** A confirmation the agent asked for. */
  confirm(ask: ConfirmAsk, signal?: AbortSignal): Promise<AskResult>;
  /** The pending questions, of one screen or of all. */
  list(key?: string): PendingAsk[];
  /**
   * The person's answer. `through` says where it was given: the window, or a paired browser. A pass (`site`) is valid only for a held step the app could not read; for
   * anything else it counts as a plain yes. Throws `AskGone` for a question that no longer waits.
   */
  answer(id: string, decision: AskDecision, through: Exclude<AnsweredThrough, 'none'>, note?: string): PendingAsk;
  /**
   * Lists a request to hand the screen over. Only the list and the event: the wait, the limits and the answer are the hand-off service's (an `answer` to this id is gone),
   * since its limit must tell an expiry from a decline and its end must tell the agent which.
   */
  show(ask: ShownHandoff): ShownAsk;
  /** Declines every pending question of a screen (it is closing), without waiting. Returns how many. */
  declineAll(key: string): number;
  /** Whether the person gave a pass for unclassifiable steps on this site, for this screen. */
  passed(key: string, site: string): boolean;
  /** Forgets the passes of a screen (it closed). */
  forget(key: string): void;
  /** The door the intermediary asks through, for one screen. */
  gate(context: AskContext): HoldGate;
}

/** Questions a screen may have waiting at once: a flood of them is declined, not queued. */
export const MAX_PENDING_PER_SCREEN = 8;
const NOTE_MAX = 500;

export { describeStep };

/** The notification for a question: who is waiting, and what for. */
export function askNotice(ask: PendingAsk): { title: string; body: string } {
  const title = t('main.browser.ask.title', { agent: ask.agent });
  if (ask.kind === 'confirm') return { title, body: t('main.browser.ask.confirm', { kind: t(`main.browser.confirmKind.${ask.confirmKind ?? 'other'}`), words: (ask.agentWords ?? '').slice(0, 200) }) };
  return { title, body: t('main.browser.ask.hold', { step: ask.step ? describeStep(ask.step, ask.site) : '', why: t(`main.browser.why.${ask.why}`) }) };
}

interface Waiting {
  item: PendingAsk;
  context: AskContext;
  site: string;
  finish(result: AskResult, through: AnsweredThrough): void;
}

export function createScreenAsks(d: ScreenAsksDeps): ScreenAsks {
  const waiting = new Map<string, Waiting>();
  /** Requests to hand the screen over, listed beside the questions and never answered through `answer`. */
  const shown = new Map<string, PendingAsk>();
  const passes = new Map<string, Set<string>>();
  const sink: AuditSink | undefined = d.audit;
  const publish = (): void => {
    try {
      d.changed([...[...waiting.values()].map((w) => w.item), ...shown.values()]);
    } catch {
      // A failing listener must not decide an answer.
    }
  };

  function start(context: AskContext, item: Omit<PendingAsk, 'id' | 'key' | 'agent' | 'since'>, signal: AbortSignal | undefined, audit: (answer: HeldAnswer, through: AnsweredThrough) => void): Promise<AskResult> {
    if (signal?.aborted) return Promise.resolve({ answer: 'closed' });
    const open = [...waiting.values()].filter((w) => w.context.key === context.key).length;
    if (open >= MAX_PENDING_PER_SCREEN) return Promise.resolve({ answer: 'no' });
    return new Promise((resolve) => {
      const pending: PendingAsk = { id: d.newId?.() ?? randomUUID(), key: context.key, agent: context.agent, since: (d.now?.() ?? new Date()).toISOString(), ...item };
      let timer: NodeJS.Timeout | undefined;
      let resume: (() => void) | undefined;
      const finish = (result: AskResult, through: AnsweredThrough): void => {
        if (!waiting.delete(pending.id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stopped);
        try {
          resume?.();
        } catch {
          // The clocks are the caller's.
        }
        publish();
        try {
          audit(result.answer, through);
        } catch (e) {
          console.error('[browser] could not audit an answer', e instanceof Error ? e.message : e);
        }
        resolve(result);
      };
      const stopped = (): void => finish({ answer: 'closed' }, 'none');
      timer = setTimeout(() => finish({ answer: 'timeout' }, 'none'), d.timeoutMs ?? ASK_TIMEOUT_MS);
      timer.unref?.();
      signal?.addEventListener('abort', stopped, { once: true });
      // The agent's clocks and the screen's idleness stand still while the person thinks.
      try {
        resume = context.pause?.();
      } catch {
        resume = undefined;
      }
      waiting.set(pending.id, { item: pending, context, site: pending.site, finish });
      publish();
      try {
        d.asked?.(pending);
      } catch (e) {
        console.error('[browser] could not tell about a question', e instanceof Error ? e.message : e);
      }
    });
  }

  const who = (c: AskContext) => ({ key: c.key, agent: c.agent, place: c.place, ...(c.issue !== undefined ? { issue: c.issue } : {}) });

  const self: ScreenAsks = {
    hold(ask, signal) {
      const text = describeStep(ask.step, ask.site);
      return start(ask, { kind: 'hold', why: ask.why, step: ask.step, site: ask.site, ...(ask.agentWords ? { agentWords: ask.agentWords } : {}) }, signal, (answer, through) =>
        auditScreen.held({ ...who(ask), why: ask.why, step: text, site: ask.site, ...(ask.agentWords ? { agentWords: ask.agentWords } : {}), answer, through }, sink),
      );
    },
    confirm(ask, signal) {
      return start(ask, { kind: 'confirm', why: 'agent', step: null, site: ask.site ?? '', agentWords: ask.words, confirmKind: ask.confirmKind }, signal, (answer, through) =>
        auditScreen.confirmed({ ...who(ask), kind: ask.confirmKind, words: ask.words, ...(ask.site ? { site: ask.site } : {}), answer, through }, sink),
      );
    },
    list: (key) => [...[...waiting.values()].map((w) => w.item), ...shown.values()].filter((a) => key === undefined || a.key === key),
    show(ask) {
      const item: PendingAsk = {
        id: ask.id,
        key: ask.key,
        agent: ask.agent,
        kind: 'handoff',
        why: 'agent',
        step: null,
        site: '',
        agentWords: ask.what,
        since: ask.since ?? (d.now?.() ?? new Date()).toISOString(),
        handoff: { ...(ask.why ? { why: ask.why } : {}), taken: false, paths: ask.paths },
      };
      shown.set(item.id, item);
      publish();
      return {
        set(patch) {
          const current = shown.get(item.id);
          if (!current?.handoff) return;
          shown.set(item.id, { ...current, handoff: { ...current.handoff, ...patch } });
          publish();
        },
        remove() {
          if (shown.delete(item.id)) publish();
        },
      };
    },
    answer(id, decision, through, note = '') {
      const w = waiting.get(id);
      if (!w) throw new AskGone();
      if (!ASK_DECISIONS.includes(decision)) throw new Error(`unknown decision: ${String(decision).slice(0, 20)}`);
      // A pass is for a step the app could not read: for anything else the person said yes to this step, and to nothing more.
      const pass = decision === 'site' && w.item.kind === 'hold' && w.item.why === 'unclassified' && w.site !== '';
      const chosen: AskDecision = decision === 'site' && !pass ? 'yes' : decision;
      if (pass) {
        const sites = passes.get(w.item.key) ?? new Set<string>();
        sites.add(w.site);
        passes.set(w.item.key, sites);
      }
      const said = note.trim().slice(0, NOTE_MAX);
      w.finish(chosen === 'no' ? { answer: 'no', ...(said ? { note: said } : {}) } : { answer: chosen }, through);
      return w.item;
    },
    declineAll(key) {
      let n = 0;
      for (const w of [...waiting.values()]) {
        if (w.item.key !== key) continue;
        w.finish({ answer: 'closed' }, 'none');
        n++;
      }
      return n;
    },
    passed: (key, site) => site !== '' && (passes.get(key)?.has(site) ?? false),
    forget: (key) => void passes.delete(key),
    gate(context) {
      return {
        hold: async (request, signal) => (await self.hold({ ...context, ...request }, signal)).answer,
        passed: (site) => self.passed(context.key, site),
      };
    },
  };
  return self;
}
