import { describe, expect, it } from 'vitest';
import { createRecorder } from '../src/main/screen/recorder';
import { RECORDING_CUTS_MAX, RECORDING_KEY_MS, RECORDING_MARKS_MAX, RECORDING_MAX_BYTES, RECORDING_MAX_MS, mediaAtReal, realAtMedia } from '../src/shared/screen';
import { all, child, floatOf, readEbml, uintOf, type EbmlNode } from './helpers/ebml';
import { frameOf, fakeSink } from './helpers/recorderSink';

// The recorder against a fake sink and a clock the test moves: what it feeds and when, what it marks, where it stops, and the file it ends as.

const T0 = 1_000_000;

function setup(chunkBytes = 100, limits = {}) {
  const sink = fakeSink(chunkBytes);
  const rec = createRecorder({ sink, limits });
  return { sink, rec };
}

const durationOf = (bytes: Uint8Array): number => {
  const segment = readEbml(bytes)[1];
  return floatOf(child(child(segment, '1549a966') as EbmlNode, '4489') as EbmlNode);
};

describe('what is fed', () => {
  it('feeds the first frame at time 0, and then only a frame that changed', async () => {
    const { sink, rec } = setup();
    expect(await rec.add(frameOf(1), 'a', T0)).toBe('fed');
    expect(await rec.add(frameOf(1), 'a', T0 + 1000)).toBe('same');
    expect(await rec.add(frameOf(1), 'a', T0 + 2000)).toBe('same');
    expect(await rec.add(frameOf(2), 'b', T0 + 3000)).toBe('fed');
    expect(sink.opened).toEqual([{ width: 8, height: 4 }]);
    expect(sink.fed).toEqual([
      { ts: 0, key: true, width: 8, height: 4 },
      { ts: 3000, key: false, width: 8, height: 4 },
    ]);
  });

  it('takes at most about one frame a second, and the picture it refused is taken when the second has gone', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    expect(await rec.add(frameOf(2), 'b', T0 + 400)).toBe('wait');
    expect(await rec.add(frameOf(2), 'b', T0 + 800)).toBe('wait');
    expect(await rec.add(frameOf(2), 'b', T0 + 1000)).toBe('fed');
    expect(sink.fed.map((f) => f.ts)).toEqual([0, 1000]);
  });

  it('forces a key frame every ten seconds of recorded time, so a seek never decodes more than that', async () => {
    const { sink, rec } = setup();
    for (let i = 0; i < 25; i++) await rec.add(frameOf(i), `h${i}`, T0 + i * 1000);
    const keys = sink.fed.filter((f) => f.key).map((f) => f.ts);
    expect(keys).toEqual([0, RECORDING_KEY_MS, 2 * RECORDING_KEY_MS]);
  });

  it('drops a frame the encoder is too far behind to take, keeps its clock and takes the picture on the next offer', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    sink.behind = 1;
    expect(await rec.add(frameOf(2), 'b', T0 + 1000)).toBe('dropped');
    expect(await rec.add(frameOf(2), 'b', T0 + 2000)).toBe('fed');
    expect(sink.fed.map((f) => f.ts)).toEqual([0, 2000]);
    // The dropped one was a key frame in waiting: the next key frame is still due on time.
    expect(sink.fed[1].key).toBe(false);
  });

  it('starts the video at the first frame that was taken: a dropped first frame does not leave it starting late (#176)', async () => {
    const { sink, rec } = setup();
    sink.behind = 1;
    expect(await rec.add(frameOf(1), 'a', T0)).toBe('dropped');
    expect(await rec.add(frameOf(2), 'b', T0 + 2000)).toBe('fed');
    expect(await rec.add(frameOf(3), 'c', T0 + 3000)).toBe('fed');
    expect(sink.fed.map((f) => f.ts)).toEqual([0, 1000]);
    expect(sink.fed[0].key).toBe(true);
    const out = await rec.finish(T0 + 3500);
    expect(out.ok && out.meta.durationMs).toBe(1500);
  });

  it('ends at a picture of another size than the one the encoder was started with, and keeps what came before', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    expect(await rec.add(frameOf(2, 6, 3), 'b', T0 + 1000)).toBe('stopped');
    expect(sink.fed).toHaveLength(1);
    expect(rec.state).toBe('stopped');
    expect(rec.stoppedBy).toBe('resized');
    // Nothing more is taken, even a picture of the first size.
    expect(await rec.add(frameOf(3), 'c', T0 + 2000)).toBe('stopped');
    const out = await rec.finish(T0 + 5000);
    expect(out.ok && out.meta.durationMs).toBe(1000);
  });
});

describe('the end of the recording', () => {
  it('is a WebM whose duration is the video\'s, a second after the last frame when the stage went on for long without a change', async () => {
    const { rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    await rec.add(frameOf(2), 'b', T0 + 3000);
    const out = await rec.finish(T0 + 600_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.meta).toEqual({ durationMs: 4000, width: 8, height: 4, marks: [], realMs: 600_000, cuts: [{ atMs: 4000, skippedMs: 596_000 }] });
    expect(durationOf(out.bytes)).toBe(4000);
    const clusters = all(readEbml(out.bytes)[1], '1f43b675');
    expect(clusters.map((c) => uintOf(child(c, 'e7') as EbmlNode))).toEqual([0]);
  });

  it('keeps a short still stretch past the last frame as it was, and says nothing was cut', async () => {
    const { rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    const out = await rec.finish(T0 + 3000);
    expect(out.ok && out.meta).toEqual({ durationMs: 3000, width: 8, height: 4, marks: [] });
  });

  it('is finished once: a second call gives the same answer and the encoder is closed once', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    const [a, b] = await Promise.all([rec.finish(T0 + 5000), rec.finish(T0 + 9000)]);
    expect(a).toBe(b);
    expect(sink.closed).toBe(1);
    expect(await rec.add(frameOf(2), 'b', T0 + 6000)).toBe('stopped');
  });

  it('waits for the frame being handed over, and keeps the ones offered before it', async () => {
    const { sink, rec } = setup();
    let release: () => void = () => undefined;
    sink.gate = new Promise((r) => (release = r));
    const first = rec.add(frameOf(1), 'a', T0);
    const ended = rec.finish(T0 + 2500);
    release();
    expect(await first).toBe('fed');
    const out = await ended;
    expect(out.ok && out.meta.durationMs).toBe(2500);
  });

  it('has no file when no frame was ever offered, and says so instead of making an empty video', async () => {
    const { sink, rec } = setup();
    expect(await rec.finish(T0)).toEqual({ ok: false, reason: 'no-frame' });
    expect(sink.opened).toEqual([]);
  });

  it('says the encoder failed when it could not start, when it broke and when it could not flush', async () => {
    const refused = setup();
    refused.sink.refuseOpen = true;
    expect(await refused.rec.add(frameOf(1), 'a', T0)).toBe('stopped');
    expect(refused.rec.state).toBe('stopped');
    expect(await refused.rec.finish(T0 + 1000)).toEqual({ ok: false, reason: 'encoder' });

    const failing = setup();
    await failing.rec.add(frameOf(1), 'a', T0);
    failing.sink.failClose = true;
    expect(await failing.rec.finish(T0 + 1000)).toEqual({ ok: false, reason: 'encoder' });

    // An encoder that breaks halfway stops the recording and keeps what it had.
    const broken = setup();
    await broken.rec.add(frameOf(1), 'a', T0);
    broken.sink.broken = true;
    expect(await broken.rec.add(frameOf(2), 'b', T0 + 2000)).toBe('stopped');
    expect(broken.rec.stoppedBy).toBe('encoder');
    broken.sink.broken = false;
    const out = await broken.rec.finish(T0 + 9000);
    expect(out.ok && out.meta).toMatchObject({ durationMs: 2000, marks: [] });
  });

  it('is dropped without a file by abort, and aborts its encoder', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    rec.abort();
    expect(sink.aborted).toBe(1);
    expect(await rec.add(frameOf(2), 'b', T0 + 2000)).toBe('stopped');
    expect(await rec.finish(T0 + 3000)).toEqual({ ok: false, reason: 'no-frame' });
  });
});

/** A frame of a new picture every second from the start, `seconds` of them: a screen that is changing the whole time. */
async function busy(rec: ReturnType<typeof setup>['rec'], seconds: number): Promise<void> {
  for (let i = 0; i <= seconds; i++) await rec.add(frameOf(i % 200), `b${i}`, T0 + i * 1000);
}

describe('the intervals the person used the screen', () => {
  it('are marked in ms from the start of the recording, in order, at least a second wide', async () => {
    const { rec } = setup();
    await busy(rec, 60);
    rec.mark(T0 + 20_000, T0 + 25_000);
    rec.mark(T0 + 2_000, T0 + 2_000);
    const out = await rec.finish(T0 + 60_000);
    expect(out.ok && out.meta.marks).toEqual([
      { fromMs: 2000, toMs: 3000 },
      { fromMs: 20_000, toMs: 25_000 },
    ]);
  });

  it('are kept inside the video: one that began before the first frame starts at 0, and one after the end is dropped', async () => {
    const { rec } = setup();
    await busy(rec, 10);
    rec.mark(T0 - 5000, T0 + 4000);
    rec.mark(T0 + 90_000, T0 + 95_000);
    rec.mark(T0 + 9_500, T0 + 30_000);
    // Wholly before the first frame there is no video to point to.
    rec.mark(T0 - 9000, T0 - 8000);
    const out = await rec.finish(T0 + 10_500);
    expect(out.ok && out.meta.marks).toEqual([
      { fromMs: 0, toMs: 4000 },
      { fromMs: 9500, toMs: 10_500 },
    ]);
  });

  it('are converted to the video\'s clock when idle stretches were cut, and a mark that fell into one stays at its cut', async () => {
    const { rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    await rec.add(frameOf(2), 'b', T0 + 10_000);
    await rec.add(frameOf(3), 'c', T0 + 11_000);
    await rec.add(frameOf(4), 'd', T0 + 30_000);
    // The stage\'s 10.5 s is 1.5 s into the video; its 20 to 25 s are all in the second stretch that was cut; 40 s is after the end.
    rec.mark(T0 + 10_500, T0 + 10_900);
    rec.mark(T0 + 20_000, T0 + 25_000);
    rec.mark(T0 + 40_000, T0 + 41_000);
    const out = await rec.finish(T0 + 31_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.meta.cuts).toEqual([
      { atMs: 1000, skippedMs: 9000 },
      { atMs: 3000, skippedMs: 18_000 },
    ]);
    expect(out.meta.marks).toEqual([
      { fromMs: 1500, toMs: 2500 },
      { fromMs: 3000, toMs: 4000 },
    ]);
  });

  it('are at most as many as the record holds', async () => {
    const { rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    for (let i = 0; i < RECORDING_MARKS_MAX + 50; i++) rec.mark(T0 + i * 10, T0 + i * 10 + 5);
    const out = await rec.finish(T0 + 100_000);
    expect(out.ok && out.meta.marks).toHaveLength(RECORDING_MARKS_MAX);
  });
});

describe('the limits', () => {
  it('stops at the size limit: nothing more is fed, the recording is marked truncated and ends where it stopped', async () => {
    // A ceiling of 3000 bytes with 1200 kept free and frames of 300: the sixth frame brings it to 1800 of the 1800 allowed, so the seventh stops it.
    const { sink, rec } = setup(300, { bytes: 3000, reserve: 1200 });
    for (let i = 0; i < 6; i++) expect(await rec.add(frameOf(i), `h${i}`, T0 + i * 1000)).toBe('fed');
    expect(rec.state).toBe('on');
    expect(await rec.add(frameOf(7), 'h7', T0 + 6000)).toBe('stopped');
    expect(rec.state).toBe('stopped');
    expect(rec.stoppedBy).toBe('size');
    expect(await rec.add(frameOf(8), 'h8', T0 + 7000)).toBe('stopped');
    expect(sink.fed).toHaveLength(6);
    const out = await rec.finish(T0 + 500_000);
    // The recording ends where it stopped, not where the stage did.
    expect(out.ok && out.meta).toMatchObject({ truncated: 'size', durationMs: 6000 });
    expect(out.ok && out.bytes.length).toBeLessThanOrEqual(3000);
  });

  it('stops at the time limit of the video\'s length, and ends at the limit', async () => {
    const { sink, rec } = setup(100, { ms: 5000 });
    for (let i = 0; i <= 5; i++) expect(await rec.add(frameOf(i), `h${i}`, T0 + i * 1000)).toBe('fed');
    expect(rec.state).toBe('on');
    expect(await rec.add(frameOf(6), 'h6', T0 + 6000)).toBe('stopped');
    expect(rec.stoppedBy).toBe('time');
    expect(sink.fed).toHaveLength(6);
    const out = await rec.finish(T0 + 600_000);
    expect(out.ok && out.meta).toMatchObject({ truncated: 'time', durationMs: 5000 });
  });

  it('does not stop at the time limit for a screen that stays the same, or changes after a long still stretch: the video does not grow', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    await rec.add(frameOf(2), 'b', T0 + 5000);
    expect(await rec.add(frameOf(2), 'b', T0 + RECORDING_MAX_MS + 1000)).toBe('same');
    expect(rec.state).toBe('on');
    // A change after a gap is one second of video, however long the gap.
    expect(await rec.add(frameOf(3), 'c', T0 + 2 * RECORDING_MAX_MS)).toBe('fed');
    expect(rec.state).toBe('on');
    expect(sink.fed.map((f) => f.ts)).toEqual([0, 1000, 2000]);
  });

  it('never makes a file over the ceiling: what the reserve did not cover is cut from the end', async () => {
    // The encoder took more than its reserve while frames were in flight: 10 frames of 200 bytes against a ceiling of 1500 and no reserve.
    const { rec } = setup(200, { bytes: 1500, reserve: 0 });
    for (let i = 0; i < 10; i++) await rec.add(frameOf(i), `h${i}`, T0 + i * 1000);
    expect(rec.state).toBe('stopped');
    const out = await rec.finish(T0 + 20_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.bytes.length).toBeLessThanOrEqual(1500);
    expect(out.meta.truncated).toBe('size');
  });

  it('keeps the ceiling of its own, over the 8 MiB of the other pieces of evidence', () => {
    expect(RECORDING_MAX_BYTES).toBe(24 * 1024 * 1024);
    expect(RECORDING_MAX_MS).toBe(60 * 60 * 1000);
  });
});

// #176: a gap between two fed frames longer than 3 s plays as 1 s, and the cuts say what was left out.
describe('idle stretches', () => {
  it('shorten a gap over 3 s to a second of video and write it down, and keep a gap of 3 s or less as it was', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    await rec.add(frameOf(2), 'b', T0 + 3000);
    await rec.add(frameOf(3), 'c', T0 + 6001);
    expect(sink.fed.map((f) => f.ts)).toEqual([0, 3000, 4000]);
    const out = await rec.finish(T0 + 7001);
    expect(out.ok && out.meta).toEqual({ durationMs: 5000, width: 8, height: 4, marks: [], realMs: 7001, cuts: [{ atMs: 4000, skippedMs: 2001 }] });
    expect(out.ok && durationOf(out.bytes)).toBe(5000);
  });

  it('are measured from the last frame that was fed: pictures that did not change or were not taken move nothing', async () => {
    const { sink, rec } = setup();
    await rec.add(frameOf(1), 'a', T0);
    for (let i = 1; i < 20; i++) expect(await rec.add(frameOf(1), 'a', T0 + i * 1000)).toBe('same');
    sink.behind = 1;
    expect(await rec.add(frameOf(2), 'b', T0 + 20_000)).toBe('dropped');
    expect(await rec.add(frameOf(2), 'b', T0 + 21_000)).toBe('fed');
    expect(sink.fed.map((f) => f.ts)).toEqual([0, 1000]);
    const out = await rec.finish(T0 + 21_500);
    expect(out.ok && out.meta.cuts).toEqual([{ atMs: 1000, skippedMs: 20_000 }]);
  });

  it('are at most as many as the record holds; past that a gap stays as it was and the two clocks still agree', async () => {
    const { sink, rec } = setup();
    for (let i = 0; i < RECORDING_CUTS_MAX + 2; i++) await rec.add(frameOf(i % 200), `g${i}`, T0 + i * 10_000);
    const lastReal = (RECORDING_CUTS_MAX + 1) * 10_000;
    // 500 gaps of 10 s are 1 s each; the 501st is kept whole.
    expect(sink.fed[RECORDING_CUTS_MAX].ts).toBe(RECORDING_CUTS_MAX * 1000);
    expect(sink.fed[RECORDING_CUTS_MAX + 1].ts).toBe(RECORDING_CUTS_MAX * 1000 + 10_000);
    const out = await rec.finish(T0 + lastReal + 20_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.meta.cuts).toHaveLength(RECORDING_CUTS_MAX);
    // The tail is not cut either: the video ends where the stage did.
    expect(out.meta.durationMs).toBe(sink.fed[RECORDING_CUTS_MAX + 1].ts + 20_000);
    expect(out.meta.realMs).toBe(lastReal + 20_000);
    expect(realAtMedia(out.meta.cuts, sink.fed[RECORDING_CUTS_MAX + 1].ts)).toBe(lastReal);
  });

  it('are not left past the end of a video whose end the size ceiling took', async () => {
    const { rec } = setup(200, { bytes: 1500, reserve: 0 });
    for (let i = 0; i < 10; i++) await rec.add(frameOf(i), `h${i}`, T0 + i * 10_000);
    const out = await rec.finish(T0 + 200_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.meta.truncated).toBe('size');
    const cuts = out.meta.cuts ?? [];
    expect(cuts.length).toBeGreaterThan(0);
    for (const c of cuts) expect(c.atMs).toBeLessThanOrEqual(out.meta.durationMs);
    expect(out.meta.realMs).toBe(out.meta.durationMs + cuts.reduce((n, c) => n + c.skippedMs, 0));
  });

  it('map between the stage\'s time and the video\'s both ways', () => {
    const cuts = [
      { atMs: 1000, skippedMs: 9000 },
      { atMs: 3000, skippedMs: 18_000 },
    ];
    expect(realAtMedia(cuts, 500)).toBe(500);
    expect(realAtMedia(cuts, 1000)).toBe(10_000);
    expect(realAtMedia(cuts, 2500)).toBe(11_500);
    expect(realAtMedia(cuts, 4000)).toBe(31_000);
    expect(mediaAtReal(cuts, 500)).toBe(500);
    expect(mediaAtReal(cuts, 5000)).toBe(1000);
    expect(mediaAtReal(cuts, 10_500)).toBe(1500);
    expect(mediaAtReal(cuts, 20_000)).toBe(3000);
    expect(mediaAtReal(cuts, 31_000)).toBe(4000);
    // Outside the cuts the two are inverses.
    for (const media of [0, 400, 1000, 1700, 2999, 3000, 3600, 9000]) expect(mediaAtReal(cuts, realAtMedia(cuts, media))).toBe(media);
    expect(realAtMedia(undefined, 700)).toBe(700);
    expect(mediaAtReal([], 700)).toBe(700);
  });
});
