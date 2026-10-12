// The spoken conversation as a state machine: hands-free keeps going until it is ended, talking over the persona is the next request, a muted microphone records
// nothing, a recording without speech is dropped, never transcribed, and a paused session only comes back on resume.
import { describe, expect, it } from 'vitest';
import { type Effect, type LoopEvent, type LoopState, initialLoop, labelOf, loopStep } from '../src/renderer/src/voice/voiceLoop';

function run(events: LoopEvent[], from: LoopState = initialLoop()): { state: LoopState; effects: Effect[] } {
  let state = from;
  const effects: Effect[] = [];
  for (const e of events) {
    const step = loopStep(state, e);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

const turn: LoopEvent[] = [{ type: 'silence', heard: true }, { type: 'transcribed', text: 'what is open' }, { type: 'speechStarted' }, { type: 'answered' }];

describe('loopStep', () => {
  it('answers two requests in a row without a touch, hands-free', () => {
    const { state, effects } = run([{ type: 'start', handsFree: true }, ...turn, ...turn]);
    expect(state.phase).toBe('listening');
    expect(effects.filter((e) => e === 'post')).toHaveLength(2);
    expect(effects.filter((e) => e === 'listen')).toHaveLength(3);
  });

  it('waits for the next press after an answer with push-to-talk', () => {
    expect(run([{ type: 'start', handsFree: false }, ...turn]).state.phase).toBe('idle');
  });

  it('sends what was said when the person presses again', () => {
    const { state, effects } = run([{ type: 'start', handsFree: false }, { type: 'send' }]);
    expect(state.phase).toBe('transcribing');
    expect(effects).toContain('transcribe');
  });

  it('drops a recording that heard no speech and listens again, without transcribing', () => {
    const { state, effects } = run([{ type: 'start', handsFree: true }, { type: 'silence', heard: false }]);
    expect(state.phase).toBe('listening');
    expect(effects).toEqual(['listen', 'discard', 'listen']);
  });

  it('posts nothing for an empty transcription', () => {
    const { state, effects } = run([{ type: 'start', handsFree: true }, { type: 'silence', heard: true }, { type: 'transcribed', text: '  ' }]);
    expect(state.phase).toBe('listening');
    expect(effects).not.toContain('post');
  });

  it('stops the persona and listens when the person talks over it', () => {
    const speaking = run([{ type: 'start', handsFree: true }, ...turn.slice(0, 3)]).state;
    expect(speaking.phase).toBe('speaking');
    expect(loopStep(speaking, { type: 'bargeIn' })).toEqual({ state: { ...speaking, phase: 'listening' }, effects: ['silence', 'listen'] });
  });

  it('records nothing while muted, and talking over the persona does not interrupt it', () => {
    const speaking = run([{ type: 'start', handsFree: true }, ...turn.slice(0, 3), { type: 'mute' }]).state;
    expect(loopStep(speaking, { type: 'bargeIn' }).effects).toEqual([]);
    const after = loopStep(speaking, { type: 'answered' });
    expect(after.state.phase).toBe('idle');
    expect(after.effects).not.toContain('listen');
    expect(loopStep(after.state, { type: 'unmute' }).effects).toEqual(['listen']);
  });

  it('closes the microphone when muted while listening', () => {
    const { state, effects } = run([{ type: 'start', handsFree: true }, { type: 'mute' }]);
    expect(state).toMatchObject({ phase: 'idle', muted: true });
    expect(effects).toEqual(['listen', 'discard']);
    expect(labelOf(state)).toBe('muted');
  });

  it('goes back to listening after a failed transcription, hands-free', () => {
    expect(run([{ type: 'start', handsFree: true }, { type: 'silence', heard: true }, { type: 'failed' }]).state.phase).toBe('listening');
  });

  it('stops hands-free when the microphone itself fails, so it does not retry forever', () => {
    const { state } = run([{ type: 'start', handsFree: true }, { type: 'failed' }]);
    expect(state).toMatchObject({ phase: 'idle', handsFree: false });
  });

  it('leaves a pause only on resume', () => {
    const paused = run([{ type: 'start', handsFree: true }, { type: 'pause' }]);
    expect(paused.state.phase).toBe('paused');
    expect(paused.effects).toEqual(['listen', 'discard', 'silence']);
    for (const e of [{ type: 'silence', heard: true }, { type: 'bargeIn' }, { type: 'start', handsFree: true }, { type: 'answered' }] as LoopEvent[]) {
      expect(loopStep(paused.state, e)).toEqual({ state: paused.state, effects: [] });
    }
    expect(loopStep(paused.state, { type: 'resume' }).state.phase).toBe('listening');
    expect(labelOf(paused.state)).toBe('paused');
  });

  it('ends for good: nothing happens after end', () => {
    const { state, effects } = run([{ type: 'start', handsFree: true }, { type: 'end' }, { type: 'start', handsFree: true }]);
    expect(state.phase).toBe('ended');
    expect(effects).toEqual(['listen', 'discard', 'silence']);
  });

  it('labels the states the visual shows', () => {
    const base = initialLoop();
    expect(labelOf(base)).toBe('ready');
    expect(labelOf({ ...base, phase: 'listening' })).toBe('listening');
    expect(labelOf({ ...base, phase: 'transcribing' })).toBe('thinking');
    expect(labelOf({ ...base, phase: 'thinking' })).toBe('thinking');
    expect(labelOf({ ...base, phase: 'speaking' })).toBe('speaking');
  });
});
