import {
  type Recurrence,
  type Schedule,
  type ScheduleAction,
  type ScheduleInput,
  type ScheduleMissed,
  type SchedulePatch,
  DIRECT_CEREMONIES,
  SCHEDULE_MIN_MINUTES,
  SCHEDULE_PROMPT_MAX,
  actionPrompt,
} from '../../shared/schedules';

// The rules of a schedule (#275), pure: when it fires next, whether it is due, and whether an input is one the store may keep. The clock is always given, so a test drives it.

const MINUTE = 60_000;
/** A firing this late or more is said to be late in the conversation (the app was closed, or the scheduler was off). */
export const LATE_MS = 2 * MINUTE;
/** The longest search for the next working day or weekday: two weeks covers any set of days. */
const SEARCH_DAYS = 14;

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** `HH:MM` as hours and minutes, or null. */
export function parseTime(text: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

/**
 * The first time strictly after `after` the recurrence fires, in local time, or null when it never fires again (a one-off that is past). `workdays`, when given, keeps it to
 * those weekdays: an interval that lands on another day moves to the start of the next working day.
 */
export function nextRun(rec: Recurrence, after: Date, workdays?: readonly number[]): Date | null {
  const allowed = (d: Date): boolean => !workdays || workdays.includes(d.getDay());
  if (rec.kind === 'once') {
    const at = new Date(rec.at);
    return Number.isNaN(at.getTime()) || at.getTime() <= after.getTime() ? null : at;
  }
  if (rec.kind === 'every') {
    const next = new Date(after.getTime() + Math.max(SCHEDULE_MIN_MINUTES, rec.minutes) * MINUTE);
    if (allowed(next)) return next;
    for (let i = 1; i <= SEARCH_DAYS; i++) {
      const day = addDays(startOfDay(next), i);
      if (allowed(day)) return day;
    }
    return null;
  }
  const time = parseTime(rec.time);
  if (!time) return null;
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const day = addDays(startOfDay(after), i);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m);
    if (at.getTime() <= after.getTime()) continue;
    if (rec.days.includes(at.getDay()) && allowed(at)) return at;
  }
  return null;
}

/** Whether the schedule should fire now: active, with a next time that has come. */
export const isDue = (s: Pick<Schedule, 'paused' | 'nextRun'>, now: Date): boolean => !s.paused && s.nextRun !== null && Date.parse(s.nextRun) <= now.getTime();

/** Whether a firing is late enough to say so. */
export const isLate = (s: Pick<Schedule, 'nextRun'>, now: Date): boolean => s.nextRun !== null && now.getTime() - Date.parse(s.nextRun) >= LATE_MS;

/** What can be wrong with a schedule; the message is the catalog's `main.schedules.error.<code>`. */
export type ScheduleProblem = 'prompt' | 'recurrence' | 'interval' | 'time' | 'days' | 'past' | 'persona' | 'thread' | 'action' | 'agent' | 'ceremony' | 'ref' | 'missed';

export class ScheduleError extends Error {
  constructor(readonly code: ScheduleProblem | 'notFound' | 'tooMany' | 'fromSchedule') {
    super(code);
    this.name = 'ScheduleError';
  }
}

/** The recurrence as given, checked: an interval of at least a minute, a time of day with at least one weekday, a one-off that is not past. */
export function checkRecurrence(raw: unknown, now: Date): Recurrence {
  const r = raw as Partial<Record<string, unknown>> | null;
  if (!r || typeof r !== 'object') throw new ScheduleError('recurrence');
  if (r.kind === 'every') {
    if (typeof r.minutes !== 'number' || !Number.isInteger(r.minutes) || r.minutes < SCHEDULE_MIN_MINUTES) throw new ScheduleError('interval');
    return { kind: 'every', minutes: r.minutes };
  }
  if (r.kind === 'daily') {
    if (typeof r.time !== 'string' || !parseTime(r.time)) throw new ScheduleError('time');
    const days = Array.isArray(r.days) ? [...new Set(r.days)].filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
    if (!days.length) throw new ScheduleError('days');
    return { kind: 'daily', time: r.time, days };
  }
  if (r.kind === 'once') {
    const at = typeof r.at === 'string' ? new Date(r.at) : null;
    if (!at || Number.isNaN(at.getTime())) throw new ScheduleError('time');
    // A minute of slack: a person who picks "now" on the screen is not refused for the seconds it took.
    if (at.getTime() < now.getTime() - MINUTE) throw new ScheduleError('past');
    return { kind: 'once', at: at.toISOString() };
  }
  throw new ScheduleError('recurrence');
}

const checkPrompt = (raw: unknown): string => {
  const prompt = typeof raw === 'string' ? raw.trim() : '';
  if (!prompt || prompt.length > SCHEDULE_PROMPT_MAX) throw new ScheduleError('prompt');
  return prompt;
};

/** What a schedule may point at: the persona that exists, the conversations that do, and what a direct action may name (#250). */
export interface ScheduleWorld {
  persona: string | null;
  hasThread(thread: string): boolean;
  now: Date;
  /** The agents of the team a schedule may call: every one but the persona. None when not given. */
  agents?: readonly string[];
  /** The direct ceremonies the workspace has on. None when not given. */
  ceremonies?: readonly string[];
  /** Whether a text is an issue or card the runner can start a run for. None is when not given. */
  isRef?(ref: string): boolean;
}

const text = (raw: unknown): string => (typeof raw === 'string' ? raw.trim() : '');

/** An action as given, checked: a prompt where the action takes one, an agent of the team that is not the persona, a ref the runner reads, a direct ceremony that is on. */
export function checkAction(raw: unknown, world: ScheduleWorld): ScheduleAction {
  const a = raw as Partial<Record<string, unknown>> | null;
  if (!a || typeof a !== 'object') throw new ScheduleError('action');
  if (a.kind === 'persona') return { kind: 'persona', prompt: checkPrompt(a.prompt) };
  if (a.kind === 'agent') {
    const agent = text(a.agent);
    // The persona is woken by its own action: an agent schedule never calls it.
    if (!agent || agent === world.persona || !world.agents?.includes(agent)) throw new ScheduleError('agent');
    return { kind: 'agent', agent, prompt: checkPrompt(a.prompt) };
  }
  if (a.kind === 'run') {
    const ref = text(a.ref);
    if (!ref || !world.isRef?.(ref)) throw new ScheduleError('ref');
    const repo = text(a.repo);
    return repo ? { kind: 'run', ref, repo } : { kind: 'run', ref };
  }
  if (a.kind === 'ceremony') {
    const ceremony = text(a.ceremony);
    if (!(DIRECT_CEREMONIES as readonly string[]).includes(ceremony) || !world.ceremonies?.includes(ceremony)) throw new ScheduleError('ceremony');
    const squad = text(a.squad);
    return squad ? { kind: 'ceremony', ceremony, squad } : { kind: 'ceremony', ceremony };
  }
  throw new ScheduleError('action');
}

const checkMissed = (raw: unknown): ScheduleMissed => {
  if (raw === 'run' || raw === 'skip') return raw;
  throw new ScheduleError('missed');
};

/** A schedule's input once checked: every field the store keeps from it. */
export interface ValidInput {
  persona: string;
  prompt: string;
  action: ScheduleAction;
  missed: ScheduleMissed;
  recurrence: Recurrence;
  workdaysOnly: boolean;
  thread: string;
  paused: boolean;
}

/** A new schedule's input, checked and normalised; throws a ScheduleError naming what is wrong. With no action it wakes the persona with the prompt, and runs a missed firing once. */
export function validateInput(input: ScheduleInput, world: ScheduleWorld): ValidInput {
  const persona = world.persona;
  if (!persona || (input.persona !== undefined && input.persona !== persona)) throw new ScheduleError('persona');
  const thread = typeof input.thread === 'string' ? input.thread.trim() : '';
  if (!thread || !world.hasThread(thread)) throw new ScheduleError('thread');
  const action = input.action !== undefined ? checkAction(input.action, world) : ({ kind: 'persona', prompt: checkPrompt(input.prompt) } as const);
  return {
    persona,
    prompt: actionPrompt(action),
    action,
    missed: input.missed === undefined ? 'run' : checkMissed(input.missed),
    recurrence: checkRecurrence(input.recurrence, world.now),
    workdaysOnly: input.workdaysOnly === true,
    thread,
    paused: input.paused === true,
  };
}

/** A patch, checked field by field; only the fields it names change. A prompt alone is checked here and given to the action by the store, which knows it. */
export function validatePatch(patch: SchedulePatch, world: ScheduleWorld): SchedulePatch {
  const out: SchedulePatch = {};
  if (!patch || typeof patch !== 'object') return out;
  if (patch.action !== undefined) {
    out.action = checkAction(patch.action, world);
    out.prompt = actionPrompt(out.action);
  } else if (patch.prompt !== undefined) out.prompt = checkPrompt(patch.prompt);
  if (patch.missed !== undefined) out.missed = checkMissed(patch.missed);
  if (patch.recurrence !== undefined) out.recurrence = checkRecurrence(patch.recurrence, world.now);
  if (patch.workdaysOnly !== undefined) out.workdaysOnly = patch.workdaysOnly === true;
  if (patch.paused !== undefined) out.paused = patch.paused === true;
  if (patch.thread !== undefined) {
    const thread = typeof patch.thread === 'string' ? patch.thread.trim() : '';
    if (!thread || !world.hasThread(thread)) throw new ScheduleError('thread');
    out.thread = thread;
  }
  return out;
}

/** The first firing of a schedule from `now`; a one-off fires at its own time. */
export function firstRun(s: Pick<Schedule, 'recurrence' | 'workdaysOnly'>, now: Date, workdays: readonly number[]): string | null {
  return nextRun(s.recurrence, now, s.workdaysOnly ? workdays : undefined)?.toISOString() ?? null;
}
