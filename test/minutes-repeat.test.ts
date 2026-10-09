import { describe, expect, it } from 'vitest';
import { type DayUnansweredEntry, type MinutesVersion, mergeDay, repeatedUnanswered } from '../src/shared/minutesVersions';

const q = (ref: string, question: string, stage: string | null, squad?: string): DayUnansweredEntry => ({ ref, question, stage, ...(squad ? { squad } : {}) });
const day = (date: string, entries: DayUnansweredEntry[]) => ({ date, unanswered: entries });

describe('mergeDay carrying the stage of an unanswered question', () => {
  it('keeps what the snapshot said when it says it, and falls back to the version\'s covered list when the day index was written before the field', () => {
    const covered = (ref: string, stage: string | null) => ({ ref, iid: ref.split('#')[1], title: `Activity ${ref}`, status: 'new' as const, url: '', stage, blockers: [], changes: [] });
    const oldVersion: MinutesVersion = {
      n: 1,
      ceremonyId: '2026-10-01T094000',
      startedAt: 1,
      endedAt: 2,
      savedAt: null,
      file: null,
      teams: null,
      written: [],
      snapshot: { decisions: [], effects: [], unanswered: [{ ref: 'acme#1', question: 'Which branch?' }], covered: [covered('acme#1', 'Code Review')] },
    };
    const merged = mergeDay([oldVersion]);
    expect(merged.unanswered).toEqual([{ ref: 'acme#1', question: 'Which branch?', stage: 'Code Review', version: 1 }]);
  });
});

describe('repeatedUnanswered', () => {
  it('pairs the same question-forma of two days even when the wording is not identical', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'Was the plan approved?', 'Code Review OK')], [day('2026-10-04', [q('acme#1', 'Can the plan be approved today?', 'Code Review OK')])]);
    expect(r).toEqual([{ ref: 'acme#1', question: 'Was the plan approved?', stage: 'Code Review OK', dates: ['2026-10-04', '2026-10-07'], count: 2 }]);
  });

  it('does not pair when the stage moved between the days', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'What blocks the merge?', 'Code Review OK')], [day('2026-10-04', [q('acme#1', 'What blocks the merge?', 'Doing')])]);
    expect(r).toEqual([]);
  });

  it('says nothing when the two days hold no question in common', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'Ship it?', 'Doing')], [day('2026-10-04', [q('acme#2', 'Who reviews?', 'Doing')])]);
    expect(r).toEqual([]);
  });

  it('counts a repetition only between different days, never two turns of the same day', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'Ship it?', 'Doing')], [day('2026-10-07', [q('acme#1', 'Ship it?', 'Doing')])]);
    expect(r).toEqual([]);
  });

  it('leaves out a question the earlier days no longer hold (it was answered or resolved there)', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'Ship it?', 'Doing')], [day('2026-10-04', [q('acme#2', 'Other question?', 'Doing')])]);
    expect(r).toEqual([]);
  });

  it('does not carry one squad\'s repetition into another squad\'s minutes', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'Ship it?', 'Doing', 'core')], [day('2026-10-04', [q('acme#1', 'Ship it?', 'Doing', 'release')])]);
    expect(r).toEqual([]);
  });

  it('pairs a day index with no stage by the activity alone', () => {
    const r = repeatedUnanswered('2026-10-07', [q('acme#1', 'Ship it?', 'Doing')], [day('2026-10-04', [q('acme#1', 'Ship it, please?', null)])]);
    expect(r).toEqual([{ ref: 'acme#1', question: 'Ship it?', stage: 'Doing', dates: ['2026-10-04', '2026-10-07'], count: 2 }]);
  });

  it('keeps the dates ascending with today last, and returns several repeaters', () => {
    const r = repeatedUnanswered(
      '2026-10-08',
      [q('acme#1', 'Ship it?', 'Doing'), q('acme#2', 'Who tests?', 'Code Review OK')],
      [day('2026-10-02', [q('acme#1', 'Ship it?', 'Doing'), q('acme#2', 'Who tests?', 'Code Review OK')]), day('2026-10-05', [q('acme#1', 'Ship it?', 'Doing')])],
    );
    expect(r.map((x) => [x.ref, x.dates, x.count])).toEqual([['acme#1', ['2026-10-02', '2026-10-05', '2026-10-08'], 3], ['acme#2', ['2026-10-02', '2026-10-08'], 2]]);
  });

  it('says the question one day earlier that repeats is not a repetition (needs two different days)', () => {
    expect(repeatedUnanswered('2026-10-07', [q('acme#1', 'Ship it?', 'Doing')], [])).toEqual([]);
  });
});
