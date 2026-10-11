import type { ForumMessage } from '../../shared/forum';
import { type Schedule, SCHEDULE_DOOR, SCHEDULE_FIRED, SCHEDULE_FIRED_LATE } from '../../shared/schedules';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import type { ScheduleStore } from './store';

// One firing of a schedule (#275): the app posts the schedule's prompt in its conversation as a line of its own, and the persona answers that line as it answers a person's
// message, by the `schedule` door, with no model session kept from before. What the persona may do is what it may do in any answer: the same tools, the same Actions, the same
// audit, which records the door. A turn that fails says so in the conversation and the schedule stays as it was.

export interface FireDeps {
  store: ScheduleStore;
  forum: Pick<ForumStore, 'append' | 'summary'>;
  /** Starts the persona's answer to the message and settles when it is over (answered or failed: the answer says its own failure in the conversation). */
  wake(message: ForumMessage, persona: string, door: string): Promise<void>;
  now(): Date;
  workdays(): readonly number[];
}

export type FireOutcome = 'fired' | 'busy' | 'skipped';

export interface Firer {
  fire(s: Schedule, o: { late: boolean }): Promise<FireOutcome>;
  /** Whether a firing of this schedule is still going. */
  running(id: string): boolean;
}

/** How much of the prompt the line in the conversation shows; the persona reads it whole. */
const SHOWN_MAX = 300;

export function createFirer(deps: FireDeps): Firer {
  const going = new Set<string>();

  async function fire(s: Schedule, o: { late: boolean }): Promise<FireOutcome> {
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
      deps.store.markRan(s.id, now, deps.workdays());
      const [message] = deps.forum.append(s.thread, {
        kind: 'system',
        author: { type: 'app' },
        code: o.late ? SCHEDULE_FIRED_LATE : SCHEDULE_FIRED,
        text: s.prompt,
        params: { schedule: s.id, prompt: s.prompt.length > SHOWN_MAX ? `${s.prompt.slice(0, SHOWN_MAX - 1)}…` : s.prompt },
      });
      try {
        await deps.wake(message, s.persona, SCHEDULE_DOOR);
      } catch (e) {
        // The answer could not even begin (the persona is gone, the conversation is not one it answers in): said where the answer would have been.
        const reason = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
        deps.forum.append(s.thread, { kind: 'system', author: { type: 'app' }, code: 'runner.mentionFailed', params: { agent: s.persona, reason } });
      }
      return 'fired';
    } finally {
      going.delete(s.id);
    }
  }

  return { fire, running: (id) => going.has(id) };
}
