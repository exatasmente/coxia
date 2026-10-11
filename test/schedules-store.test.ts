// The schedules on disk (#275): made, listed, changed and removed; read again by a new store over the same file, as after a restart; a file that cannot be read is kept, not
// written over.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScheduleStore } from '../src/main/schedules/store';

const WORKDAYS = [1, 2, 3, 4, 5];
const at = (day: number, h: number, m = 0) => new Date(2026, 2, day, h, m);
const world = (now = at(2, 10)) => ({ persona: 'me', hasThread: (id: string) => id === 'agent-me', now });
const input = { prompt: 'Summarise the day.', recurrence: { kind: 'every' as const, minutes: 5 }, thread: 'agent-me' };

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-schedules-'));
  file = join(dir, 'schedules.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the schedules store', () => {
  it('makes, lists, changes and removes a schedule, saying who did it and when', () => {
    const store = createScheduleStore(file);
    const made = store.create(input, 'user', world(), WORKDAYS);
    expect(made).toMatchObject({ persona: 'me', createdBy: 'user', updatedBy: 'user', paused: false, nextRun: at(2, 10, 5).toISOString(), lastRun: null });
    expect(store.list().map((s) => s.id)).toEqual([made.id]);

    const changed = store.update(made.id, { prompt: 'Look at the board.' }, 'me', world(at(2, 11)), WORKDAYS);
    expect(changed).toMatchObject({ prompt: 'Look at the board.', createdBy: 'user', updatedBy: 'me', updatedAt: at(2, 11).toISOString(), nextRun: made.nextRun });

    expect(store.remove(made.id)).toBe(true);
    expect(store.remove(made.id)).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('keeps the schedules across a restart: a new store over the same file reads them as they were', () => {
    const first = createScheduleStore(file);
    const made = first.create(input, 'user', world(), WORKDAYS);
    first.update(made.id, { paused: true }, 'user', world(), WORKDAYS);
    const again = createScheduleStore(file);
    expect(again.list()).toEqual(first.list());
    expect(again.get(made.id)?.paused).toBe(true);
  });

  it('counts a new rhythm and a schedule taken off pause from now, not from before', () => {
    const store = createScheduleStore(file);
    const made = store.create({ ...input, paused: true }, 'user', world(), WORKDAYS);
    const resumed = store.update(made.id, { paused: false }, 'user', world(at(3, 8)), WORKDAYS);
    expect(resumed.nextRun).toBe(at(3, 8, 5).toISOString());
  });

  it('marks a firing: the next time from now, a one-off ends, an error is kept without pausing', () => {
    const store = createScheduleStore(file);
    const every = store.create(input, 'user', world(), WORKDAYS);
    // Fired three hours late: the next one is five minutes from now, not the backlog.
    expect(store.markRan(every.id, at(2, 13), WORKDAYS)).toMatchObject({ lastRun: at(2, 13).toISOString(), nextRun: at(2, 13, 5).toISOString(), lastError: null });
    const once = store.create({ ...input, recurrence: { kind: 'once', at: at(2, 12).toISOString() } }, 'user', world(), WORKDAYS);
    expect(store.markRan(once.id, at(2, 12), WORKDAYS)?.nextRun).toBeNull();
    expect(store.markRan(every.id, at(2, 14), WORKDAYS, 'thread')).toMatchObject({ lastError: 'thread', paused: false });
    expect(store.markRan('s-gone', at(2, 14), WORKDAYS)).toBeNull();
  });

  it('does not write over a file it cannot read: the original is set aside before the next write', () => {
    writeFileSync(file, '{ not json');
    const store = createScheduleStore(file);
    expect(store.list()).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
    store.create(input, 'user', world(), WORKDAYS);
    const aside = readdirSync(dir).filter((f) => f.startsWith('schedules.json.broken-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]), 'utf8')).toBe('{ not json');
    expect(store.list()).toHaveLength(1);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('refuses an id it does not have', () => {
    const store = createScheduleStore(file);
    expect(() => store.update('s-none', { paused: true }, 'user', world(), WORKDAYS)).toThrow('notFound');
  });
});
