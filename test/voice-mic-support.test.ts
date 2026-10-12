// Whether a browser can record and why not: a phone opened over plain http has no microphone API at all, and that is said as the reason, not as a missing feature.
import { describe, expect, it } from 'vitest';
import { explainMicError, micSupport } from '../src/renderer/src/voice/micSupport';

describe('micSupport', () => {
  it('is ok in a secure page with the recording APIs', () => {
    expect(micSupport({ isSecureContext: true, hasMediaDevices: true, hasMediaRecorder: true })).toBe('ok');
  });

  it('blames the insecure page first, since browsers hide the microphone outside https', () => {
    expect(micSupport({ isSecureContext: false, hasMediaDevices: false, hasMediaRecorder: true })).toBe('insecure');
    expect(micSupport({ isSecureContext: false, hasMediaDevices: true, hasMediaRecorder: true })).toBe('insecure');
  });

  it('is unsupported in a secure page that lacks an API', () => {
    expect(micSupport({ isSecureContext: true, hasMediaDevices: false, hasMediaRecorder: true })).toBe('unsupported');
    expect(micSupport({ isSecureContext: true, hasMediaDevices: true, hasMediaRecorder: false })).toBe('unsupported');
  });
});

describe('explainMicError', () => {
  const named = (name: string) => Object.assign(new Error('x'), { name });

  it('reads a refused permission', () => {
    expect(explainMicError(named('NotAllowedError'))).toBe('denied');
    expect(explainMicError(named('SecurityError'))).toBe('denied');
  });

  it('reads a missing microphone', () => {
    expect(explainMicError(named('NotFoundError'))).toBe('missing');
    expect(explainMicError(named('OverconstrainedError'))).toBe('missing');
  });

  it('leaves anything else as other', () => {
    expect(explainMicError(named('AbortError'))).toBe('other');
    expect(explainMicError('boom')).toBe('other');
    expect(explainMicError(null)).toBe('other');
  });
});
