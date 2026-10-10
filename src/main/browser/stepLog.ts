import { STEP_LOG_MAX, type StepEntry } from '../../shared/browser';
import { redact } from '../errorlog-core';
import { siteOf } from './audit';
import { stepKey } from './classify';

// The log of a screen session's steps, kept for the procedure memory (#179). It is built from a fixed set of fields and cleans every one of them on the way in, so what it
// must never hold (a typed value, a query string, a cookie, page text beyond a control's name) has no way in even if a caller forgets: the site is a host, the path loses its
// query and fragment, the name is cut, a key is kept only when it is a named key that types nothing or a shortcut.

const NAME_MAX = 80;
const REASON_MAX = 200;
const PATH_MAX = 200;
const TOOL_MAX = 60;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

/** The path of an address with no query, no fragment, no credentials and no port: `/a/b`. '' when there is none. */
export function pathOf(address: string): string {
  try {
    const url = new URL(address);
    return clip(redact(url.pathname === '/' ? '' : url.pathname), PATH_MAX);
  } catch {
    return '';
  }
}

export type StepInput = Omit<StepEntry, 'n' | 'at'> & { at?: string };

export interface StepLog {
  /** Records one step; returns the entry as kept. */
  add(entry: StepInput): StepEntry;
  entries(): readonly StepEntry[];
  /** How many steps went by the bound and were dropped, oldest first. */
  readonly dropped: number;
  /** Steps by tool name, for every call (the ones dropped from the log too). */
  counts(): Record<string, number>;
}

export function createStepLog(max = STEP_LOG_MAX, now: () => number = Date.now): StepLog {
  const entries: StepEntry[] = [];
  const counts = new Map<string, number>();
  let n = 0;
  let dropped = 0;
  return {
    add(input) {
      n++;
      const tool = clip(input.tool, TOOL_MAX);
      counts.set(tool, (counts.get(tool) ?? 0) + 1);
      const key = input.key ? stepKey(input.key) : null;
      const name = input.name ? clip(oneLine(input.name), NAME_MAX) : '';
      const reason = input.reason ? clip(redact(oneLine(input.reason)), REASON_MAX) : '';
      const entry: StepEntry = {
        n,
        at: input.at ?? new Date(now()).toISOString(),
        tool,
        ...(input.role ? { role: clip(input.role, 40) } : {}),
        ...(name ? { name } : {}),
        ...(key ? { key } : {}),
        ...(reason ? { reason } : {}),
        // Only a host: whatever the caller passed, an address is cut down to its site.
        site: siteOf(input.site),
        path: pathOf(`https://x${input.path.startsWith('/') ? '' : '/'}${input.path.split(/[?#]/)[0]}`),
        class: input.class,
        ...(input.held ? { held: { why: input.held.why, answer: input.held.answer } } : {}),
        ...(input.passed ? { passed: true as const } : {}),
        outcome: input.outcome,
        ms: Math.max(0, Math.round(input.ms)),
      };
      entries.push(entry);
      if (entries.length > max) {
        entries.shift();
        dropped++;
      }
      return entry;
    },
    entries: () => entries,
    get dropped() {
      return dropped;
    },
    counts: () => Object.fromEntries(counts),
  };
}
