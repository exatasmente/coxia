// The spoken conversation with the persona as a state machine: listen, transcribe, send, wait, speak, and (hands-free) listen again. Pure on purpose: the hook
// (useVoiceSession) turns each effect into the recorder, the transcription, the post and the player, and feeds back what happened.

export type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'paused' | 'ended';

export interface LoopState {
  phase: Phase;
  /** Listen again after each answer, until the person ends it. */
  handsFree: boolean;
  /** The microphone is muted: nothing is recorded and talking over the persona does not interrupt it. */
  muted: boolean;
}

export type LoopEvent =
  | { type: 'start'; handsFree: boolean }
  | { type: 'silence'; heard: boolean }
  | { type: 'send' }
  | { type: 'transcribed'; text: string }
  | { type: 'failed' }
  | { type: 'speechStarted' }
  | { type: 'answered' }
  | { type: 'bargeIn' }
  /** A tap that silences the persona (iOS has no barge-in): with the microphone open it listens to the next request. */
  | { type: 'interrupt' }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'pause' }
  | { type: 'resume' }
  /** Back to idle (the chat's hands-free turned off): the session can start again. */
  | { type: 'stop' }
  /** Voice mode ended: nothing happens after it. */
  | { type: 'end' };

/** What the hook does for a step: open the microphone, drop or transcribe the recording, send the text, silence the persona. */
export type Effect = 'listen' | 'discard' | 'transcribe' | 'post' | 'silence';

export interface Step {
  state: LoopState;
  effects: Effect[];
}

export const initialLoop = (): LoopState => ({ phase: 'idle', handsFree: false, muted: false });

const to = (state: LoopState, phase: Phase, ...effects: Effect[]): Step => ({ state: { ...state, phase }, effects });

// After a turn (answered, nothing said, a failure): hands-free listens again, push-to-talk waits for the next press.
const again = (state: LoopState, ...effects: Effect[]): Step =>
  state.handsFree && !state.muted ? to(state, 'listening', ...effects, 'listen') : to(state, 'idle', ...effects);

export function loopStep(state: LoopState, event: LoopEvent): Step {
  if (state.phase === 'ended') return { state, effects: [] };
  if (event.type === 'end') return to(state, 'ended', ...recordingOff(state), 'silence');
  if (event.type === 'stop') return to({ ...state, handsFree: false }, 'idle', ...recordingOff(state), 'silence');
  if (state.phase === 'paused') {
    if (event.type === 'resume') return again(state);
    if (event.type === 'mute' || event.type === 'unmute') return { state: { ...state, muted: event.type === 'mute' }, effects: [] };
    return { state, effects: [] };
  }
  switch (event.type) {
    case 'start': {
      const next = { ...state, handsFree: event.handsFree };
      if (state.phase !== 'idle') return { state: next, effects: [] };
      return next.muted ? to(next, 'idle') : to(next, 'listening', 'listen');
    }
    case 'silence':
      if (state.phase !== 'listening') return { state, effects: [] };
      // a recording that heard no speech is dropped, never transcribed
      return event.heard ? to(state, 'transcribing', 'transcribe') : again(state, 'discard');
    case 'send':
      return state.phase === 'listening' ? to(state, 'transcribing', 'transcribe') : { state, effects: [] };
    case 'transcribed':
      if (state.phase !== 'transcribing') return { state, effects: [] };
      return event.text.trim() ? to(state, 'thinking', 'post') : again(state);
    case 'failed':
      if (state.phase === 'listening') return again({ ...state, handsFree: false }, 'discard');
      return state.phase === 'transcribing' || state.phase === 'thinking' ? again(state) : { state, effects: [] };
    case 'speechStarted':
      return state.phase === 'thinking' ? to(state, 'speaking') : { state, effects: [] };
    case 'answered':
      return state.phase === 'thinking' || state.phase === 'speaking' ? again(state) : { state, effects: [] };
    case 'bargeIn':
      // talking over the persona stops it and is heard as the next request
      if (state.muted || (state.phase !== 'speaking' && state.phase !== 'thinking')) return { state, effects: [] };
      return to(state, 'listening', 'silence', 'listen');
    case 'interrupt':
      if (state.phase !== 'speaking' && state.phase !== 'thinking') return { state, effects: [] };
      return state.muted ? to(state, 'idle', 'silence') : to(state, 'listening', 'silence', 'listen');
    case 'mute': {
      const next = { ...state, muted: true };
      return state.phase === 'listening' ? to(next, 'idle', 'discard') : { state: next, effects: [] };
    }
    case 'unmute': {
      const next = { ...state, muted: false };
      return state.phase === 'idle' && next.handsFree ? to(next, 'listening', 'listen') : { state: next, effects: [] };
    }
    case 'pause':
      return to(state, 'paused', ...recordingOff(state), 'silence');
    case 'resume':
      return { state, effects: [] };
  }
}

function recordingOff(state: LoopState): Effect[] {
  return state.phase === 'listening' ? ['discard'] : [];
}

/** What the screen shows for a state: the four words of the visual, plus muted, paused and ready. */
export type LoopLabel = 'ready' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'paused';

export function labelOf(state: LoopState): LoopLabel {
  switch (state.phase) {
    case 'paused':
      return 'paused';
    case 'listening':
      return 'listening';
    case 'transcribing':
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    default:
      return state.muted ? 'muted' : 'ready';
  }
}
