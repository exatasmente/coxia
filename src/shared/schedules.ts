// The schedules that wake the persona (#275): the app's own agenda, kept on disk and owned by no model session. Shared by the main process (store, clock, the persona's tools)
// and the renderer (the screen that lists and edits them).

/** When a schedule fires: every N minutes, at a time of day on some weekdays (0 Sunday … 6 Saturday), or once at a date and time. */
export type Recurrence = { kind: 'every'; minutes: number } | { kind: 'daily'; time: string; days: number[] } | { kind: 'once'; at: string };

/**
 * What a firing does (#250): wake the persona with a prompt (a model turn), or one of the direct actions that call no model to decide: call an agent of the team with a prompt,
 * start a run of the cycle for an issue or card, or run a ceremony that needs no card.
 */
export type ScheduleAction =
  | { kind: 'persona'; prompt: string }
  | { kind: 'agent'; agent: string; prompt: string }
  | { kind: 'run'; ref: string; repo?: string }
  | { kind: 'ceremony'; ceremony: string; squad?: string };

export type ScheduleActionKind = ScheduleAction['kind'];
export const SCHEDULE_ACTION_KINDS: readonly ScheduleActionKind[] = ['persona', 'agent', 'run', 'ceremony'];

/** What happens to a firing missed while the app was closed or the scheduler off: run once, marked late, or skip to the next time. */
export type ScheduleMissed = 'run' | 'skip';

/** The ceremonies a schedule may run directly: the ones that run with no card and no person answering. */
export const DIRECT_CEREMONIES = ['retro'] as const;
export type DirectCeremony = (typeof DIRECT_CEREMONIES)[number];

/** The prompt an action carries, or empty for the actions that take none. */
export const actionPrompt = (a: ScheduleAction): string => (a.kind === 'persona' || a.kind === 'agent' ? a.prompt : '');

export interface Schedule {
  id: string;
  /** The persona woken: the workspace's own, by id. */
  persona: string;
  /** The prompt of the action (persona or agent), empty for the others: kept so the readers of #275 still find it. */
  prompt: string;
  /** What a firing does; a schedule written before #250 reads as waking the persona with its prompt. */
  action: ScheduleAction;
  /** What happens to a missed firing; `run` for a schedule written before #250. */
  missed: ScheduleMissed;
  /** A direct action of a firing that waits for the person's approval in Actions: no second one opens until it is over. */
  waiting: { actionId: string; since: string } | null;
  /** The last firing that was skipped by the missed-firing rule (the time that was missed). */
  lastSkipped?: string | null;
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
  /** The persona's prompt when no action is given (the input of #275). */
  prompt?: string;
  /** What a firing does; waking the persona with `prompt` when absent. */
  action?: ScheduleAction;
  missed?: ScheduleMissed;
  recurrence: Recurrence;
  workdaysOnly?: boolean;
  thread: string;
  paused?: boolean;
}

/** What may change in a schedule. A `prompt` alone changes the prompt of a persona or agent action. */
export type SchedulePatch = Partial<Pick<Schedule, 'prompt' | 'action' | 'missed' | 'recurrence' | 'workdaysOnly' | 'thread' | 'paused'>>;

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
/** A missed firing the schedule's rule skipped; says the time that was missed. */
export const SCHEDULE_SKIPPED = 'schedule.skipped';
/** A direct action that is done, with what it did. */
export const SCHEDULE_DONE = 'schedule.done';
/** A direct action that failed; the schedule stays as it was for its next time. */
export const SCHEDULE_FAILED = 'schedule.failed';
/** A direct action that waits for the person's approval in Actions. */
export const SCHEDULE_WAITING = 'schedule.waiting';
/** A time that came while the action of an earlier firing still waits: nothing new is opened. */
export const SCHEDULE_STILL_WAITING = 'schedule.stillWaiting';
/** The door a scheduled turn comes in by (the persona session's `door`). */
export const SCHEDULE_DOOR = 'schedule';
