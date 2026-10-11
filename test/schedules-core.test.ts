// The rules of a schedule (#275): when it fires next for each kind of recurrence, the working days, whether it is due or late, and what an input may not be. Pure, with dates in
// local time (2026-03-02 is a Monday).
import { describe, expect, it } from 'vitest';
import { ScheduleError, checkRecurrence, isDue, isLate, nextRun, validateInput, validatePatch } from '../src/main/schedules/core';
import { type Schedule, asksAtStart } from '../src/shared/schedules';

const at = (day: number, h: number, m = 0) => new Date(2026, 2, day, h, m);
const WORKDAYS = [1, 2, 3, 4, 5];
const world = (over: Partial<Parameters<typeof validateInput>[1]> = {}) => ({ persona: 'me', hasThread: (id: string) => id === 'agent-me', now: at(2, 10), ...over });
const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ScheduleError ? e.code : String(e);
  }
};

describe('the next firing of a schedule', () => {
  it('fires every N minutes from the last time', () => {
    expect(nextRun({ kind: 'every', minutes: 30 }, at(2, 10))).toEqual(at(2, 10, 30));
  });

  it('moves an interval that lands outside the working days to the start of the next working day', () => {
    // Friday 23:50 plus 30 minutes is Saturday: the next working day is Monday the 9th.
    expect(nextRun({ kind: 'every', minutes: 30 }, at(6, 23, 50), WORKDAYS)).toEqual(at(9, 0));
    expect(nextRun({ kind: 'every', minutes: 30 }, at(6, 23, 50))).toEqual(at(7, 0, 20));
  });

  it('fires at a time of day on the weekdays it names, later today or on the next one', () => {
    expect(nextRun({ kind: 'daily', time: '09:00', days: [1, 3] }, at(2, 8))).toEqual(at(2, 9));
    expect(nextRun({ kind: 'daily', time: '09:00', days: [1, 3] }, at(2, 10))).toEqual(at(4, 9));
    // Sunday is named but is not a working day.
    expect(nextRun({ kind: 'daily', time: '09:00', days: [0, 1] }, at(7, 10), WORKDAYS)).toEqual(at(9, 9));
  });

  it('fires a one-off once, at its time, and never again', () => {
    expect(nextRun({ kind: 'once', at: at(3, 12).toISOString() }, at(2, 10))).toEqual(at(3, 12));
    expect(nextRun({ kind: 'once', at: at(3, 12).toISOString() }, at(3, 12))).toBeNull();
  });
});

describe('due and late', () => {
  it('is due when active and its time came; late when it came two minutes ago or more', () => {
    const s = { paused: false, nextRun: at(2, 10).toISOString() };
    expect(isDue(s, at(2, 9, 59))).toBe(false);
    expect(isDue(s, at(2, 10))).toBe(true);
    expect(isDue({ ...s, paused: true }, at(2, 11))).toBe(false);
    expect(isDue({ ...s, nextRun: null }, at(2, 11))).toBe(false);
    expect(isLate(s, at(2, 10, 1))).toBe(false);
    expect(isLate(s, at(2, 10, 2))).toBe(true);
  });
});

describe('the question at the start', () => {
  const s = (paused: boolean, nextRun: string | null) => ({ paused, nextRun }) as Schedule;
  it('is asked only with an active schedule and only once per session of the app', () => {
    expect(asksAtStart({ schedules: [], enabled: false, asked: false })).toBe(false);
    expect(asksAtStart({ schedules: [s(true, 'x'), s(false, null)], enabled: false, asked: false })).toBe(false);
    expect(asksAtStart({ schedules: [s(false, 'x')], enabled: false, asked: false })).toBe(true);
    expect(asksAtStart({ schedules: [s(false, 'x')], enabled: false, asked: true })).toBe(false);
  });
});

describe('what a schedule may not be', () => {
  const input = { prompt: 'Summarise the day.', recurrence: { kind: 'every' as const, minutes: 5 }, thread: 'agent-me' };

  it('takes a well-formed one and fills the persona and the defaults', () => {
    expect(validateInput(input, world())).toEqual({ persona: 'me', prompt: 'Summarise the day.', recurrence: { kind: 'every', minutes: 5 }, workdaysOnly: false, thread: 'agent-me', paused: false });
  });

  it('refuses an interval under a minute, an empty prompt, a missing persona or conversation', () => {
    expect(code(() => validateInput({ ...input, recurrence: { kind: 'every', minutes: 0 } }, world()))).toBe('interval');
    expect(code(() => validateInput({ ...input, prompt: '   ' }, world()))).toBe('prompt');
    expect(code(() => validateInput({ ...input, prompt: 'x'.repeat(4001) }, world()))).toBe('prompt');
    expect(code(() => validateInput(input, world({ persona: null })))).toBe('persona');
    expect(code(() => validateInput({ ...input, persona: 'someone-else' }, world()))).toBe('persona');
    expect(code(() => validateInput({ ...input, thread: 'general-gone' }, world()))).toBe('thread');
  });

  it('refuses a time of day with no weekday or a bad time, a one-off in the past, and an unknown kind', () => {
    expect(code(() => checkRecurrence({ kind: 'daily', time: '09:00', days: [] }, at(2, 10)))).toBe('days');
    expect(code(() => checkRecurrence({ kind: 'daily', time: '25:00', days: [1] }, at(2, 10)))).toBe('time');
    expect(code(() => checkRecurrence({ kind: 'once', at: at(2, 9).toISOString() }, at(2, 10)))).toBe('past');
    expect(code(() => checkRecurrence({ kind: 'cron', expr: '* * * * *' }, at(2, 10)))).toBe('recurrence');
    expect(checkRecurrence({ kind: 'daily', time: '09:00', days: [3, 1, 1, 9] }, at(2, 10))).toEqual({ kind: 'daily', time: '09:00', days: [1, 3] });
  });

  it('checks only the fields a patch names', () => {
    expect(validatePatch({ paused: true }, world())).toEqual({ paused: true });
    expect(code(() => validatePatch({ recurrence: { kind: 'every', minutes: -1 } }, world()))).toBe('interval');
  });
});
