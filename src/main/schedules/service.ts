import { type SchedulesView, activeSchedules } from '../../shared/schedules';
import { isDue, isLate } from './core';
import type { Firer } from './fire';
import type { ScheduleStore } from './store';

// The scheduler of the running app (#275): off until the person says yes when the app opens (or turns it on in the screen), and for this session of the app only. Each tick
// fires the schedules that are due; turning it on fires at once the ones whose time passed while it was off, each once and marked late.

export interface ScheduleService {
  enabled(): boolean;
  /** Whether the person was asked (or answered from the screen) in this session of the app. */
  asked(): boolean;
  setEnabled(on: boolean): Promise<void>;
  /** An active schedule exists: the question at the start is worth asking. */
  hasActive(): boolean;
  /** Fires what is due; settles when those firings are over. Nothing when the scheduler is off. */
  tick(): Promise<void>;
  view(): SchedulesView;
}

export function createScheduleService(deps: { store: ScheduleStore; firer: Firer; now(): Date }): ScheduleService {
  let on = false;
  let answered = false;

  async function tick(): Promise<void> {
    if (!on) return;
    const now = deps.now();
    const due = deps.store.list().filter((s) => isDue(s, now) && !deps.firer.running(s.id));
    await Promise.all(due.map((s) => deps.firer.fire(s, { late: isLate(s, now) }).catch((e) => console.error('[schedules] a firing failed', e instanceof Error ? e.message : e))));
  }

  return {
    enabled: () => on,
    asked: () => answered,
    async setEnabled(value) {
      answered = true;
      on = value;
      if (on) await tick();
    },
    hasActive: () => activeSchedules(deps.store.list()).length > 0,
    tick,
    view: () => ({ schedules: deps.store.list(), enabled: on, asked: answered }),
  };
}
