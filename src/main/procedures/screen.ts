import type { StepEntry } from '../../shared/browser';
import type { ScreenSessions } from '../browser/sessions';
import type { HandoffService } from '../screen/handoff';
import type { TypedValues } from '../screen/typedValues';

// The one file of the procedure memory that knows the agent's screen (#177, #178). The session, the draft and the tools read a call's screen through `ProcedureScreen`, so a
// rename on the browser's side is a fix here and nowhere else. Types only are imported: nothing here starts a browser or reads a display.

/** What the procedure memory is given of a call's screen: where its steps are, whether the call has the app's browser, and the hand-off's two seams. */
export interface ScreenSource {
  /** The screen's key: `run:<id>` for a stage, `call:<thread>:<agent>` for an agent in a conversation. */
  key: string;
  /** Where the steps of an open screen are; absent: the call has no log (a build or a test with no screens). */
  sessions?: Pick<ScreenSessions, 'stepsOf'> | null;
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
  /** The steps the app's browser took in this call (a screen kept between messages holds the earlier ones too, which are not this call's), oldest first. */
  steps(): StepEntry[];
  /** The hosts the app's browser was on in this call: the keys a `gui` procedure may have. A navigation the host list refused is not a visit. */
  visited(): string[];
  /** The person used the screen in this call, or in an earlier call on the same screen. */
  handedOff(): boolean;
  /** Whether a text holds something the person typed in this call's hand-offs, in any form the app masks. */
  typedIn(text: string): boolean;
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
  // The log of a screen kept between messages starts before this call: its steps belong to the answers that took them.
  const mark = entries().reduce((top, e) => Math.max(top, e.n), 0);
  const steps = (): StepEntry[] => entries().filter((e) => e.n > mark);
  return {
    key,
    browser: source.browser,
    steps,
    visited: () => [...new Set(steps().filter((e) => e.site && !(e.outcome === 'not-run' && NAVIGATES.has(e.tool))).map((e) => e.site.toLowerCase()))],
    handedOff: () => typed?.had === true || active?.() === true || (handoff?.hadHandoff(key) ?? false),
    typedIn: (text) => typed?.hits(text) ?? false,
  };
}
