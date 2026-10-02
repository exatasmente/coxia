import { describe, expect, it } from 'vitest';
import { type MinutesVersion, dayMinutes, diffVersions, mergeDay, previousOf, snapshotOf, versionFile } from '../src/shared/minutesVersions';
import { NO_SELF_WRITES, diffSeen, orderAgenda, seenOf } from '../src/shared/sameDay';
import { card, ceremony, turn } from './helpers/ceremony';

const dec = (ref: string, text: string, target: 'spec' | 'ata' = 'ata') => ({ ref, text, target, dest: `dest ${ref}` });
const covered = (ref: string, status: 'new' | 'unchanged' | 'changed' = 'new') => ({ ref, iid: ref.split('#')[1], title: `Activity ${ref}`, status, url: '', stage: null, blockers: [], changes: [] });

function version(n: number, snapshot: Partial<MinutesVersion['snapshot']>): MinutesVersion {
  return { n, ceremonyId: `2026-10-02T0${n}0000`, startedAt: n, endedAt: n + 1, savedAt: null, file: null, teams: null, written: [], snapshot: { decisions: [], effects: [], unanswered: [], covered: [], ...snapshot } };
}

describe('snapshotOf', () => {
  it('lists the unanswered questions and the activities the call covered, with how they were covered', () => {
    const a = card('acme#1');
    const b = card('acme#2');
    const c = card('acme#3');
    const s = ceremony({
      id: '2026-10-02T094000',
      cards: [a, b, c],
      turns: { 'acme#1': turn('acme#1', { question: 'Ship it?' }), 'acme#2': turn('acme#2', { sameDay: { kind: 'unchanged', since: '2026-10-02T09:40:00.000Z', version: 1, changes: [], decided: [] } }), 'acme#3': turn('acme#3') },
      spoken: ['acme#1', 'acme#2'],
    });
    const snap = snapshotOf(s);
    expect(snap.unanswered).toEqual([{ ref: 'acme#1', question: 'Ship it?' }, ...(s.turns['acme#3'].question ? [] : [])]);
    expect(snap.covered.map((x) => [x.ref, x.status])).toEqual([['acme#1', 'new'], ['acme#2', 'unchanged']]);
  });
});

describe('diffVersions', () => {
  const v1 = version(1, {
    decisions: [dec('acme#1', 'Merge today'), dec('acme#2', 'Wait for Bruno')],
    effects: [{ ref: 'acme#1', text: 'Open the MR', repo: 'app' }],
    unanswered: [{ ref: 'acme#3', question: 'Which branch?' }],
    covered: [covered('acme#1'), covered('acme#2'), covered('acme#3')],
  });

  it('says there is nothing to compare for the first version of the day', () => {
    const d = diffVersions(null, v1.snapshot);
    expect(d.base).toBeNull();
    expect(d.decisionsAdded).toHaveLength(2);
  });

  it('separates decisions that are new from decisions that changed, and ignores the ones that repeat', () => {
    const d = diffVersions(v1, {
      decisions: [dec('acme#1', 'merge   TODAY'), dec('acme#2', 'Ship it now'), dec('acme#4', 'Close it')],
      effects: [{ ref: 'acme#1', text: 'Open the MR', repo: 'app' }, { ref: 'acme#2', text: 'Comment on the MR', repo: 'app' }],
      unanswered: [{ ref: 'acme#5', question: 'Who reviews?' }],
      covered: [covered('acme#1', 'unchanged'), covered('acme#2', 'changed'), covered('acme#3', 'changed'), covered('acme#4')],
    });
    expect(d.base).toBe(1);
    expect(d.decisionsAdded.map((x) => x.ref)).toEqual(['acme#4']);
    expect(d.decisionsChanged).toEqual([{ ref: 'acme#2', before: [dec('acme#2', 'Wait for Bruno')], after: [dec('acme#2', 'Ship it now')] }]);
    expect(d.effectsAdded.map((e) => e.text)).toEqual(['Comment on the MR']);
    // acme#3 was covered again and no longer has the question; acme#5 is a new one.
    expect(d.questionsResolved).toEqual([{ ref: 'acme#3', question: 'Which branch?' }]);
    expect(d.questionsNew).toEqual([{ ref: 'acme#5', question: 'Who reviews?' }]);
    expect(d.activitiesNew.map((c) => c.ref)).toEqual(['acme#4']);
    expect(d.activitiesUnchanged.map((c) => c.ref)).toEqual(['acme#1']);
    expect(d.activitiesChanged.map((c) => c.ref)).toEqual(['acme#2', 'acme#3']);
    expect(d.empty).toBe(false);
  });

  it('keeps a question open when its activity was not covered again, and is empty when nothing happened', () => {
    const same = diffVersions(v1, { ...v1.snapshot, covered: [] });
    expect(same.questionsResolved).toEqual([]);
    expect(diffVersions(v1, { decisions: [], effects: [], unanswered: [{ ref: 'acme#3', question: 'Which branch?' }], covered: [] }).empty).toBe(true);
  });
});

describe('previousOf', () => {
  it('takes the closest earlier version that still exists, so a deleted one leaves a gap and not a renumbering', () => {
    const vs = [version(1, {}), version(3, {}), version(4, {})];
    expect(previousOf(vs, 4)?.n).toBe(3);
    expect(previousOf(vs, 3)?.n).toBe(1);
    expect(previousOf(vs, 1)).toBeNull();
  });
});

describe('mergeDay', () => {
  it('lets the latest version win for each activity and keeps what it replaced apart', () => {
    const merged = mergeDay([
      version(2, { decisions: [dec('acme#1', 'Ship it now'), dec('acme#4', 'Close it')], covered: [covered('acme#1', 'changed')] }),
      version(1, { decisions: [dec('acme#1', 'Merge today'), dec('acme#2', 'Wait for Bruno')], covered: [covered('acme#1'), covered('acme#2')] }),
    ]);
    expect(merged.versions).toEqual([1, 2]);
    expect(merged.decisions.map((d) => [d.ref, d.text, d.version])).toEqual([['acme#1', 'Ship it now', 2], ['acme#2', 'Wait for Bruno', 1], ['acme#4', 'Close it', 2]]);
    expect(merged.superseded.map((d) => [d.text, d.version])).toEqual([['Merge today', 1]]);
    expect(merged.startedAt).toBe(1);
    expect(merged.endedAt).toBe(3);
  });

  it('counts an effect once, carries a question until a later version covers the activity without it', () => {
    const merged = mergeDay([
      version(1, { effects: [{ ref: 'acme#1', text: 'Open the MR', repo: 'app' }], unanswered: [{ ref: 'acme#1', question: 'Ship?' }, { ref: 'acme#2', question: 'Who?' }], covered: [covered('acme#1'), covered('acme#2')] }),
      version(2, { effects: [{ ref: 'acme#1', text: 'Open the MR', repo: 'app' }], covered: [covered('acme#1', 'changed')] }),
    ]);
    expect(merged.effects).toHaveLength(1);
    expect(merged.unanswered).toEqual([{ ref: 'acme#2', question: 'Who?', version: 1 }]);
    const minutes = dayMinutes(merged);
    expect(minutes.decisions).toEqual([]);
    expect(minutes.unanswered).toEqual([{ ref: 'acme#2', question: 'Who?' }]);
  });
});

describe('file names', () => {
  it('names the version file after the day and the number', () => {
    expect(versionFile('2026-10-02', 2)).toBe('2026-10-02-pre-daily.v2.md');
  });
});

describe('diffSeen', () => {
  const before = seenOf(card('acme#1', { stage: 'Doing', blockers: ['app!7: MR with conflicts'], pending: ['pipeline red'], mrs: ['app!7'], changes: ['stage: Todo → Doing'], note: null, spec: { folder: '/specs/acme', phase: 'Plan written', planFile: null } }), 'fp1', [{ path: 'bug/2_PLAN.md', mtime: 1000.7 }], '2026-10-02T10:05:00.000Z');

  it('finds nothing when the card is as the earlier meeting saw it, and ignores a history entry that rolled out of the window', () => {
    const now = { ...before, at: '2026-10-02T14:00:00.000Z', changes: [] };
    expect(diffSeen(before, now)).toEqual([]);
  });

  it('lists what moved: stage, phase, blockers, pending items, merge requests, new movement, note and spec files', () => {
    const now = seenOf(
      card('acme#1', { stage: 'Code Review', blockers: [], pending: ['pipeline red', 'needs approval'], mrs: ['app!7', 'app!8'], changes: ['stage: Todo → Doing', 'stage: Doing → Code Review'], note: 'Bruno will review', spec: { folder: '/specs/acme', phase: 'Tests planned', planFile: null } }),
      'fp2',
      [{ path: 'bug/2_PLAN.md', mtime: 2000 }, { path: 'bug/3_TEST_PLAN.md', mtime: 5 }],
      '2026-10-02T14:00:00.000Z',
    );
    expect(diffSeen(before, now).map((c) => c.kind)).toEqual(['stage', 'phase', 'blocker-removed', 'pending-added', 'mr-added', 'change', 'note', 'files']);
  });

  it('does not count what the app wrote itself after the earlier meeting', () => {
    const now = seenOf(card('acme#1', { blockers: before.blockers, pending: before.pending, mrs: before.mrs, changes: before.changes, note: '2026-10-02: Merge today', spec: { folder: '/specs/acme', phase: 'Plan written', planFile: null } }), 'fp2', [{ path: 'bug/2_PLAN.md', mtime: 2000 }], '2026-10-02T14:00:00.000Z');
    expect(diffSeen(before, now).map((c) => c.kind)).toEqual(['note', 'files']);
    expect(diffSeen(before, now, { files: { '/specs/acme/bug/2_PLAN.md': 2000 }, notes: { 'acme#1': '2026-10-02: Merge today' } }, '/specs/acme')).toEqual([]);
    // A later edit of the same file moves its time again, and that is news.
    expect(diffSeen(before, now, { files: { '/specs/acme/bug/2_PLAN.md': 1999 }, notes: {} }, '/specs/acme').map((c) => c.kind)).toContain('files');
    expect(NO_SELF_WRITES.files).toEqual({});
  });
});

describe('orderAgenda', () => {
  const cards = [card('acme#1'), card('acme#2', { blockers: ['stuck'] }), card('acme#3'), card('acme#4')];

  it('puts what changed or is blocked first, what nothing happened to last, and keeps the rest of the order', () => {
    const ordered = orderAgenda(cards, { 'acme#1': { kind: 'unchanged' }, 'acme#2': { kind: 'unchanged' }, 'acme#3': { kind: 'changed' }, 'acme#4': { kind: 'new' } });
    expect(ordered.map((c) => c.ref)).toEqual(['acme#2', 'acme#3', 'acme#4', 'acme#1']);
  });

  it('leaves the order alone when nothing was covered before', () => {
    expect(orderAgenda(cards, {}).map((c) => c.ref)).toEqual(cards.map((c) => c.ref));
  });
});
