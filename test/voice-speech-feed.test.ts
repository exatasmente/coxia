// The segments of a speech planned as its sentences arrive: in the order of the text even when a later plan answers first, ended once what was pushed is
// planned, and a cancel drops the sentence still being planned. The planner is a fake: no audio, no main process.
import { describe, expect, it } from 'vitest';
import type { SpeechSegment } from '../src/shared/types';
import { createSpeechFeed } from '../src/renderer/src/voice/speechFeed';

const seg = (text: string) => ({ text }) as unknown as SpeechSegment;

function deferredPlanner() {
  const waiting: { text: string; resolve: (s: SpeechSegment[]) => void }[] = [];
  const plan = (text: string) => new Promise<SpeechSegment[]>((resolve) => waiting.push({ text, resolve }));
  return { plan, waiting };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createSpeechFeed', () => {
  it('keeps the segments in the order of the text', async () => {
    const feed = createSpeechFeed(async (text) => text.split(' ').map(seg));
    feed.push('one two');
    feed.push('three');
    feed.end();
    expect((await feed.at(0))?.text).toBe('one');
    expect((await feed.at(2))?.text).toBe('three');
    expect(await feed.at(3)).toBeNull();
    expect(feed.done).toBe(true);
    expect(feed.segments.map((s) => s.text)).toEqual(['one', 'two', 'three']);
  });

  it('plans one sentence at a time, so a slow first sentence still comes first', async () => {
    const p = deferredPlanner();
    const feed = createSpeechFeed(p.plan);
    feed.push('first');
    feed.push('second');
    await flush();
    expect(p.waiting.map((w) => w.text)).toEqual(['first']);
    p.waiting[0].resolve([seg('first')]);
    await flush();
    p.waiting[1].resolve([seg('second')]);
    feed.end();
    await flush();
    expect(feed.segments.map((s) => s.text)).toEqual(['first', 'second']);
  });

  it('ends with no segments when nothing was pushed', async () => {
    const feed = createSpeechFeed(async () => [seg('x')]);
    feed.end();
    expect(await feed.at(0)).toBeNull();
  });

  it('skips a sentence the planner fails on', async () => {
    const feed = createSpeechFeed(async (text) => {
      if (text === 'bad') throw new Error('no');
      return [seg(text)];
    });
    feed.push('bad');
    feed.push('good');
    feed.end();
    expect((await feed.at(0))?.text).toBe('good');
    expect(await feed.at(1)).toBeNull();
  });

  it('drops the sentence still being planned on cancel, and ignores pushes after it', async () => {
    const p = deferredPlanner();
    const feed = createSpeechFeed(p.plan);
    feed.push('first');
    await flush();
    const pending = feed.at(0);
    feed.cancel();
    expect(await pending).toBeNull();
    p.waiting[0].resolve([seg('first')]);
    feed.push('late');
    await flush();
    expect(feed.segments).toEqual([]);
    expect(p.waiting).toHaveLength(1);
  });
});
