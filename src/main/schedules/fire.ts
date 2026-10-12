import type { ForumMessage } from '../../shared/forum';
import {
  type Schedule,
  SCHEDULE_DONE,
  SCHEDULE_DOOR,
  SCHEDULE_FAILED,
  SCHEDULE_FIRED,
  SCHEDULE_FIRED_LATE,
  SCHEDULE_SKIPPED,
  SCHEDULE_STILL_WAITING,
  SCHEDULE_WAITING,
} from '../../shared/schedules';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import type { ScheduleStore } from './store';

// One firing of a schedule (#275, #250). A persona or agent action posts the schedule's prompt in its conversation as a line of its own, and the persona (or the agent) answers
// that line as it answers a person's message, by the `schedule` door. A direct action (a run, a ceremony) calls no model to decide: the app takes it through the persona's door,
// with the same policy and audit, and says in the conversation what came of it. A failure is said there and the schedule stays as it was, for its next time. A missed firing
// runs once, marked late, or is skipped with a line saying so, as the schedule's rule says.

/** What a direct action came to: done, with a short word of what it did, or waiting for the person's approval of a proposal in Actions. A failure throws. */
export type DirectResult = { state: 'done'; detail: string } | { state: 'awaiting'; actionId: string };

/** Takes a schedule's direct action (`run`, `ceremony`) for the firing whose line is `message`. */
export interface DirectRunner {
  run(s: Schedule, message: ForumMessage): Promise<DirectResult>;
}

/** The node of a firing in the activity tree. */
export interface FiringActivity {
  status(state: 'started' | 'finished' | 'failed' | 'skipped', detail?: string): void;
  awaitingApproval(): void;
}

export interface FireDeps {
  store: ScheduleStore;
  forum: Pick<ForumStore, 'append' | 'summary'>;
  /** Starts the answer of an agent (the persona, or an agent of the team) to the message and settles when it is over (answered or failed: the answer says its own failure). */
  wake(message: ForumMessage, agent: string, door: string): Promise<void>;
  /** The direct actions; without one, a run or ceremony schedule fails and says so. */
  direct?: DirectRunner;
  /** Opens the node of a firing that is not an agent's call (a direct action, a skipped firing). Without one, nothing is drawn. */
  activity?(s: Schedule, label: string): FiringActivity;
  /** The words of a schedule's action, for its line and its node. */
  describe?(s: Schedule): string;
  now(): Date;
  workdays(): readonly number[];
}

/** `passed`: skipped by the missed-firing rule; `waiting`: an earlier firing's action still waits for approval, and nothing new was opened. */
export type FireOutcome = 'fired' | 'busy' | 'skipped' | 'passed' | 'waiting';

export interface Firer {
  /** `missed`: its time passed while the app was closed or the scheduler off; only such a firing is skipped by a schedule set to skip. */
  fire(s: Schedule, o: { late: boolean; missed?: boolean }): Promise<FireOutcome>;
  /** Whether a firing of this schedule is still going. */
  running(id: string): boolean;
  /** The proposal a schedule's action waited for was carried out, refused or set aside: the wait ends and the conversation says how. False when no schedule waited for it. */
  settle(actionId: string, outcome: { ok: true } | { ok: false; reason: string }): boolean;
}

/** How much of the prompt the line in the conversation shows; the persona reads it whole. */
const SHOWN_MAX = 300;
const REASON_MAX = 300;

const shown = (text: string): string => (text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX - 1)}…` : text);
const reasonOf = (e: unknown): string => redact(e instanceof Error ? e.message : String(e)).slice(0, REASON_MAX);
const pad = (n: number): string => String(n).padStart(2, '0');
/** A time as the line says it, in the computer's time and in no language: `2026-03-02 10:05`. */
export const localStamp = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function createFirer(deps: FireDeps): Firer {
  const going = new Set<string>();
  // The nodes of the actions that wait for approval in this session of the app, closed when the wait ends.
  const waits = new Map<string, FiringActivity>();
  const describe = (s: Schedule): string => deps.describe?.(s) ?? s.prompt;
  const nodeOf = (s: Schedule): FiringActivity | null => deps.activity?.(s, describe(s)) ?? null;
  const say = (s: Schedule, code: string, params: Record<string, string>): ForumMessage =>
    deps.forum.append(s.thread, { kind: 'system', author: { type: 'app' }, code, params: { schedule: s.id, ...params } })[0];

  async function fire(s: Schedule, o: { late: boolean; missed?: boolean }): Promise<FireOutcome> {
    // One firing at a time per schedule: a turn longer than the interval is not started twice.
    if (going.has(s.id)) return 'busy';
    going.add(s.id);
    try {
      const now = deps.now();
      // The next time is set before the turn begins, so the next tick does not find it due again, and firings missed while the app was closed become this one.
      if (!deps.forum.summary(s.thread)) {
        deps.store.markRan(s.id, now, deps.workdays(), 'thread');
        return 'skipped';
      }
      if (o.missed && s.missed === 'skip') {
        // Skipped, not lost without a word: the conversation says which time was missed, and the next one counts from now.
        deps.store.markSkipped(s.id, now, deps.workdays());
        say(s, SCHEDULE_SKIPPED, { at: localStamp(s.nextRun ?? now.toISOString()), action: describe(s) });
        nodeOf(s)?.status('skipped');
        return 'passed';
      }
      if (s.waiting) {
        // The action of an earlier firing still waits for the person: a second one like it is not opened, and the time moves on.
        deps.store.markRan(s.id, now, deps.workdays(), s.lastError);
        say(s, SCHEDULE_STILL_WAITING, { action: describe(s), since: localStamp(s.waiting.since) });
        return 'waiting';
      }
      deps.store.markRan(s.id, now, deps.workdays());
      const code = o.late ? SCHEDULE_FIRED_LATE : SCHEDULE_FIRED;
      const a = s.action;
      if (a.kind === 'persona' || a.kind === 'agent') {
        const target = a.kind === 'agent' ? a.agent : s.persona;
        const [message] = deps.forum.append(s.thread, { kind: 'system', author: { type: 'app' }, code, text: a.prompt, params: { schedule: s.id, prompt: shown(a.prompt) } });
        try {
          await deps.wake(message, target, SCHEDULE_DOOR);
        } catch (e) {
          // The answer could not even begin (the agent is gone, the conversation is not one it answers in): said where the answer would have been.
          deps.forum.append(s.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mentionFailed', params: { agent: target, reason: reasonOf(e) } });
        }
        return 'fired';
      }
      await direct(s, say(s, code, { prompt: shown(describe(s)) }), now);
      return 'fired';
    } finally {
      going.delete(s.id);
    }
  }

  async function direct(s: Schedule, message: ForumMessage, now: Date): Promise<void> {
    const node = nodeOf(s);
    node?.status('started');
    try {
      // i18n-ignore: developer error: the module always gives the direct runner
      if (!deps.direct) throw new Error('no direct runner');
      const result = await deps.direct.run(s, message);
      if (result.state === 'awaiting') {
        deps.store.setWaiting(s.id, { actionId: result.actionId, since: now.toISOString() });
        say(s, SCHEDULE_WAITING, { action: describe(s) });
        node?.awaitingApproval();
        if (node) waits.set(result.actionId, node);
        return;
      }
      deps.store.setError(s.id, null);
      say(s, SCHEDULE_DONE, { action: describe(s), detail: shown(result.detail) });
      node?.status('finished');
    } catch (e) {
      const reason = reasonOf(e);
      // A failure does not pause or remove the schedule: it is said, kept as the last error, and the next time comes as set.
      deps.store.setError(s.id, reason);
      say(s, SCHEDULE_FAILED, { action: describe(s), reason });
      node?.status('failed', reason);
    }
  }

  function settle(actionId: string, outcome: { ok: true } | { ok: false; reason: string }): boolean {
    const s = deps.store.list().find((x) => x.waiting?.actionId === actionId);
    if (!s) return false;
    deps.store.setWaiting(s.id, null);
    // The node opened by this session of the app, or a new one for a wait that began before the app last opened.
    const node = waits.get(actionId) ?? nodeOf(s);
    waits.delete(actionId);
    if (outcome.ok) {
      deps.store.setError(s.id, null);
      say(s, SCHEDULE_DONE, { action: describe(s), detail: '' });
      node?.status('finished');
    } else {
      const reason = redact(outcome.reason).slice(0, REASON_MAX);
      deps.store.setError(s.id, reason);
      say(s, SCHEDULE_FAILED, { action: describe(s), reason });
      node?.status('failed', reason);
    }
    return true;
  }

  return { fire, running: (id) => going.has(id), settle };
}
