import type { Settings } from './settings';

// The app's own timed jobs (#250), as the Schedules screen and the persona read them: the pre-daily reminder, the retro day and the work window. Read from the settings that set
// them; they are not schedules and nothing here changes them or how the app's clock runs them (scheduler.ts).

export type SystemRoutineId = 'preDaily' | 'retro' | 'workWindow';

export interface SystemRoutine {
  id: SystemRoutineId;
  /** Whether it runs now: the reminders need their ceremony on and the notifications on; the work window always runs. */
  on: boolean;
  /** The weekdays it runs on (0 Sunday … 6 Saturday). */
  days: number[];
  /** The time of day of a reminder. */
  time?: string;
  /** The hours of the work window, and how often it checks the board in them. */
  from?: string;
  to?: string;
  everyMin?: number;
}

/** What else the routines depend on: the notifications, and whether the workspace has the pre-daily and the retro on. */
export interface RoutineFacts {
  notifications: boolean;
  preDaily: boolean;
  retro: boolean;
}

export function systemRoutines(schedule: Settings['schedule'], facts: RoutineFacts): SystemRoutine[] {
  return [
    { id: 'preDaily', on: facts.preDaily && facts.notifications, days: [...schedule.days], time: schedule.preDaily },
    { id: 'retro', on: facts.retro && facts.notifications, days: [schedule.retroDay], time: schedule.retroTime },
    { id: 'workWindow', on: true, days: [...schedule.days], from: schedule.from, to: schedule.to, everyMin: schedule.statusEveryMin },
  ];
}
