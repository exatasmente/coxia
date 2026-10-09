import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Language } from '../src/shared/config/types';
import { answer, ask, gateApprove, stageDone, type Run, type StartInput } from '../src/shared/runs';
import { createRunStore } from '../src/main/runs-core';
import {
  ACTIVITIES_VERSION,
  STALE_AFTER_MS,
  activitiesPath,
  claimFront,
  compactLine,
  createSharedMemory,
  emptyIndex,
  frontOfActivity,
  readIndex,
  refsNamed,
  renderFronts,
  selectFronts,
  sortedFronts,
  writeIndex,
  type ActivityIndex,
} from '../src/main/runner/activities';
import { at, drive, startInput } from './helpers/runs';

// The record of the activities: one front per reference, projected from the state the run store keeps, cut for the text of a call and correctable by the
// person. Nothing here touches a model, a code host or the network: the record is a file of a folder of the test's own.

const LANG: Language = 'en';

const dir = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-activities-'));

/** A run driven through the moves of the agent cycle, as it stands at the end. */
function played(moves: (d: ReturnType<typeof drive>) => void, input: Partial<StartInput> = {}): Run {
  const d = drive(undefined, startInput(input));
  moves(d);
  return d.run;
}

/** Its first stage done, which is what makes the front say where the work is. */
const finished = (d: ReturnType<typeof drive>): void => void d.do((r, a) => stageDone(r, d.flow, { summary: 'work done', handoff: 'review it', artifacts: [] }, a));

const withStore = (d: string) => createRunStore(join(d, 'runs'));

describe('the front of an activity', () => {
  it('is one per reference: a second execution of the same activity updates the same front', () => {
    const memory = createSharedMemory(dir());
    const first = played(() => undefined);
    const again = played(() => undefined, { id: 'r-fgh789-x9y8' });
    memory.upsert(null, first, LANG);
    memory.upsert(null, again, LANG);
    const read = memory.read(withStore(dir()), LANG);
    expect(first.issue.ref).toBe(again.issue.ref);
    expect(Object.keys(read.fronts)).toEqual([first.issue.ref]);
    expect(read.fronts[first.issue.ref].runId).toBe(again.id);
  });

  it('says stage, agent, open question, last handoff, where it stopped and the instant', () => {
    const run = played((d) => {
      d.do((r, a) => ask(r, { by: 'qa', text: 'Is the fixture real?' }, a));
    });
    const front = frontOfActivity(run, undefined, LANG);
    expect(front.ref).toBe('app#101');
    expect(front.title).toBe('Add the thing');
    expect(front.stage?.label).toBeTruthy();
    expect(front.stage?.since).toBe(run.updatedAt);
    expect(front.openQuestions).toEqual(['Is the fixture real?']);
    expect(front.updatedAt).toBe(run.updatedAt);
  });

  it('leaves the mark of the stage done, and keeps the last thing said to the activity with its text', () => {
    const front = frontOfActivity(played(finished), undefined, LANG);
    expect(front.stage?.since).toBeTruthy();
    const answered = played((d) => {
      d.do((r, a) => ask(r, { by: 'qa', text: 'Which fixture?' }, a));
      d.do((r, a) => answer(r, d.flow, 'The real one.', a));
    });
    expect(frontOfActivity(answered, undefined, LANG).lastHandoff?.text).toBe('The real one.');
  });

  it('keeps the gate decision and where a run that ended stopped', () => {
    const run = played((d) => {
      d.do((r, a) => stageDone(r, d.flow, { summary: 'work', handoff: '', artifacts: [] }, a));
      d.do((r, a) => gateApprove(r, d.flow, a, 'looks right'));
    });
    const front = frontOfActivity(run, undefined, LANG);
    expect(front.decisions).toContain('looks right');
    expect(front.stage?.id).toBe(run.stage);
  });

  it('does not present an old front as work of now, and never drops it', () => {
    const front = { ...frontOfActivity(played(finished), undefined, LANG), updatedAt: new Date(Date.parse(at(0)) - STALE_AFTER_MS - 86_400_000).toISOString() };
    const text = renderFronts([front], { language: LANG, now: at(0) });
    expect(text).toContain(front.ref);
    expect(text).toContain('probably finished');
    expect(sortedFronts({ version: ACTIVITIES_VERSION, fronts: { [front.ref]: front }, agents: {} })).toHaveLength(1);
  });
});

describe('the file of the record', () => {
  it('round-trips through the file, and a file written by a newer app is refused and never overwritten', () => {
    const d = dir();
    const index: ActivityIndex = { version: ACTIVITIES_VERSION, fronts: { 'app#101': frontOfActivity(played(finished), undefined, LANG) }, agents: {} };
    writeIndex(d, index);
    expect(readIndex(d)?.fronts['app#101'].ref).toBe('app#101');
    writeIndex(d, { ...index, version: ACTIVITIES_VERSION + 1 } as ActivityIndex);
    expect(readIndex(d)).toBeNull();
    expect((JSON.parse(readFileSync(activitiesPath(d), 'utf8')) as { version: number }).version).toBe(ACTIVITIES_VERSION + 1);
  });

  it('rebuilds a lost front from the store of runs, and keeps a record of an activity that no run ever had', () => {
    const d = dir();
    const store = withStore(d);
    store.create(played(finished));
    expect(claimFront(emptyIndex(), store, 'app#101', LANG)?.stage).toBeTruthy();
    expect(claimFront(emptyIndex(), store, 'app#202', LANG)).toBeNull();
    const memory = createSharedMemory(d);
    memory.ensure({ ref: 'app#202', iid: 202, title: 'Never started', url: null }, at(1));
    const bare = memory.read(store, LANG).fronts['app#202'];
    expect(bare.bare).toBe(true);
    expect(bare.runId).toBeNull();
    expect(memory.read(store, LANG).fronts['app#202'].title).toBe('Never started');
  });
});

describe('what a call is told', () => {
  it('selects by the activity named and by the agent named, and falls back to what is in progress', () => {
    const index = emptyIndex();
    index.fronts['app#101'] = frontOfActivity(played(finished), undefined, LANG);
    expect(refsNamed(index, ['101'])).toEqual(['app#101']);
    expect(refsNamed(index, ['app#101'])).toEqual(['app#101']);
    expect(selectFronts(index, { refs: ['101'] })).toHaveLength(1);
    expect(selectFronts(index, { agents: [index.fronts['app#101'].lastAgent ?? ''] }).length).toBeGreaterThan(0);
    // Nothing named: the activity is in progress, so the compact list carries it, and naming another one opens nothing.
    expect(selectFronts(index, {})).toHaveLength(1);
    expect(selectFronts(index, { refs: ['999'] })).toHaveLength(1);
  });

  it('bounds the text of one call: what does not fit is named, never cut in the middle', () => {
    const front = { ...frontOfActivity(played(finished), undefined, LANG), decisions: Array.from({ length: 200 }, (_, i) => `decision ${i} ${'x'.repeat(200)}`) };
    const text = renderFronts(
      Array.from({ length: 10 }, (_, i) => ({ ...front, ref: `app#${i}` })),
      { language: LANG, now: at(0) },
    );
    expect(text.length).toBeLessThan(4000);
    expect(text).toContain('did not fit');
    expect(text).not.toContain('xxx…');
  });

  it('says one line per activity in progress when nothing was named', () => {
    const line = compactLine(frontOfActivity(played(() => undefined), undefined, LANG));
    expect(line.startsWith('- app#101')).toBe(true);
    expect(line).toContain('Add the thing');
  });
});

describe('the person corrects it', () => {
  it('keeps what the person wrote until the next move, and marks the record as theirs', () => {
    const d = dir();
    const store = withStore(d);
    const run = played(finished);
    store.create(run);
    const memory = createSharedMemory(d);
    memory.upsert(null, run, LANG);
    const corrected = memory.correct('app#101', 'Waiting on the fixtures, per the person.', store, LANG);
    expect(corrected?.source).toBe('person');
    expect(memory.read(store, LANG).fronts['app#101'].correction).toEqual(['Waiting on the fixtures, per the person.']);
    expect(frontOfActivity(run, memory.read(store, LANG).fronts['app#101'], LANG).correction).toHaveLength(1);
    expect(memory.correct('app#404', 'nope', store, LANG)).toBeNull();
  });

  it('does not refuse the correction while a stage works: the record is not in any worktree', () => {
    const d = dir();
    const memory = createSharedMemory(d);
    memory.ensure({ ref: 'app#101', iid: 101, title: 'Add the thing', url: null }, at(0));
    expect(memory.correct('app#101', 'still working', withStore(d), LANG)?.source).toBe('person');
    expect(activitiesPath(d)).toBe(join(d, 'memory', 'activities.json'));
  });
});

describe('the shape of the file', () => {
  it('is stable and deterministic: the same index written twice is the same text, and it is masked before it lands', () => {
    const d = dir();
    const withSecret = played((x) => x.do((r, a) => ask(r, { by: 'qa', text: 'the key is AKIAIOSFODNN7EXAMPLE' }, a)));
    const memory = createSharedMemory(d);
    memory.upsert(null, withSecret, LANG);
    const first = readFileSync(activitiesPath(d), 'utf8');
    memory.upsert(null, withSecret, LANG);
    const second = readFileSync(activitiesPath(d), 'utf8');
    expect(second).toBe(first);
    // The text that came from outside goes through the same masking as the other files the app writes.
    expect(first).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});

describe('the moves of a run', () => {
  it('keeps the front of every activity apart: two activities are two keys, and one move does not touch the other', () => {
    const d = dir();
    const memory = createSharedMemory(d);
    const one = played(() => undefined);
    const two = played(() => undefined, { id: 'r-def456-x2y3', issue: { ref: 'app#202', iid: 202, title: 'Add the other thing', url: null } });
    memory.upsert(null, one, LANG);
    memory.upsert(null, two, LANG);
    const moved = { ...one, updatedAt: at(5), status: 'question' as const, question: { by: 'qa', text: 'which one?', askedAt: at(5), stage: one.stage, kind: 'agent' as const, holder: null } };
    memory.upsert(one, moved, LANG);
    const read = memory.read(withStore(d), LANG);
    expect(Object.keys(read.fronts).sort()).toEqual(['app#101', 'app#202']);
    expect(read.fronts['app#101'].openQuestions).toEqual(['which one?']);
    expect(read.fronts['app#202'].openQuestions).toEqual([]);
  });
});
