// The paired phone: a hidden page (a locked screen, another tab) pauses voice mode and the computer keeps listening; a page over plain http says why it cannot
// record; and a paused session only comes back with a tap.
import { describe, expect, it } from 'vitest';
import en from '../src/shared/i18n/ui-call.en.json';
import ptBR from '../src/shared/i18n/ui-call.pt-BR.json';
import { micSupport } from '../src/renderer/src/voice/micSupport';
import { pausePolicy } from '../src/renderer/src/voice/pausePolicy';
import { initialLoop, loopStep } from '../src/renderer/src/voice/voiceLoop';
import { voiceGate } from '../src/renderer/src/voice/voiceGate';

describe('pausePolicy', () => {
  it('pauses a phone whose page is hidden', () => {
    expect(pausePolicy({ phone: true, hidden: true })).toBe('pause');
    expect(pausePolicy({ phone: true, hidden: false })).toBe('keep');
  });

  it('keeps the computer listening without focus', () => {
    expect(pausePolicy({ phone: false, hidden: true })).toBe('keep');
  });
});

describe('a phone over plain http', () => {
  it('gets the insecure note, which says https is the reason, in both languages', () => {
    const gate = voiceGate({ status: { enabled: true, depsInstalled: true }, isWeb: true, mic: micSupport({ isSecureContext: false, hasMediaDevices: false, hasMediaRecorder: true }) });
    expect(gate).toBe('insecure');
    const catalogs = [en, ptBR] as Record<string, string>[];
    for (const c of catalogs) expect(c['ui.voice.mic.insecure']).toMatch(/https/);
  });
});

describe('a paused voice mode', () => {
  it('comes back only with a tap on resume', () => {
    let state = loopStep(loopStep(initialLoop(), { type: 'start', handsFree: true }).state, { type: 'pause' }).state;
    for (const type of ['speechStarted', 'answered', 'bargeIn', 'interrupt'] as const) state = loopStep(state, { type }).state;
    expect(state.phase).toBe('paused');
    const resumed = loopStep(state, { type: 'resume' });
    expect(resumed.state.phase).toBe('listening');
    expect(resumed.effects).toEqual(['listen']);
  });
});
