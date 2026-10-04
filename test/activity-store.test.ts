import { describe, expect, it } from 'vitest';
import type { ActivityCall, ActivityEntry } from '../src/shared/activity';
import { tagArgs, takeContext } from '../src/shared/activity';
import { activeRunIds, atBottom, callGroups, createActivityStore, latestStep, mergeEntries, strayActivity } from '../src/renderer/src/activity';
import { createJobStore, currentJob, withJob } from '../src/renderer/src/jobs';

let seq = 0;
const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  seq: ++seq,
  runId: 'r1',
  jobId: 'deep:#1:ask',
  role: 'deep',
  at: 1000 + seq * 10,
  kind: 'tool',
  label: `Read f${seq}`,
  ...over,
});
const status = (state: NonNullable<ActivityEntry['state']>, over: Partial<ActivityEntry> = {}) => entry({ kind: 'status', state, label: state, ...over });

describe('mergeEntries', () => {
  it('appends in order and keeps the same list when nothing is new', () => {
    const a = entry();
    const b = entry();
    const list = mergeEntries([], [a, b]);
    expect(list).toEqual([a, b]);
    expect(mergeEntries(list, [b])).toBe(list);
  });

  it('puts a backfill before what the live feed already delivered, without duplicates', () => {
    const [a, b, c, d] = [entry(), entry(), entry(), entry()];
    const live = mergeEntries([], [c, d]);
    expect(mergeEntries(live, [a, b, c])).toEqual([a, b, c, d]);
  });

  it('keeps only the newest entries past the cap', () => {
    const many = Array.from({ length: 12 }, () => entry());
    const list = mergeEntries([], many, 5);
    expect(list).toEqual(many.slice(-5));
  });

  it('tells two runs apart even when their sequence numbers meet', () => {
    const a = entry({ runId: 'a', seq: 1, at: 5 });
    const b = entry({ runId: 'b', seq: 1, at: 6 });
    expect(mergeEntries([a], [b])).toEqual([a, b]);
  });
});

describe('the activity store', () => {
  it('files entries by job, the unattributed ones under an empty key, and notifies once per change', () => {
    const store = createActivityStore();
    let calls = 0;
    store.subscribe(() => calls++);
    const a = entry();
    store.add(a);
    store.add(a);
    store.add(entry({ jobId: null, runId: 'free' }));
    expect(store.entries('deep:#1:ask')).toEqual([a]);
    expect(store.entries('')).toHaveLength(1);
    expect(store.entries('nothing')).toEqual([]);
    expect(calls).toBe(2);
  });

  it('gives a stable list between changes (what a React snapshot needs)', () => {
    const store = createActivityStore();
    store.add(entry());
    expect(store.entries('deep:#1:ask')).toBe(store.entries('deep:#1:ask'));
    expect(store.snapshot()).toBe(store.snapshot());
  });

  it('bounds a job to its cap', () => {
    const store = createActivityStore({ cap: 3 });
    for (let i = 0; i < 8; i++) store.add(entry());
    expect(store.entries('deep:#1:ask')).toHaveLength(3);
  });

  it('forgets the lines of a job that starts again', () => {
    const store = createActivityStore();
    store.add(entry());
    store.reset('deep:#1:ask');
    expect(store.entries('deep:#1:ask')).toEqual([]);
  });

  it('merges a backfill into what is there', () => {
    const store = createActivityStore();
    const [a, b, c] = [entry(), entry(), entry()];
    store.add(c);
    store.backfill('deep:#1:ask', [a, b, c]);
    expect(store.entries('deep:#1:ask')).toEqual([a, b, c]);
  });

  it('starts a job over when the job store starts one under the same key', () => {
    const store = createActivityStore();
    const registry = createJobStore();
    registry.onStart((job) => store.reset(job.key));
    registry.launch('deep:#1:ask', { label: 'x', screen: null }, async () => 1);
    store.add(entry());
    registry.launch('deep:#1:other', { label: 'y', screen: null }, async () => 2);
    expect(store.entries('deep:#1:ask')).toHaveLength(1);
  });
});

describe('running runs and the latest step', () => {
  it('finds the runs without an end and the newest line', () => {
    const live = [status('started', { runId: 'a' }), entry({ runId: 'a' }), status('started', { runId: 'b' }), status('finished', { runId: 'b' })];
    expect(activeRunIds(live)).toEqual(['a']);
    expect(latestStep(live)).toBe(live[3]);
    expect(latestStep([])).toBeNull();
  });

  it('collects the running runs of the buckets no job owns, oldest line first', () => {
    const store = createActivityStore();
    for (const e of [
      status('started', { jobId: null, runId: 'free' }),
      entry({ jobId: null, runId: 'free', label: 'Read x' }),
      status('started', { jobId: 'prep:#1', runId: 'prep' }),
      status('started', { jobId: 'done', runId: 'old' }),
      status('finished', { jobId: 'done', runId: 'old' }),
      status('started', { jobId: 'deep:#1:ask', runId: 'owned' }),
    ])
      store.add(e);
    const stray = strayActivity(store.snapshot(), new Set(['deep:#1:ask']));
    expect(stray.map((e) => e.runId)).toEqual(['free', 'free', 'prep']);
  });
});

describe('the calls still going', () => {
  const call = (over: Partial<ActivityCall> = {}): ActivityCall => ({ agent: 'dev', thread: 'run-1', message: 3, ...over });

  it('groups the lines per call, oldest first, and offers the newest line of each', () => {
    const started = status('started', { runId: 'c1', at: 100, call: call() });
    const read = entry({ runId: 'c1', at: 110, call: call() });
    const second = status('started', { runId: 'c2', at: 120, call: call({ agent: 'qa', message: 4 }) });
    const groups = callGroups([started, read, second]);
    expect(groups.map((g) => [g.runId, g.agent, g.message, g.entry])).toEqual([
      ['c1', 'dev', 3, read],
      ['c2', 'qa', 4, second],
    ]);
    expect(groups[0].entries).toEqual([started, read]);
    expect(groups[0].since).toBe(100);
  });

  it('keeps a queued call, drops a finished one, and ignores the work of a run', () => {
    const queued = [status('queued', { runId: 'c1', call: call() }), status('started', { runId: 'c1', call: call() })];
    const done = [status('started', { runId: 'c2', call: call({ agent: 'qa' }) }), status('finished', { runId: 'c2', call: call({ agent: 'qa' }) })];
    const stage = [status('started', { runId: 's' }), entry({ runId: 's' })];
    expect(callGroups([...queued, ...done, ...stage]).map((g) => g.runId)).toEqual(['c1']);
  });

  it('tells two calls of the same agent in different messages apart', () => {
    const a = status('started', { runId: 'c1', call: call({ message: 3 }) });
    const b = status('started', { runId: 'c2', call: call({ message: 5 }) });
    expect(callGroups([a, b]).map((g) => [g.runId, g.message])).toEqual([
      ['c1', 3],
      ['c2', 5],
    ]);
  });
});

describe('following the newest line', () => {
  it('is at the bottom within a small slack, and not once the person scrolled up', () => {
    expect(atBottom({ scrollTop: 300, clientHeight: 200, scrollHeight: 500 })).toBe(true);
    expect(atBottom({ scrollTop: 290, clientHeight: 200, scrollHeight: 500 })).toBe(true);
    expect(atBottom({ scrollTop: 100, clientHeight: 200, scrollHeight: 500 })).toBe(false);
    expect(atBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 })).toBe(true);
  });
});

describe('the job a call is made for', () => {
  it('is the running job during its first synchronous stretch and nothing outside it', async () => {
    const registry = createJobStore();
    let seen: unknown[] = [];
    registry.launch('gate:#1:start', { label: 'x', screen: null }, async () => {
      seen = tagArgs(['a'], currentJob());
      await Promise.resolve();
    });
    expect(takeContext(seen)).toEqual({ args: ['a'], jobId: 'gate:#1:start' });
    expect(currentJob()).toBeNull();
    expect(tagArgs(['a'], currentJob())).toEqual(['a']);
  });

  it('nests and restores the outer job', () => {
    withJob('outer', () => {
      withJob('inner', () => expect(currentJob()).toBe('inner'));
      expect(currentJob()).toBe('outer');
    });
    expect(currentJob()).toBeNull();
  });
});
