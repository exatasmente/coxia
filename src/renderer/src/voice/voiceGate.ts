import type { VoiceStatus } from '../../../shared/voiceSetup';
import type { MicSupport } from './micSupport';

// Whether the voice controls of the chat can open the microphone, and what they say when they cannot. Pure on purpose. Only `ready` records: every other state shows
// a note and never asks for the microphone nor starts a download.

export type VoiceGate = 'loading' | 'ready' | 'off' | 'missing' | 'web-off' | 'insecure' | 'unsupported';

export function voiceGate(input: { status: Pick<VoiceStatus, 'enabled' | 'depsInstalled'> | null; isWeb: boolean; mic: MicSupport }): VoiceGate {
  const { status, isWeb, mic } = input;
  if (!status) return 'loading';
  // Turning the voice on or installing it is done on the computer only: a paired browser just says where.
  if (!status.enabled) return isWeb ? 'web-off' : 'off';
  if (!status.depsInstalled) return isWeb ? 'web-off' : 'missing';
  if (mic === 'insecure') return 'insecure';
  if (mic === 'unsupported') return 'unsupported';
  return 'ready';
}

/** Whether a gate lets the controls open the microphone. */
export const mayRecord = (gate: VoiceGate): boolean => gate === 'ready';

/** Whether the note of a gate offers the voice settings (only where they can be changed: the computer). */
export const offersSettings = (gate: VoiceGate): boolean => gate === 'off' || gate === 'missing';
