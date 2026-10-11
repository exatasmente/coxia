import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Schedule, type ScheduleInput, type SchedulePatch, SCHEDULES_MAX } from '../../shared/schedules';
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
      return parsed.schedules.filter((s) => s && typeof s.id === 'string');
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
      const made: Schedule = { id: newId(world.now), ...v, createdBy: by, updatedBy: by, createdAt: at, updatedAt: at, nextRun: firstRun(v, world.now, workdays), lastRun: null, lastError: null };
      write([...all, made]);
      return made;
    },
    update(id, patch, by, world, workdays) {
      const all = read();
      const i = find(all, id);
      const changes = validatePatch(patch, world);
      const before = all[i];
      const next: Schedule = { ...before, ...changes, updatedBy: by, updatedAt: world.now.toISOString() };
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
  };
}
