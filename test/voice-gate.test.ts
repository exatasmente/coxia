// Whether the chat's voice controls may open the microphone: only a voice that is on and installed, in a page that can record. Off or not installed, they only
// say so; the settings are offered on the computer, and a paired phone is told that turning the voice on happens there.
import { describe, expect, it } from 'vitest';
import { mayRecord, offersSettings, voiceGate } from '../src/renderer/src/voice/voiceGate';

const on = { enabled: true, depsInstalled: true };

describe('voiceGate', () => {
  it('waits for the status before saying anything', () => {
    expect(voiceGate({ status: null, isWeb: false, mic: 'ok' })).toBe('loading');
  });

  it('is ready with the voice on, installed and a page that records', () => {
    expect(voiceGate({ status: on, isWeb: false, mic: 'ok' })).toBe('ready');
    expect(voiceGate({ status: on, isWeb: true, mic: 'ok' })).toBe('ready');
  });

  it('says off or not installed on the computer, and points to the settings', () => {
    const off = voiceGate({ status: { enabled: false, depsInstalled: true }, isWeb: false, mic: 'ok' });
    const missing = voiceGate({ status: { enabled: true, depsInstalled: false }, isWeb: false, mic: 'ok' });
    expect([off, missing]).toEqual(['off', 'missing']);
    expect(offersSettings(off) && offersSettings(missing)).toBe(true);
  });

  it('tells a paired phone that the voice is turned on on the computer, without offering the settings', () => {
    for (const status of [{ enabled: false, depsInstalled: false }, { enabled: true, depsInstalled: false }]) {
      const gate = voiceGate({ status, isWeb: true, mic: 'ok' });
      expect(gate).toBe('web-off');
      expect(offersSettings(gate)).toBe(false);
    }
  });

  it('blames the page when the voice is ready but the browser cannot record', () => {
    expect(voiceGate({ status: on, isWeb: true, mic: 'insecure' })).toBe('insecure');
    expect(voiceGate({ status: on, isWeb: true, mic: 'unsupported' })).toBe('unsupported');
  });

  it('records only when ready: no other state opens the microphone', () => {
    expect(mayRecord('ready')).toBe(true);
    for (const gate of ['loading', 'off', 'missing', 'web-off', 'insecure', 'unsupported'] as const) expect(mayRecord(gate)).toBe(false);
  });
});
