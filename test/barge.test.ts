import { describe, expect, it } from 'vitest';
import { BARGE_DEFAULTS, type BargeConfig, bargeBar, bargeInit, bargeStep } from '../src/renderer/src/barge';

const STEP = 40;
const cfg: BargeConfig = { ...BARGE_DEFAULTS };

interface Phase {
  ms: number;
  mic: number | ((t: number) => number);
  play: number | ((t: number) => number);
}

// Feeds one sample every 40 ms, like the monitor does, and reports when it fires.
function simulate(phases: Phase[], config: BargeConfig = cfg): number | null {
  let state = bargeInit(0);
  let t = 0;
  for (const phase of phases) {
    const end = t + phase.ms;
    while (t < end) {
      const mic = typeof phase.mic === 'function' ? phase.mic(t) : phase.mic;
      const play = typeof phase.play === 'function' ? phase.play(t) : phase.play;
      const step = bargeStep(state, mic, play, t, config);
      state = step.state;
      if (step.fire) return t;
      t += STEP;
    }
  }
  return null;
}

const VOICE = 0.1; // the person talking, at the mic
const AGENT = 0.1; // what the agent plays, digitally
const NOISE = 0.004;

describe('barge-in detection', () => {
  it('stays quiet in a silent room while the agent talks', () => {
    expect(simulate([{ ms: 8000, mic: NOISE, play: AGENT }])).toBeNull();
  });

  it('does not take the agent echo for the person, with or without a canceller', () => {
    expect(simulate([{ ms: 8000, mic: AGENT * 0.1, play: AGENT }])).toBeNull();
    expect(simulate([{ ms: 8000, mic: AGENT * 0.3, play: AGENT }])).toBeNull();
  });

  it('follows the playback: a louder agent raises the bar', () => {
    expect(bargeBar(0.2, cfg)).toBeGreaterThan(bargeBar(0.1, cfg));
    expect(bargeBar(0, cfg)).toBe(cfg.minRms);
    expect(simulate([{ ms: 5000, mic: 0.06, play: 0.3 }])).toBeNull();
  });

  it('fires when the person talks over the agent, after the sustain time', () => {
    const at = simulate([{ ms: 1000, mic: NOISE, play: AGENT }, { ms: 3000, mic: VOICE, play: AGENT }]);
    expect(at).not.toBeNull();
    expect(at! - 1000).toBeGreaterThanOrEqual(cfg.sustainMs - STEP);
    expect(at! - 1000).toBeLessThanOrEqual(cfg.sustainMs + 2 * STEP);
  });

  it('fires over a pause between sentences, where the bar is the floor', () => {
    expect(simulate([{ ms: 1000, mic: NOISE, play: 0 }, { ms: 1000, mic: 0.05, play: 0 }])).not.toBeNull();
  });

  it('ignores a short burst: a cough or a keyboard clack', () => {
    expect(simulate([{ ms: 1000, mic: NOISE, play: AGENT }, { ms: 160, mic: 0.2, play: AGENT }, { ms: 3000, mic: NOISE, play: AGENT }])).toBeNull();
  });

  it('keeps counting through the gaps of speech', () => {
    // 80 ms of voice, 80 ms of gap, repeated: the gaps are under the grace time
    const talk = (t: number) => (Math.floor(t / 80) % 2 === 0 ? VOICE : NOISE);
    expect(simulate([{ ms: 1000, mic: NOISE, play: AGENT }, { ms: 3000, mic: talk, play: AGENT }])).not.toBeNull();
  });

  it('forgets bursts separated by long silences', () => {
    const bursts = (t: number) => (t % 1000 < 200 ? VOICE : NOISE);
    expect(simulate([{ ms: 8000, mic: bursts, play: AGENT }])).toBeNull();
  });

  it('does not fire during the warm-up, even with loud input', () => {
    const at = simulate([{ ms: 3000, mic: VOICE, play: AGENT }]);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(cfg.warmupMs);
  });

  it('holds the bar for a while after the playback gets quieter: the echo arrives late', () => {
    // the agent is loud for 1 s, then quiet; an echo of the loud part still reaches the mic for a moment
    const play = (t: number) => (t < 1000 ? 0.4 : 0.01);
    const mic = (t: number) => (t < 1000 + cfg.historyMs - 2 * STEP ? 0.15 : NOISE);
    expect(simulate([{ ms: 5000, mic, play }])).toBeNull();
  });
});
