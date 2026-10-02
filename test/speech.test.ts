import { describe, expect, it } from 'vitest';
import { LEAD_S, placeSegment, speechProgressAt, trimRange } from '../src/renderer/src/speech';

describe('trimRange', () => {
  it('cuts the silence at both ends, keeping a margin', () => {
    const samples = new Float32Array(2000);
    samples.fill(0.3, 800, 1200);
    const r = trimRange(samples, 1000)!;
    expect(r.offset).toBeCloseTo(0.75, 3);
    expect(r.duration).toBeCloseTo(0.5, 3);
  });

  it('is null for a silent buffer', () => {
    expect(trimRange(new Float32Array(500), 1000)).toBeNull();
  });

  it('never goes past the buffer', () => {
    const r = trimRange(new Float32Array(100).fill(0.5), 1000)!;
    expect(r.offset).toBe(0);
    expect(r.duration).toBeCloseTo(0.1, 5);
  });
});

describe('placeSegment', () => {
  it('goes right after the previous sentence, with its pause', () => {
    const a = placeSegment(0, 0, 2, 300, 10);
    expect(a.start).toBeCloseTo(LEAD_S);
    expect(a.end).toBeCloseTo(LEAD_S + 2.3);
    const b = placeSegment(a.end, 0.5, 1, 0, 10);
    expect(b.start).toBe(a.end);
  });

  it('starts now when synthesis fell behind the clock', () => {
    expect(placeSegment(2, 5, 1, 0, 10).start).toBeCloseTo(5 + LEAD_S);
  });
});

describe('speechProgressAt', () => {
  const placed = [
    { start: 0, end: 2, weight: 20 },
    { start: 2, end: 6, weight: 60 },
  ];

  it('is weighted by characters over the whole speech', () => {
    expect(speechProgressAt(placed, 100, 0)).toBe(0);
    expect(speechProgressAt(placed, 100, 1)).toBeCloseTo(0.1);
    expect(speechProgressAt(placed, 100, 2)).toBeCloseTo(0.2);
    expect(speechProgressAt(placed, 100, 4)).toBeCloseTo(0.5);
    expect(speechProgressAt(placed, 100, 6)).toBeCloseTo(0.8);
  });

  it('counts sentences still being synthesized: stops short of 1 and does not move back when they arrive', () => {
    const before = speechProgressAt(placed, 100, 9);
    expect(before).toBeCloseTo(0.8);
    const arrived = [...placed, { start: 9, end: 11, weight: 20 }];
    expect(speechProgressAt(arrived, 100, 9)).toBeGreaterThanOrEqual(before);
    expect(speechProgressAt(arrived, 100, 11)).toBe(1);
  });

  it('is monotonic', () => {
    let last = 0;
    for (let t = 0; t <= 7; t += 0.1) {
      const p = speechProgressAt(placed, 100, t);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});
