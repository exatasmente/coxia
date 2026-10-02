import { describe, expect, it } from 'vitest';
import { VAD_DEFAULTS, levelOf, rmsOf, thresholdFor, vadInit, vadStep, type VadConfig, type VadStop } from '../src/renderer/src/vad';

const STEP = 20;
const cfg: VadConfig = { ...VAD_DEFAULTS };
const NOISE = 0.004;
const SPEECH = 0.12;

interface Segment {
  ms: number;
  rms: number | ((t: number) => number);
}

// Feeds one RMS sample every 20 ms, like the recorder does, and reports the first stop.
function simulate(segments: Segment[], config: VadConfig = cfg) {
  let state = vadInit(0);
  let t = 0;
  for (const seg of segments) {
    const end = t + seg.ms;
    while (t < end) {
      const rms = typeof seg.rms === 'function' ? seg.rms(t) : seg.rms;
      const step = vadStep(state, rms, t, config);
      state = step.state;
      if (step.stop) return { stop: step.stop as VadStop, at: t, state };
      t += STEP;
    }
  }
  return { stop: null, at: t, state };
}

describe('vad: when it does not cut', () => {
  it('does not cut on a long initial silence', () => {
    const r = simulate([{ ms: 20_000, rms: NOISE }]);
    expect(r.stop).toBeNull();
    expect(r.state.heard).toBe(false);
  });

  it('does not cut on a long initial silence and still hears the speech that follows', () => {
    const r = simulate([{ ms: 8000, rms: NOISE }, { ms: 1500, rms: SPEECH }]);
    expect(r.stop).toBeNull();
    expect(r.state.heard).toBe(true);
  });

  it('does not cut on a pause shorter than silenceMs', () => {
    const r = simulate([{ ms: 1500, rms: SPEECH }, { ms: cfg.silenceMs - 100, rms: NOISE }, { ms: 1500, rms: SPEECH }]);
    expect(r.stop).toBeNull();
  });

  it('does not cut on a click shorter than speechMs (it is not speech)', () => {
    const r = simulate([{ ms: 400, rms: NOISE }, { ms: 40, rms: SPEECH }, { ms: 5000, rms: NOISE }]);
    expect(r.stop).toBeNull();
    expect(r.state.heard).toBe(false);
  });

  it('keeps going through a breath that sits between the heard bar and the full threshold', () => {
    const r = simulate([{ ms: 400, rms: NOISE }, { ms: 1500, rms: SPEECH }, { ms: 3000, rms: 0.014 }]);
    // threshold 0.004 * 2 + 0.01 = 0.018; 0.014 is above the heard bar 0.7 * 0.018 = 0.0126: still voice, so the silence timer keeps being reset.
    expect(r.stop).toBeNull();
  });
});

describe('vad: when it cuts', () => {
  it('cuts after silenceMs of silence once the speech was heard', () => {
    const r = simulate([{ ms: 400, rms: NOISE }, { ms: 1500, rms: SPEECH }, { ms: 5000, rms: NOISE }]);
    expect(r.stop).toBe('silence');
    expect(r.at - 1900).toBeGreaterThanOrEqual(cfg.silenceMs - STEP);
    expect(r.at - 1900).toBeLessThanOrEqual(cfg.silenceMs + 2 * STEP);
  });

  it('cuts at the 30 s limit on continuous speech', () => {
    const r = simulate([{ ms: 60_000, rms: SPEECH }]);
    expect(r).toMatchObject({ stop: 'limit', at: 30_000 });
  });

  it('cuts at the 30 s limit even if nobody ever spoke', () => {
    const r = simulate([{ ms: 60_000, rms: NOISE }]);
    expect(r).toMatchObject({ stop: 'limit', at: 30_000 });
  });

  it('uses the configured silence', () => {
    const slow = { ...cfg, silenceMs: 3000 };
    const r = simulate([{ ms: 400, rms: NOISE }, { ms: 1000, rms: SPEECH }, { ms: 10_000, rms: NOISE }], slow);
    expect(r.stop).toBe('silence');
    expect(r.at).toBeGreaterThanOrEqual(1400 + 3000 - STEP);
  });
});

describe('vad: calibration', () => {
  const thresholdAfter = (segments: Segment[]) => simulate(segments, { ...cfg, maxMs: 1000 }).state.threshold;

  it('takes the noise floor from a silent start', () => {
    const t = thresholdAfter([{ ms: 900, rms: 0.01 }]);
    expect(t).toBeCloseTo(thresholdFor(0.01, cfg), 6);
    expect(t).toBeCloseTo(0.03, 6);
  });

  it('keeps the threshold low when speech starts right away but a few samples are quiet', () => {
    // 15 samples in the 300 ms window: 4 quiet ones and 11 of speech. The 20th percentile reads the quiet ones.
    const t = thresholdAfter([{ ms: 80, rms: NOISE }, { ms: 900, rms: SPEECH }]);
    expect(t).toBeCloseTo(thresholdFor(NOISE, cfg), 6);
    expect(t).toBeLessThan(0.02);
  });

  it('caps the threshold when the whole calibration window is speech, and the speech is still heard', () => {
    const r = simulate([{ ms: 2000, rms: SPEECH }]);
    expect(r.state.threshold).toBe(cfg.maxThreshold);
    expect(r.state.heard).toBe(true);
    const cut = simulate([{ ms: 1500, rms: SPEECH }, { ms: 3000, rms: NOISE }]);
    expect(cut.stop).toBe('silence');
  });

  it('never goes below the floor on a silent room', () => {
    expect(thresholdFor(0, cfg)).toBe(cfg.minThreshold);
    expect(thresholdFor(1, cfg)).toBe(cfg.maxThreshold);
  });

  it('does not decide before the calibration window ends', () => {
    const r = simulate([{ ms: cfg.calibrationMs - STEP, rms: NOISE }]);
    expect(r.state.threshold).toBeNull();
  });

  it('does not count speech heard during calibration as a silence to cut', () => {
    const r = simulate([{ ms: 250, rms: SPEECH }, { ms: 2000, rms: SPEECH }]);
    expect(r.stop).toBeNull();
  });
});

describe('vad helpers', () => {
  it('scales the level to 0..1', () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.05)).toBeCloseTo(0.3, 6);
    expect(levelOf(0.5)).toBe(1);
  });

  it('computes the RMS of a buffer', () => {
    expect(rmsOf(new Float32Array([0, 0, 0, 0]))).toBe(0);
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
  });
});
