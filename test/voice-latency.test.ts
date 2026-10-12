// The delay of a spoken turn, step by step: the marks become durations, and a missing mark leaves its step empty instead of a NaN.
import { describe, expect, it } from 'vitest';
import { latencyLine, turnLatency } from '../src/renderer/src/voice/latency';

describe('turnLatency', () => {
  it('turns the marks into the duration of each step and the total', () => {
    const l = turnLatency({ speechEnd: 1000, transcribed: 1800.4, posted: 1850, firstText: 2600, firstAudio: 3100 });
    expect(l).toEqual({ transcribe: 800, post: 50, firstText: 750, firstAudio: 500, total: 2100 });
    expect(latencyLine(l)).toBe('voice turn latency ms: total=2100 transcribe=800 post=50 firstText=750 firstAudio=500');
  });

  it('leaves a step without its marks empty, never NaN', () => {
    const l = turnLatency({ speechEnd: 1000, firstAudio: 2500 });
    expect(l).toEqual({ transcribe: null, post: null, firstText: null, firstAudio: null, total: 1500 });
    expect(latencyLine(l)).not.toContain('NaN');
    expect(turnLatency({ speechEnd: Number.NaN, firstAudio: 10 }).total).toBeNull();
  });

  it('never gives a negative step', () => {
    expect(turnLatency({ speechEnd: 500, transcribed: 400 }).transcribe).toBe(0);
  });
});
