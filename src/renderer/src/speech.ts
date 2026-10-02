// Timeline of a speech played sentence by sentence. Pure on purpose: audio.ts feeds it decoded durations and the clock.

// Silence the engines leave at both ends is cut, keeping a margin, so the pauses are only the planned ones.
const SILENCE = 0.005;
const MARGIN_S = 0.05;
// Scheduling a hair ahead of the clock avoids a start in the past, which would clip the first samples.
export const LEAD_S = 0.04;

export function trimRange(samples: Float32Array, rate: number): { offset: number; duration: number } | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > SILENCE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  const margin = Math.round(rate * MARGIN_S);
  const from = Math.max(0, first - margin);
  const to = Math.min(samples.length, last + 1 + margin);
  return { offset: from / rate, duration: (to - from) / rate };
}

export interface Placed {
  start: number;
  end: number; // includes the pause after the sentence
  weight: number;
}

// Back to back after the previous sentence; when synthesis fell behind and the clock passed it, starts now.
export function placeSegment(cursor: number, now: number, duration: number, pauseMs: number, weight: number): Placed {
  const start = Math.max(cursor, now + LEAD_S);
  return { start, end: start + duration + pauseMs / 1000, weight };
}

// Progress over the whole speech, weighted by characters: a sentence counts for its length, and the ones still being
// synthesized count too, so the number never jumps back when their real duration arrives.
export function speechProgressAt(placed: Placed[], totalWeight: number, t: number): number {
  if (totalWeight <= 0) return 0;
  let done = 0;
  for (const p of placed) {
    if (t >= p.end) done += p.weight;
    else if (t > p.start) done += (p.weight * (t - p.start)) / (p.end - p.start);
  }
  return Math.min(1, done / totalWeight);
}
