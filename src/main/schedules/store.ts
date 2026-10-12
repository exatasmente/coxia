import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Schedule, type ScheduleAction, type ScheduleInput, type SchedulePatch, SCHEDULES_MAX, actionPrompt } from '../../shared/schedules';
import { type ScheduleWorld, ScheduleError, firstRun, nextRun, validateInput, validatePatch } from './core';

// The schedules of a workspace on disk (#275): one JSON file in the workspace's own data, written whole through a temporary file and a rename, as status.json is. It holds no
// model session and no secret: the app reads it at each tick, so a schedule outlives the app, its window and every session of a model.

interface FileShape {
  v: 1;
  schedules: Schedule[];
}

export interface ScheduleStore {
  list(): Schedule[];
  get(id: string): Schedule | null;
  create(input: ScheduleInput, by: string, world: ScheduleWorld, workdays: readonly number[]): Schedule;
  update(id: string, patch: SchedulePatch, by: string, world: ScheduleWorld, workdays: readonly number[]): Schedule;
  remove(id: string): boolean;
  /** A firing is over (answered or not): the next time is counted from `now`, so firings missed while the app was closed become one. */
  markRan(id: string, now: Date, workdays: readonly number[], error?: string | null): Schedule | null;
  /** A missed firing skipped by the schedule's rule (#250): the next time is the first one after `now`, and the time that was missed is kept. */
  markSkipped(id: string, now: Date, workdays: readonly number[]): Schedule | null;
  /** The action of a firing waits for the person's approval (an Actions proposal), or no longer does (null). */
  setWaiting(id: string, waiting: Schedule['waiting']): Schedule | null;
  /** Why the last firing failed, or null; the times stay as they are. */
  setError(id: string, error: string | null): Schedule | null;
}

/** An action read from the file with the fields its kind needs; anything else (a hand edit, a file of a newer app) reads as waking the persona. */
function wellFormed(a: unknown): a is ScheduleAction {
  const x = a as Partial<Record<string, unknown>> | null;
  if (!x || typeof x !== 'object') return false;
  if (x.kind === 'persona') return typeof x.prompt === 'string';
  if (x.kind === 'agent') return typeof x.agent === 'string' && typeof x.prompt === 'string';
  if (x.kind === 'run') return typeof x.ref === 'string';
  if (x.kind === 'ceremony') return typeof x.ceremony === 'string';
  return false;
}

/**
 * A schedule as read from the file: one written before #250 has no action, no missed-firing rule and no wait, and reads as waking the persona with its prompt and running a
 * missed firing once. The file changes only at the next write; its version stays, as fields are only added.
 */
export function normalise(raw: Schedule): Schedule {
  const s = raw as Partial<Schedule> & Schedule;
  const action = wellFormed(s.action) ? s.action : { kind: 'persona' as const, prompt: typeof s.prompt === 'string' ? s.prompt : '' };
  return { ...s, action, prompt: actionPrompt(action), missed: s.missed === 'skip' ? 'skip' : 'run', waiting: s.waiting && typeof s.waiting.actionId === 'string' ? s.waiting : null };
}

let sequence = 0;
const newId = (now: Date): string => `s-${now.getTime().toString(36)}-${(sequence += 1)}`;

/** The store over one file; every time it stamps comes from the caller's clock. */
export function createScheduleStore(file: string): ScheduleStore {
  // A file that cannot be read is set aside before the first write, never written over: what it held can still be recovered by hand.
  let broken = false;

  function read(): Schedule[] {
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileShape>;
      if (!Array.isArray(parsed.schedules)) throw new Error('no schedules');
      broken = false;
      return parsed.schedules.filter((s) => s && typeof s.id === 'string').map(normalise);
    } catch (e) {
      if (!broken) console.error('[schedules] could not read the schedules; the file is kept as it is', e instanceof Error ? e.message : e);
      broken = true;
      return [];
    }
  }

  function write(schedules: Schedule[]): void {
    mkdirSync(dirname(file), { recursive: true });
    if (broken && existsSync(file)) renameSync(file, `${file}.broken-${Date.now()}`);
    broken = false;
    const body: FileShape = { v: 1, schedules };
    writeFileSync(`${file}.tmp`, JSON.stringify(body, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  const find = (all: Schedule[], id: string): number => {
    const i = all.findIndex((s) => s.id === id);
    if (i < 0) throw new ScheduleError('notFound');
    return i;
  };

  return {
    list: read,
    get: (id) => read().find((s) => s.id === id) ?? null,
    create(input, by, world, workdays) {
      const all = read();
      if (all.length >= SCHEDULES_MAX) throw new ScheduleError('tooMany');
      const v = validateInput(input, world);
      const at = world.now.toISOString();
      const made: Schedule = {
        id: newId(world.now),
        ...v,
        waiting: null,
        createdBy: by,
        updatedBy: by,
        createdAt: at,
        updatedAt: at,
        nextRun: firstRun(v, world.now, workdays),
        lastRun: null,
        lastError: null,
      };
      write([...all, made]);
      return made;
    },
    update(id, patch, by, world, workdays) {
      const all = read();
      const i = find(all, id);
      const changes = validatePatch(patch, world);
      const before = all[i];
      // A prompt alone goes to the action that takes one; an action that takes none has no prompt to change.
      if (changes.prompt !== undefined && !changes.action) {
        if (before.action.kind !== 'persona' && before.action.kind !== 'agent') throw new ScheduleError('prompt');
        changes.action = { ...before.action, prompt: changes.prompt };
      }
      const next: Schedule = { ...before, ...changes, updatedBy: by, updatedAt: world.now.toISOString() };
      // Another action no longer waits for the proposal of the one before: the schedule fires again at its next time.
      if (changes.action && JSON.stringify(changes.action) !== JSON.stringify(before.action)) next.waiting = null;
      // A new rhythm, or a schedule taken off pause, counts from now: a pause is not a backlog of firings.
      if (changes.recurrence || changes.workdaysOnly !== undefined || (before.paused && changes.paused === false)) next.nextRun = firstRun(next, world.now, workdays);
      all[i] = next;
      write(all);
      return next;
    },
    remove(id) {
      const all = read();
      const rest = all.filter((s) => s.id !== id);
      if (rest.length === all.length) return false;
      write(rest);
      return true;
    },
    markRan(id, now, workdays, error = null) {
      const all = read();
      const i = all.findIndex((s) => s.id === id);
      // Removed while it ran: nothing to mark.
      if (i < 0) return null;
      const s = all[i];
      const next = s.recurrence.kind === 'once' ? null : (nextRun(s.recurrence, now, s.workdaysOnly ? workdays : undefined)?.toISOString() ?? null);
      all[i] = { ...s, lastRun: now.toISOString(), nextRun: next, lastError: error };
      write(all);
      return all[i];
    },
    markSkipped(id, now, workdays) {
      return change(id, (s) => ({ ...s, lastSkipped: s.nextRun, nextRun: s.recurrence.kind === 'once' ? null : (nextRun(s.recurrence, now, s.workdaysOnly ? workdays : undefined)?.toISOString() ?? null) }));
    },
    setWaiting: (id, waiting) => change(id, (s) => ({ ...s, waiting })),
    setError: (id, error) => change(id, (s) => ({ ...s, lastError: error })),
  };

  /** One schedule changed in place by `fn`; null when it was removed meanwhile. */
  function change(id: string, fn: (s: Schedule) => Schedule): Schedule | null {
    const all = read();
    const i = all.findIndex((s) => s.id === id);
    if (i < 0) return null;
    all[i] = fn(all[i]);
    write(all);
    return all[i];
  }
}
