import { describe, expect, it, vi } from 'vitest';
import { noticeTarget, parseTarget, targetFromSearch, targetQuery } from '../src/shared/push';
import { targetToScreen } from '../src/renderer/src/pushTarget';
import { boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

// A notification about a run (a gate, a question, a failure, a stage that waits) takes the person to that run, on the desktop and from a phone's push.

describe('a notification about a run opens the run', () => {
  it('says which run in what the desktop does on a click, for a gate and for a failure', async () => {
    const b = await boot();
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    b.engine.script('planner', () => {
      throw new Error('the model is down');
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(b.notices.length).toBeGreaterThanOrEqual(2);
    for (const n of b.notices) expect(n.onClick).toEqual({ type: 'open', screen: { name: 'run', id: run.id } });
  });

  it('becomes the push target of a phone, which opens the run screen', () => {
    const id = 'r-mfxk2a-q7z9';
    const target = noticeTarget({ type: 'open', screen: { name: 'run', id } });
    expect(target).toEqual({ to: 'run', id });
    expect(targetFromSearch(`?${targetQuery(target)}`)).toEqual(target);
    expect(targetToScreen(target, false)).toEqual({ name: 'run', id });
  });

  it('is refused without the run it is about, and the lists open their screens', () => {
    expect(parseTarget({ to: 'run' })).toBeNull();
    expect(noticeTarget({ type: 'open', screen: { name: 'run' } })).toEqual({ to: 'today' });
    expect(targetToScreen({ to: 'runs' }, false)).toEqual({ name: 'runs' });
    expect(targetToScreen({ to: 'forum' }, false)).toEqual({ name: 'forum' });
    expect(targetToScreen({ to: 'forum', id: 'run-r-mfxk2a-q7z9' }, false)).toEqual({ name: 'forum', thread: 'run-r-mfxk2a-q7z9' });
  });
});
