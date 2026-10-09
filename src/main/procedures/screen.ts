import type { StepEntry } from '../../shared/browser';
import type { ScreenSessions } from '../browser/sessions';
import type { HandoffService } from '../screen/handoff';
import type { TypedValues } from '../screen/typedValues';

// The one file of the procedure memory that knows the agent's screen (#177, #178). The session, the draft and the tools read a call's screen through `ProcedureScreen`, so a
// rename on the browser's side is a fix here and nowhere else. Types only are imported: nothing here starts a browser or reads a display.

/** What the offers need of the screens: the draft mark of an open screen, read and moved. */
export type ScreenMarks = Pick<ScreenSessions, 'markOf' | 'mark' | 'instanceOf'>;

/** What the procedure memory is given of a call's screen: where its steps are, whether the call has the app's browser, and the hand-off's two seams. */
export interface ScreenSource {
  /** The screen's key: `run:<id>` for a stage, `call:<thread>:<agent>` for an agent in a conversation. */
  key: string;
  /** Where the steps of an open screen are; absent: the call has no log (a build or a test with no screens). */
  sessions?: (Pick<ScreenSessions, 'stepsOf' | 'markOf' | 'mark'> & Partial<Pick<ScreenSessions, 'instanceOf'>>) | null;
  /** What the person typed in this call's hand-offs, in memory. Present when the call is offered the hand-off. */
  typed?: TypedValues;
  /** The hand-off service, for a hand-off that took place in an earlier call on the same screen. */
  handoff?: Pick<HandoffService, 'hadHandoff'> | null;
  /** The call holds the app's browser: a draft of what it did can be made. */
  browser: boolean;
  /** The person holds the screen right now (the call's hand-off tool says so): what they type is not in `typed` until the interval ends. */
  active?: () => boolean;
}

export interface ProcedureScreen {
  readonly key: string;
  /** The call has the app's browser, so it has a log to draft from. Without it no `gui` procedure can be saved. */
  readonly browser: boolean;
  /** The steps of the whole screen since its draft mark (0 when the screen opened), across the answers that took them, oldest first. */
  steps(): StepEntry[];
  /** Which opening of the key the screen is now (0 when it is not open): an offer of this screen moves a mark only while it is still this one. */
  instance(): number;
  /** The number of the screen's last step, 0 when it has none: what a draft is made up to. */
  lastStep(): number;
  /** Moves the screen's draft mark forward to a step number (never back): the steps up to it are not drafted again. */
  advance(n: number): void;
  /** The hosts the app's browser was on in this screen: the keys a `gui` procedure may have. A navigation the host list refused is not a visit. */
  visited(): string[];
  /** The person used the screen in this call, or in an earlier call on the same screen. */
  handedOff(): boolean;
  /** Whether a text holds something the person typed in this call's hand-offs, in any form the app masks. */
  typedIn(text: string): boolean;
  /** Keeps a copy of what was typed, so `typedIn` still answers after the call's own values are forgotten. In memory only; `release` forgets it. */
  freeze(): void;
  /** Forgets the copy. Idempotent. */
  release(): void;
}

/** A navigation the proxy or the address check turned away did not reach the site it names. */
const NAVIGATES = new Set(['browser_navigate', 'browser_tabs']);

export function procedureScreen(source: ScreenSource): ProcedureScreen {
  const { key, sessions, typed, handoff, active } = source;
  const entries = (): readonly StepEntry[] => {
    try {
      return sessions?.stepsOf(key) ?? [];
    } catch {
      return [];
    }
  };
  // The draft covers the screen from where its mark is, not from where this call began: an answer that follows another on a kept screen drafts both (#187).
  const markOf = (): number => {
    try {
      return sessions?.markOf(key) ?? 0;
    } catch {
      return 0;
    }
  };
  const steps = (): StepEntry[] => {
    const mark = markOf();
    return entries().filter((e) => e.n > mark);
  };
  let frozen: { hits(text: string): boolean; clear(): void } | null = null;
  return {
    key,
    browser: source.browser,
    steps,
    instance() {
      try {
        return sessions?.instanceOf?.(key) ?? 0;
      } catch {
        return 0;
      }
    },
    lastStep: () => entries().reduce((top, e) => Math.max(top, e.n), 0),
    advance(n) {
      try {
        const now = markOf();
        if (n > now) sessions?.mark(key, n);
      } catch {
        // a screen that is gone has no mark to move
      }
    },
    visited: () => [...new Set(entries().filter((e) => e.site && !(e.outcome === 'not-run' && NAVIGATES.has(e.tool))).map((e) => e.site.toLowerCase()))],
    handedOff: () => typed?.had === true || active?.() === true || (handoff?.hadHandoff(key) ?? false),
    typedIn: (text) => (frozen ? frozen.hits(text) : (typed?.hits(text) ?? false)),
    freeze() {
      frozen ??= typed?.snapshot() ?? null;
    },
    release() {
      frozen?.clear();
      frozen = null;
    },
  };
}
