import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditKind } from '../../shared/auditoria';

// The scope of one act of the persona: what the call origin and the audit writer consult to know that a call is the persona's. A leaf module (only `node:async_hooks`) so the
// call wrapper and the audit can both import it with no cycle. The scope closes when the handler's promise settles: work the handler leaves running (a run it started, a timer)
// keeps the async store but is not the persona's, so everything asks `open`, never the store alone.

export interface Act {
  /** True from the first line of the handler to the moment its promise settles. */
  open: boolean;
  /** One per door call that writes: `a-<time36>-<n>`, shared by every audit line the act writes. */
  id: string;
  /** How the message the answer began from came in: `window` or `paired`; open to more values (a later schedule). */
  door: string;
  /** The model's stated reason, masked and cut. */
  said: string;
  /** The answer's exact-value mask (a secret the persona read), applied to everything the act writes. */
  mask: (text: string) => string;
  /** What the handler wrote, to decide whether the door writes a line of its own. */
  wrote: { count: number; kinds: Set<AuditKind> };
}

const scope = new AsyncLocalStorage<Act>();
let sequence = 0;

/** A fresh act id. */
export function newActId(now: number = Date.now()): string {
  sequence += 1;
  return `a-${now.toString(36)}-${sequence}`;
}

export const runAct = <T>(act: Act, fn: () => T): T => scope.run(act, fn);

/** The act this code runs inside, or null. A closed act is still returned: the caller decides what `open` means for it. */
export const currentAct = (): Act | null => scope.getStore() ?? null;

/** The act, only while it is open: the persona's call is in progress. */
export const openAct = (): Act | null => {
  const act = scope.getStore();
  return act && act.open ? act : null;
};
