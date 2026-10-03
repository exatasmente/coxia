// What a run is about when it is not one issue: a release of a version. The shape in the run file, the move that records what the run learns of it, and that an
// issue run is what it always was.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRunStore } from '../src/main/runs-core';
import { WAIT_KINDS } from '../src/shared/config/types';
import { type RunSubject, RunError, RUN_SCHEMA, parseRun, recordSubject, startRun } from '../src/shared/runs';
import { agentFlowStages, at, startInput } from './helpers/runs';

const flow = agentFlowStages();
const subject = (over: Partial<RunSubject> = {}): RunSubject => ({ kind: 'release', version: '0.6.0', from: null, tracking: null, activities: [], ...over });
const release = (over: Partial<RunSubject> = {}) => startRun(startInput({ issue: { ref: 'release:0.6.0', iid: 0, title: 'Release 0.6.0', url: null }, cycleId: 'release-flow', subject: subject(over) }), flow, at(0)).run;

describe('the subject of a run', () => {
  it('is on a release run and nowhere else: an issue run has no such key at all', () => {
    expect(release().subject).toEqual(subject());
    expect('subject' in startRun(startInput(), flow, at(0)).run).toBe(false);
  });

  it('is a copy: changing the input after the start changes nothing of the run', () => {
    const input = subject({ activities: [{ pr: 1, title: 't', url: 'u', head: 'a', state: 'open', approved: false, issue: null }] });
    const run = startRun(startInput({ subject: input }), flow, at(0)).run;
    input.activities.push({ pr: 2, title: 't', url: 'u', head: 'b', state: 'open', approved: false, issue: null });
    expect(run.subject?.activities).toHaveLength(1);
  });

  it('is told where its tracking issue is and what its activities are, without changing the run it came from', () => {
    const run = release();
    const activities = [{ pr: 7, title: 'Add the x', url: 'https://example.test/pull/7', head: 'a'.repeat(40), state: 'merged' as const, approved: true, issue: 12 }];
    const after = recordSubject(run, { tracking: { iid: 200, url: 'https://example.test/issues/200' }, activities }, at(1)).run;
    expect(after.subject).toMatchObject({ version: '0.6.0', tracking: { iid: 200 }, activities });
    expect(run.subject?.tracking).toBeNull();
    expect(after.updatedAt).toBe(at(1));
    expect(recordSubject(after, { tracking: { iid: 200, url: null, closed: true } }, at(2)).run.subject?.tracking).toEqual({ iid: 200, url: null, closed: true });
  });

  it('is refused for a run that has none', () => {
    expect(() => recordSubject(startRun(startInput(), flow, at(0)).run, { activities: [] }, at(1))).toThrow(RunError);
  });
});

describe('the run file of a release', () => {
  it('is read back as it was written, and written back with the next rev, through the store', () => {
    const store = createRunStore(join(mkdtempSync(join(tmpdir(), 'coxia-runs-')), 'runs'));
    const saved = store.create(release());
    expect(store.get(saved.id)?.subject).toEqual(subject());
    const tr = store.update(saved.id, (r) => recordSubject(r, { tracking: { iid: 5, url: null } }, at(1)));
    expect(tr.run.rev).toBe(2);
    expect(store.get(saved.id)?.subject?.tracking).toEqual({ iid: 5, url: null });
    // one at a time, by the synthesized ref, like an issue
    expect(store.activeFor('release:0.6.0')?.id).toBe(saved.id);
    expect(() => store.create({ ...release(), id: 'r-other1-aaaa' })).toThrow(RunError);
  });

  it('refuses a subject that is not what the schema says, with the path of the problem', () => {
    const ok = JSON.parse(JSON.stringify(release()));
    expect(parseRun(ok).ok).toBe(true);
    const bad = (edit: (r: Record<string, any>) => void) => {
      const r = JSON.parse(JSON.stringify(ok));
      edit(r);
      return parseRun(r);
    };
    for (const [name, edit] of [
      ['a version with a leading zero', (r: Record<string, any>) => (r.subject.version = '0.06.0')],
      ['a beta as the version', (r: Record<string, any>) => (r.subject.version = '0.6.0-beta.1')],
      ['another kind', (r: Record<string, any>) => (r.subject.kind = 'issue')],
      ['a tracking issue with no number', (r: Record<string, any>) => (r.subject.tracking = { iid: 0, url: null })],
      ['a field it does not have', (r: Record<string, any>) => (r.subject.path = '/etc')],
      ['an activity in another state', (r: Record<string, any>) => (r.subject.activities = [{ pr: 1, title: 't', url: 'u', head: 'h', state: 'draft', approved: false, issue: null }])],
    ] as const) {
      const r = bad(edit);
      expect(r.ok, name).toBe(false);
      expect(r.ok ? [] : r.errors.join(' '), name).toMatch(/subject/);
    }
    expect(RUN_SCHEMA.properties?.subject).toBeTruthy();
  });

  it('has the two waits a release has among the events a run may wait for', () => {
    expect(WAIT_KINDS).toEqual(expect.arrayContaining(['release-approved', 'beta-age']));
    const run = JSON.parse(JSON.stringify({ ...release(), status: 'waiting', wait: { kind: 'beta-age', minutes: 1440, label: 'beta-blocker', since: at(0) } }));
    expect(parseRun(run).ok).toBe(true);
    run.wait.kind = 'release-approved';
    expect(parseRun(run).ok).toBe(true);
    run.wait.kind = 'whenever';
    expect(parseRun(run).ok).toBe(false);
  });
});
