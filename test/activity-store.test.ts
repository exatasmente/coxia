import { describe, expect, it } from 'vitest';
import type { ActivityCall, ActivityEntry } from '../src/shared/activity';
import { tagArgs, takeContext } from '../src/shared/activity';
import { BUCKET_RUNS_MAX, activeRunIds, atBottom, callGroups, createActivityStore, latestStep, mergeEntries, stepText } from '../src/renderer/src/activity';
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

  it('caps each run on its own: a child that floods leaves the lines of its parent', () => {
    const parent = Array.from({ length: 4 }, () => entry({ runId: 'p' }));
    const flood = Array.from({ length: 30 }, () => entry({ runId: 'c', parent: 'p', node: { type: 'sub', label: 'explore: x' } }));
    const list = mergeEntries(mergeEntries([], parent, 5), flood, 5);
    expect(list.filter((e) => e.runId === 'p')).toEqual(parent);
    expect(list.filter((e) => e.runId === 'c')).toEqual(flood.slice(-5));
    // the same when the lines arrive one by one, interleaved
    let live: readonly ActivityEntry[] = [];
    for (let i = 0; i < 12; i++) {
      live = mergeEntries(live, [entry({ runId: 'c', parent: 'p' })], 5);
      if (i < 4) live = mergeEntries(live, [entry({ runId: 'p' })], 5);
    }
    expect(live.filter((e) => e.runId === 'p')).toHaveLength(4);
    expect(live.filter((e) => e.runId === 'c')).toHaveLength(5);
  });

  it('keeps the newest status line of a run even when the cap pushes it past the rest', () => {
    const started = status('started', { runId: 'c' });
    const tools = Array.from({ length: 9 }, () => entry({ runId: 'c' }));
    const list = mergeEntries([], [started, ...tools], 4);
    expect(list).toEqual([started, ...tools.slice(-4)]);
    expect(activeRunIds(list)).toEqual(['c']);
  });

  it('drops the oldest finished trees whole past the bound of runs, and never a tree with a node still going', () => {
    const tree = (id: string, over: 'finished' | 'live') => [
      status('started', { runId: id }),
      status('started', { runId: `${id}.1`, parent: id }),
      status('finished', { runId: `${id}.1`, parent: id }),
      ...(over === 'finished' ? [status('finished', { runId: id })] : []),
    ];
    const old = tree('old', 'finished');
    const live = tree('live', 'live');
    const fresh = tree('fresh', 'finished');
    const list = mergeEntries(mergeEntries([], [...old, ...live], 200, 4), fresh, 200, 4);
    expect([...new Set(list.map((e) => e.runId))].sort()).toEqual(['fresh', 'fresh.1', 'live', 'live.1']);
    expect(BUCKET_RUNS_MAX).toBe(240);
    // a bucket of finished trees only: the oldest go, whole
    const many = Array.from({ length: 5 }, (_, i) => tree(`t${i}`, 'finished')).flat();
    expect([...new Set(mergeEntries([], many, 200, 4).map((e) => e.runId))].sort()).toEqual(['t3', 't3.1', 't4', 't4.1']);
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

  describe('after the stream reconnects', () => {
    it('keeps a run the timeline already holds and a run still going, and drops a finished run it never had', () => {
      const store = createActivityStore();
      store.add(entry({ runId: 'live' }));
      const gap = [
        status('started', { runId: 'old' }),
        status('finished', { runId: 'old' }),
        status('started', { runId: 'fresh' }),
        entry({ runId: 'fresh' }),
        entry({ runId: 'live' }),
      ];
      store.backfillLive('deep:#1:ask', gap);
      expect(store.entries('deep:#1:ask').map((e) => e.runId)).toEqual(['live', 'fresh', 'fresh', 'live']);
    });

    it('keeps nothing when the packet holds only runs the timeline never had, and merges into what is there', () => {
      const store = createActivityStore();
      const gap = [status('started', { runId: 'past' }), status('finished', { runId: 'past' })];
      store.backfillLive('deep:#1:ask', gap);
      expect(store.entries('deep:#1:ask')).toEqual([]);
      const live = status('started', { runId: 'now' });
      store.add(live);
      store.backfillLive('deep:#1:ask', [...gap, entry({ runId: 'past2' }), entry({ runId: 'now' })]);
      // `past2` has no status in the packet or the bucket: a run that is not shown as going is not stitched in
      expect(store.entries('deep:#1:ask').map((e) => e.runId)).toEqual(['now', 'now']);
    });

    it('keeps a sub-agent that began and ended in the gap when its parent is going, and a finished node of a tree it holds', () => {
      const store = createActivityStore();
      const key = 'run:r1';
      store.add(status('started', { runId: 'stage', jobId: key }));
      const gap = [
        status('started', { runId: 'stage', jobId: key }),
        status('started', { runId: 'kid', parent: 'stage', jobId: key, node: { type: 'sub', label: 'explore: x' } }),
        entry({ runId: 'kid', parent: 'stage', jobId: key }),
        status('finished', { runId: 'kid', parent: 'stage', jobId: key }),
        status('started', { runId: 'grand', parent: 'kid', jobId: key }),
        status('finished', { runId: 'grand', parent: 'kid', jobId: key }),
      ];
      store.backfillLive(key, gap);
      expect(new Set(store.entries(key).map((e) => e.runId))).toEqual(new Set(['stage', 'kid', 'grand']));
    });

    it('keeps a finished child of a run the bucket already holds, and does not stitch an old tree in', () => {
      const store = createActivityStore();
      const key = 'run:r1';
      store.add(status('finished', { runId: 'stage', jobId: key }));
      store.backfillLive(key, [
        status('started', { runId: 'late', parent: 'stage', jobId: key }),
        status('finished', { runId: 'late', parent: 'stage', jobId: key }),
        status('started', { runId: 'oldroot', jobId: key }),
        status('finished', { runId: 'oldroot', jobId: key }),
        status('started', { runId: 'oldkid', parent: 'oldroot', jobId: key }),
        status('finished', { runId: 'oldkid', parent: 'oldroot', jobId: key }),
        status('started', { runId: 'orphan', parent: 'missing', jobId: key }),
        status('finished', { runId: 'orphan', parent: 'missing', jobId: key }),
      ]);
      expect(new Set(store.entries(key).map((e) => e.runId))).toEqual(new Set(['stage', 'late']));
    });

    it('survives a loop of parents without hanging', () => {
      const store = createActivityStore();
      store.backfillLive('k', [status('finished', { runId: 'a', parent: 'b', jobId: 'k' }), status('finished', { runId: 'b', parent: 'a', jobId: 'k' })]);
      expect(store.entries('k')).toEqual([]);
    });

    it('a screen opened fresh still gets every entry it asks for', () => {
      const store = createActivityStore();
      const gap = [status('started', { runId: 'old' }), status('finished', { runId: 'old' }), entry({ runId: 'old' })];
      store.backfill('deep:#1:ask', gap);
      expect(store.entries('deep:#1:ask')).toEqual(gap);
    });
  });
});

describe('the words of the newest line', () => {
  it('say the word for a thought and the label for any other line, so no collapsed row prints the reasoning', () => {
    const thought = entry({ kind: 'thought', label: 'the reasoning, which may quote a file' });
    expect(stepText(thought, 'Thought')).toBe('Thought');
    expect(stepText(thought, 'Thought')).not.toContain('reasoning');
    for (const kind of ['tool', 'text', 'answer', 'status'] as const) {
      const e = entry({ kind, label: `a ${kind} line` });
      expect(stepText(e, 'Thought')).toBe(`a ${kind} line`);
    }
    expect(stepText(latestStep([entry(), thought]) as ActivityEntry, 'Thought')).toBe('Thought');
  });
});

describe('running runs and the latest step', () => {
  it('finds the runs without an end and the newest line', () => {
    const live = [status('started', { runId: 'a' }), entry({ runId: 'a' }), status('started', { runId: 'b' }), status('finished', { runId: 'b' })];
    expect(activeRunIds(live)).toEqual(['a']);
    expect(latestStep(live)).toBe(live[3]);
    expect(latestStep([])).toBeNull();
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
