// The words of the Schedules screen (#250): what each action does, the notes beside a schedule (skip rule, wait for approval, skipped time, failure), and what the form needs.
import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Schedule } from '../src/shared/schedules';
import { describeAction, scheduleNotes } from '../src/renderer/src/schedulesModel';

const name = (id: string): string => (id === 'dev' ? 'Dev' : id);
const when = (iso: string | null): string => iso ?? '–';
const base = { action: { kind: 'persona', prompt: 'x' }, missed: 'run', waiting: null, lastError: null, lastSkipped: null } as unknown as Schedule;

beforeEach(() => setLanguage('en'));

describe('the Schedules screen words', () => {
  it('says what each action does', () => {
    expect(describeAction({ kind: 'persona', prompt: 'Summarise.' }, name)).toBe('Summarise.');
    expect(describeAction({ kind: 'agent', agent: 'dev', prompt: 'Check.' }, name)).toBe('Call Dev: Check.');
    expect(describeAction({ kind: 'run', ref: '12' }, name)).toBe('Start a run for 12');
    expect(describeAction({ kind: 'ceremony', ceremony: 'retro' }, name)).toBe('Run the Retro');
  });

  it('notes the skip rule, a wait, a skipped time and a failure; the gone conversation keeps its own words', () => {
    expect(scheduleNotes(base, when)).toEqual([]);
    expect(scheduleNotes({ ...base, missed: 'skip', waiting: { actionId: 'a-1', since: 'T1' }, lastSkipped: 'T0', lastError: 'boom' }, when)).toEqual([
      'missed times are skipped',
      'waiting for your approval in Actions since T1',
      'skipped the time T0',
      'the last firing failed: boom',
    ]);
    expect(scheduleNotes({ ...base, lastError: 'thread' }, when)).toEqual(['the last firing was skipped: its conversation no longer exists']);
  });
});
