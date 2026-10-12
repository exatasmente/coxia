import { useEffect, useState } from 'react';
import type { VoiceStatus } from '../../../shared/voiceSetup';
import { useVoiceEnabled } from '../i18n';
import { isWeb } from '../platform';
import { voiceApi } from '../voiceApi';
import { micEnvironment, micSupport } from './micSupport';
import { type VoiceGate, voiceGate } from './voiceGate';

/** The gate of the voice controls, read again whenever the voice is turned on or off. Reading the status starts nothing: no download, no microphone. */
export function useVoiceGate(): VoiceGate {
  const enabled = useVoiceEnabled();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let live = true;
    voiceApi.status().then(
      (s) => live && setStatus(s),
      () => live && setStatus({ enabled: false, depsInstalled: false } as VoiceStatus),
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return voiceGate({ status, isWeb: isWeb(), mic: micSupport(micEnvironment()) });
}
