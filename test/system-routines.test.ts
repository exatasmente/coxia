// The app's own routines as the Schedules screen reads them (#250): the pre-daily reminder, the retro day and the work window, from the settings that set them, on or off with
// their ceremony and the notifications; a change of the settings is what the list shows.
import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Settings } from '../src/shared/settings';
import { systemRoutines } from '../src/shared/systemRoutines';
import { describeRoutine } from '../src/renderer/src/schedulesModel';

const schedule: Settings['schedule'] = { preDaily: '09:40', days: [1, 2, 3, 4, 5], statusEveryMin: 30, from: '08:00', to: '19:00', retroDay: 5, retroTime: '16:00' };
const all = { notifications: true, preDaily: true, retro: true };
const day = (d: number): string => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];

beforeEach(() => setLanguage('en'));

describe('the system routines', () => {
  it('lists the pre-daily, the retro and the work window with their times and days', () => {
    expect(systemRoutines(schedule, all)).toEqual([
      { id: 'preDaily', on: true, days: [1, 2, 3, 4, 5], time: '09:40' },
      { id: 'retro', on: true, days: [5], time: '16:00' },
      { id: 'workWindow', on: true, days: [1, 2, 3, 4, 5], from: '08:00', to: '19:00', everyMin: 30 },
    ]);
  });

  it('shows what the settings say after they change', () => {
    const [pre, retro, window] = systemRoutines({ ...schedule, preDaily: '10:15', retroDay: 3, from: '09:00' }, all);
    expect(pre.time).toBe('10:15');
    expect(retro.days).toEqual([3]);
    expect(window.from).toBe('09:00');
  });

  it('says a reminder is off when its ceremony or the notifications are off; the work window always runs', () => {
    expect(systemRoutines(schedule, { ...all, retro: false }).map((r) => r.on)).toEqual([true, false, true]);
    expect(systemRoutines(schedule, { ...all, notifications: false }).map((r) => r.on)).toEqual([false, false, true]);
  });

  it('words each one for the screen', () => {
    const [pre, , window] = systemRoutines(schedule, all).map((r) => describeRoutine(r, day));
    expect(pre).toEqual({ title: 'Pre-daily reminder', when: 'At 09:40 on Mon, Tue, Wed, Thu, Fri', on: true });
    expect(window.when).toBe('08:00 to 19:00 on Mon, Tue, Wed, Thu, Fri, checks every 30 min');
  });
});
