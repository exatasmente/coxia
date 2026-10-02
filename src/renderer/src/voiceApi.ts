import { useEffect, useState } from 'react';
import { VOICE_CHANNELS, VOICE_PROGRESS_EVENT, type VoiceCheck, type VoiceEnableResult, type VoiceInstallOptions, type VoiceInstallResult, type VoiceProgress, type VoiceStatus, type VoiceTestResult, type VoiceUninstallResult } from '../../shared/voiceSetup';
import { api, moduleEvents } from './api';

// The voice setup API from the screens (Settings → Voz, the wizard). The main side is src/main/voiceModule.ts.
export const voiceApi = {
  status: () => api.invoke<VoiceStatus>(VOICE_CHANNELS.status),
  check: (sttModel?: string) => api.invoke<VoiceCheck>(VOICE_CHANNELS.check, sttModel),
  /** Resolves when the install ends; watch useVoiceProgress() meanwhile. */
  install: (opts: VoiceInstallOptions) => api.invoke<VoiceInstallResult>(VOICE_CHANNELS.install, opts),
  cancelInstall: () => api.invoke<boolean>(VOICE_CHANNELS.installCancel),
  test: () => api.invoke<VoiceTestResult>(VOICE_CHANNELS.test),
  uninstall: () => api.invoke<VoiceUninstallResult>(VOICE_CHANNELS.uninstall),
  enable: (on: boolean) => api.invoke<VoiceEnableResult>(VOICE_CHANNELS.enable, on),
};

/** The latest progress of a running install, or null when none is (it is not replayed: only what arrives while mounted). */
export function useVoiceProgress(): VoiceProgress | null {
  const [progress, setProgress] = useState<VoiceProgress | null>(null);
  useEffect(() => {
    const on = (e: Event) => setProgress((e as CustomEvent<VoiceProgress>).detail);
    moduleEvents.addEventListener(VOICE_PROGRESS_EVENT, on);
    return () => moduleEvents.removeEventListener(VOICE_PROGRESS_EVENT, on);
  }, []);
  return progress;
}
