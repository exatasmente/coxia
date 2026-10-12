import { join } from 'node:path';
import { personaOf } from '../../shared/config/team';
import { t } from '../../shared/i18n';
import { type Schedule, type ScheduleInput, type SchedulePatch, SCHEDULE_DOOR } from '../../shared/schedules';
import { getSettings } from '../config';
import { ATAS } from '../env';
import { forumStore } from '../forum';
import { wakePersona } from '../mentions/module';
import type { Module } from '../module';
import { openAct } from '../persona/act';
import { getConfig } from '../workspaceConfig';
import { type ScheduleWorld, ScheduleError } from './core';
import { createFirer } from './fire';
import { createScheduleService } from './service';
import { createScheduleStore } from './store';

// The schedules of the workspace (#275): the channels the screen and the persona's tools use, and the job on the app's own clock that fires them. The person and the persona
// manage the same list; a turn a schedule started cannot make another schedule, so a schedule never multiplies itself.

/** Who is changing a schedule: the persona inside its act, the person otherwise (the window or a paired browser). */
const who = (): string => (openAct() ? (personaOf(getConfig().agents.team)?.id ?? 'persona') : 'user');

const world = (): ScheduleWorld => ({ persona: personaOf(getConfig().agents.team)?.id ?? null, hasThread: (id) => forumStore().summary(id) !== null, now: new Date() });

const workdays = (): readonly number[] => getSettings().schedule.days;

/** A schedule's error in the words of the catalog; anything else as it came. */
function worded(e: unknown): Error {
  return e instanceof ScheduleError ? new Error(t(`main.schedules.error.${e.code}`)) : e instanceof Error ? e : new Error(String(e));
}

const guarded = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw worded(e);
  }
};

/** A turn a schedule woke may read and remove schedules, never make or change one. */
function refuseFromSchedule(): void {
  if (openAct()?.door === SCHEDULE_DOOR) throw new ScheduleError('fromSchedule');
}

export const schedulesModule: Module = (ctx) => {
  const store = createScheduleStore(join(ATAS, 'schedules.json'));
  const firer = createFirer({ store, forum: forumStore(), wake: wakePersona, now: () => new Date(), workdays });
  const service = createScheduleService({ store, firer, now: () => new Date() });
  const changed = (): void => ctx.emit({ type: 'module', name: 'schedules:changed', payload: service.view() });

  // Every minute, whatever the hours of work: a schedule says its own days.
  ctx.job({
    name: 'schedules',
    everyMin: 1,
    workHoursOnly: false,
    enabled: () => service.enabled(),
    run: async () => {
      // The firings run beside the clock: a long turn does not hold the next tick, and the list on screen follows the times they set.
      void service.tick().finally(changed);
    },
  });

  ctx.handle('schedules:list', () => service.view());
  ctx.handle('schedules:create', (input: ScheduleInput) =>
    guarded(() => {
      refuseFromSchedule();
      // The persona's schedule answers in the conversation it was asked in, unless it names another.
      const act = openAct();
      const made: Schedule = store.create({ ...input, thread: input?.thread || act?.thread || '' }, who(), world(), workdays());
      changed();
      return made;
    }),
  );
  ctx.handle('schedules:update', (id: string, patch: SchedulePatch) =>
    guarded(() => {
      refuseFromSchedule();
      const next = store.update(id, patch, who(), world(), workdays());
      changed();
      return next;
    }),
  );
  ctx.handle('schedules:remove', (id: string) =>
    guarded(() => {
      if (!store.remove(id)) throw new ScheduleError('notFound');
      changed();
      return true;
    }),
  );
  // The person's answer to the question at the start, or the switch of the screen; the persona has no operation for it.
  // Turning it on fires what was missed at once; the answer does not wait for those turns.
  ctx.handle('schedules:setEnabled', (on: boolean) => {
    void service.setEnabled(on === true).finally(changed);
    return service.view();
  });
};
