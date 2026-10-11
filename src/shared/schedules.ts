// The schedules that wake the persona (#275): the app's own agenda, kept on disk and owned by no model session. Shared by the main process (store, clock, the persona's tools)
// and the renderer (the screen that lists and edits them).

/** When a schedule fires: every N minutes, at a time of day on some weekdays (0 Sunday … 6 Saturday), or once at a date and time. */
export type Recurrence = { kind: 'every'; minutes: number } | { kind: 'daily'; time: string; days: number[] } | { kind: 'once'; at: string };

export interface Schedule {
  id: string;
  /** The persona woken: the workspace's own, by id. */
  persona: string;
  /** What the persona is asked when the schedule fires. */
  prompt: string;
  recurrence: Recurrence;
  /** Fires only on the workspace's working days (Settings → Agenda). */
  workdaysOnly: boolean;
  /** The conversation the turn and its answer go to. */
  thread: string;
  paused: boolean;
  /** `user`, or the id of the persona that made or changed it. */
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  /** The next time it fires; null once a one-off schedule has run. */
  nextRun: string | null;
  lastRun: string | null;
  /** Why the last firing could not run (its conversation is gone); null when it ran. */
  lastError: string | null;
}

/** What a person or the persona gives to make a schedule; the store fills in the rest. */
export interface ScheduleInput {
  persona?: string;
  prompt: string;
  recurrence: Recurrence;
  workdaysOnly?: boolean;
  thread: string;
  paused?: boolean;
}

/** What may change in a schedule. */
export type SchedulePatch = Partial<Pick<Schedule, 'prompt' | 'recurrence' | 'workdaysOnly' | 'thread' | 'paused'>>;

/** The screen's view: the schedules, and whether the scheduler runs in this session of the app. */
export interface SchedulesView {
  schedules: Schedule[];
  enabled: boolean;
  /** The person already answered the question at the start (or used the switch) in this session of the app. */
  asked: boolean;
}

/** The schedules that would fire: active, with a next time. */
export const activeSchedules = (list: readonly Schedule[]): Schedule[] => list.filter((s) => !s.paused && s.nextRun !== null);

/** Whether the question at the start is due: an active schedule, and no answer yet in this session of the app. */
export const asksAtStart = (v: SchedulesView): boolean => !v.asked && activeSchedules(v.schedules).length > 0;

export const SCHEDULE_PROMPT_MAX = 4000;
/** The shortest interval a recurring schedule may have. */
export const SCHEDULE_MIN_MINUTES = 1;
/** At most this many schedules in a workspace. */
export const SCHEDULES_MAX = 50;
/** The system line the app posts when a schedule fires; the persona's answer answers it. */
export const SCHEDULE_FIRED = 'schedule.fired';
/** The same line for a firing whose time passed while the app was closed or the scheduler off. */
export const SCHEDULE_FIRED_LATE = 'schedule.firedLate';
/** The door a scheduled turn comes in by (the persona session's `door`). */
export const SCHEDULE_DOOR = 'schedule';
