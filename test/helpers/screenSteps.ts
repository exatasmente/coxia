import type { StepEntry } from '../../src/shared/browser';
import { type StepLog, createStepLog } from '../../src/main/browser/stepLog';

// A step log filled by verbs, for the tests of what the procedure memory reads of a screen. It is the app's own log (`createStepLog`), so an entry has exactly the fields the app
// keeps and no other: a test cannot hand the draft a field the real log would never hold. A clock that moves 1 s a step keeps `at` in order.

export interface FakeSteps {
  log: StepLog;
  /** The sessions' view of the log, by key: only the key it was made for has steps. */
  sessions: { stepsOf(key: string): readonly StepEntry[] };
  navigate(url: string, over?: Partial<Pick<StepEntry, 'outcome' | 'ms'>>): StepEntry;
  back(): StepEntry;
  click(role: string, name: string, over?: Partial<Pick<StepEntry, 'outcome' | 'ms' | 'site' | 'path' | 'class' | 'held'>>): StepEntry;
  type(over?: Partial<Pick<StepEntry, 'outcome' | 'site' | 'path'>>): StepEntry;
  press(key: string | undefined): StepEntry;
  wait(ms: number): StepEntry;
  read(tool?: string): StepEntry;
  handoff(outcome?: StepEntry['outcome']): StepEntry;
  /** A step of any tool, as the app logs it, for a case the verbs do not cover. */
  add(tool: string, over?: Partial<StepEntry>): StepEntry;
}

export function fakeSteps(key = 'call:t-1:agent', start = 'https://docs.example.com/'): FakeSteps {
  let clock = Date.parse('2026-10-09T10:00:00Z');
  const log = createStepLog(undefined, () => (clock += 1000));
  let page = new URL(start);
  const add = (tool: string, over: Partial<StepEntry> = {}): StepEntry =>
    log.add({ tool, site: over.site ?? page.hostname, path: over.path ?? (page.pathname === '/' ? '' : page.pathname), class: 'free', outcome: 'ok', ms: 10, ...over });
  return {
    log,
    sessions: { stepsOf: (k) => (k === key ? log.entries() : []) },
    navigate(url, over = {}) {
      const target = new URL(url, page);
      const refused = over.outcome === 'not-run';
      if (!refused) page = target;
      return add('browser_navigate', { site: target.hostname, path: target.pathname === '/' ? '' : target.pathname, ...over });
    },
    back: () => add('browser_navigate_back'),
    click: (role, name, over = {}) => add('browser_click', { role, name, ...over }),
    type: (over = {}) => add('browser_type', over),
    press: (k) => add('browser_press_key', k ? { key: k } : {}),
    wait: (ms) => add('browser_wait_for', { ms }),
    read: (tool = 'browser_snapshot') => add(tool),
    handoff: (outcome = 'ok') => log.add({ tool: 'screen_handoff', site: '', path: '', class: 'free', outcome, ms: 5000 }),
    add,
  };
}
