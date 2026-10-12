// Whether this browser can record, and why not. Pure on purpose: the screen reads the environment and passes it in.

export type MicSupport = 'ok' | 'insecure' | 'unsupported';

export interface MicEnvironment {
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
}

// Browsers hide the microphone API outside https (or localhost), so on a phone opened over plain http it is just absent:
// the insecure context is what explains it, not a missing feature.
export function micSupport(env: MicEnvironment): MicSupport {
  if (!env.isSecureContext) return 'insecure';
  if (!env.hasMediaDevices || !env.hasMediaRecorder) return 'unsupported';
  return 'ok';
}

export function micEnvironment(): MicEnvironment {
  return {
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    hasMediaDevices: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    hasMediaRecorder: typeof MediaRecorder !== 'undefined',
  };
}

export type MicError = 'denied' | 'missing' | 'other';

// getUserMedia rejects with a DOMException whose name says what happened.
export function explainMicError(error: unknown): MicError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'other';
}
