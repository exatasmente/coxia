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

  it('reads a schedule written before #250 as waking the persona and running a missed firing once, without writing the file', () => {
    const old = { id: 's-old', persona: 'me', prompt: 'Summarise the day.', recurrence: { kind: 'every', minutes: 5 }, workdaysOnly: false, thread: 'agent-me', paused: false, createdBy: 'user', updatedBy: 'user', createdAt: at(1, 9).toISOString(), updatedAt: at(1, 9).toISOString(), nextRun: at(2, 10).toISOString(), lastRun: null, lastError: null };
    const body = JSON.stringify({ v: 1, schedules: [old] });
    writeFileSync(file, body);
    const store = createScheduleStore(file);
    expect(store.get('s-old')).toMatchObject({ action: { kind: 'persona', prompt: 'Summarise the day.' }, prompt: 'Summarise the day.', missed: 'run', waiting: null });
    expect(readFileSync(file, 'utf8')).toBe(body);
  });

  it('skips a missed firing: the next time from now, the missed one kept; a one-off ends', () => {
    const store = createScheduleStore(file);
    const every = store.create({ ...input, missed: 'skip' }, 'user', world(), WORKDAYS);
    expect(store.markSkipped(every.id, at(2, 13), WORKDAYS)).toMatchObject({ lastSkipped: at(2, 10, 5).toISOString(), nextRun: at(2, 13, 5).toISOString(), lastRun: null });
    const once = store.create({ ...input, recurrence: { kind: 'once', at: at(2, 12).toISOString() } }, 'user', world(), WORKDAYS);
    expect(store.markSkipped(once.id, at(2, 14), WORKDAYS)?.nextRun).toBeNull();
  });

  it('keeps a wait for approval across a restart, and a failure without touching the times', () => {
    const store = createScheduleStore(file);
    const made = store.create(input, 'user', world(), WORKDAYS);
    store.setWaiting(made.id, { actionId: 'a-1', since: at(2, 10).toISOString() });
    store.setError(made.id, 'boom');
    expect(createScheduleStore(file).get(made.id)).toMatchObject({ waiting: { actionId: 'a-1' }, lastError: 'boom', nextRun: made.nextRun });
    expect(store.setWaiting('s-gone', null)).toBeNull();
  });

  it('reads an action a hand edit left without the fields of its kind as waking the persona', () => {
    const bad = { id: 's-bad', persona: 'me', prompt: 'Look.', action: { kind: 'agent' }, recurrence: { kind: 'every', minutes: 5 }, thread: 'agent-me', nextRun: null };
    writeFileSync(file, JSON.stringify({ v: 1, schedules: [bad] }));
    expect(createScheduleStore(file).get('s-bad')?.action).toEqual({ kind: 'persona', prompt: 'Look.' });
  });

  it('ends a wait when the action changes, and keeps it when the same action is saved again', () => {
    const store = createScheduleStore(file);
    const w = { ...world(), isRef: () => true };
    const made = store.create({ ...input, action: { kind: 'run', ref: '12' } }, 'user', w, WORKDAYS);
    store.setWaiting(made.id, { actionId: 'a-1', since: at(2, 10).toISOString() });
    expect(store.update(made.id, { action: { kind: 'run', ref: '12' } }, 'user', w, WORKDAYS).waiting).toMatchObject({ actionId: 'a-1' });
    expect(store.update(made.id, { action: { kind: 'run', ref: '13' } }, 'user', w, WORKDAYS).waiting).toBeNull();
  });

  it('gives a new prompt to the action that takes one, and refuses it for one that takes none', () => {
    const store = createScheduleStore(file);
    const made = store.create(input, 'user', world(), WORKDAYS);
    expect(store.update(made.id, { prompt: 'Look again.' }, 'user', world(), WORKDAYS)).toMatchObject({ action: { kind: 'persona', prompt: 'Look again.' }, prompt: 'Look again.' });
    const run = store.create({ ...input, action: { kind: 'run', ref: '12' } }, 'user', { ...world(), isRef: () => true }, WORKDAYS);
    expect(() => store.update(run.id, { prompt: 'x' }, 'user', world(), WORKDAYS)).toThrow('prompt');
  });

  it('refuses an id it does not have', () => {
    const store = createScheduleStore(file);
    expect(() => store.update('s-none', { paused: true }, 'user', world(), WORKDAYS)).toThrow('notFound');
  });
});
