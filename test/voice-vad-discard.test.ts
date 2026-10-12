// What the recorder tells its screen when it stops by itself: the reason and whether any speech was heard. A hands-free loop drops a recording that heard nothing
// instead of transcribing thirty seconds of silence; the recorder passes `{ reason: step.stop, heard: state.heard }` straight from these steps.
import { describe, expect, it } from 'vitest';
import { VAD_DEFAULTS, type VadState, type VadStop, vadInit, vadStep } from '../src/renderer/src/vad';

const cfg = { ...VAD_DEFAULTS, silenceMs: 600, maxMs: 5000 };

/** Feeds `rmsAt(t)` every 50 ms until the detector stops, the way the recorder's meter does. */
function run(rmsAt: (t: number) => number): { reason: VadStop; heard: boolean; at: number } {
  let state: VadState = vadInit(0);
  for (let t = 0; t <= cfg.maxMs + 100; t += 50) {
    const step = vadStep(state, rmsAt(t), t, cfg);
    state = step.state;
    if (step.stop) return { reason: step.stop, heard: state.heard, at: t };
  }
  throw new Error('never stopped');
}

describe('a recording that stops by itself', () => {
  it('without any speech runs to the limit and says nothing was heard', () => {
    expect(run(() => 0.002)).toEqual({ reason: 'limit', heard: false, at: cfg.maxMs });
  });

  it('with speech stops on the silence after it and says it was heard', () => {
    const r = run((t) => (t >= 500 && t < 1500 ? 0.2 : 0.002));
    expect(r.reason).toBe('silence');
    expect(r.heard).toBe(true);
    expect(r.at).toBeLessThan(cfg.maxMs);
  });

  it('with a noise too short to be speech still counts as nothing heard', () => {
    expect(run((t) => (t === 800 ? 0.3 : 0.002))).toMatchObject({ reason: 'limit', heard: false });
  });
});
