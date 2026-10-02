import { VOICE_CHANNELS, VOICE_PROGRESS_EVENT, type VoiceCheck, type VoiceEnableResult, type VoiceInstallOptions, type VoiceInstallResult, type VoiceStatus, type VoiceTestResult, type VoiceUninstallResult, type SttModel } from '../shared/voiceSetup';
import { getSettings } from './config';
import { logError } from './errorlog';
import type { Module } from './module';
import { roundTrip, setupContext, sidecarRunning, stopSidecar, syncVoice } from './voice';
import { activeVenv, checkVoice, installVoice, isSttModel, uninstallVoice } from './voice-setup';
import { getConfig, onConfigChange, updateConfig } from './workspaceConfig';

// The voice setup channels (voice:*). Desktop only (webPolicy): they install software, delete files and start processes on the machine.
// voice:install is one long call: it resolves when the install ends, and tells how far it is through the module event VOICE_PROGRESS_EVENT.

let installing: AbortController | null = null;

function status(): VoiceStatus {
  const { voice } = getConfig();
  const { running, ready } = sidecarRunning();
  return { enabled: voice.enabled, depsInstalled: voice.depsInstalled, engine: voice.engine, sttModel: voice.sttModel, running, ready, installing: installing !== null };
}

export const voiceModule: Module = (ctx) => {
  // Anything that changes the config (Settings, the wizard, an import) brings the sidecar and the screens in line.
  onConfigChange(() => {
    syncVoice();
    ctx.emit({ type: 'settings', settings: getSettings() });
  });

  ctx.handle(VOICE_CHANNELS.status, (): VoiceStatus => status());

  ctx.handle(VOICE_CHANNELS.check, (sttModel?: string): Promise<VoiceCheck> => checkVoice(setupContext(), isSttModel(sttModel) ? sttModel : (isSttModel(getConfig().voice.sttModel) ? (getConfig().voice.sttModel as SttModel) : 'small')));

  ctx.handle(VOICE_CHANNELS.install, async (opts: VoiceInstallOptions): Promise<VoiceInstallResult> => {
    if (installing) return { ok: false, cancelled: false, phase: 'check', code: 'busy', message: 'an install is already running' };
    const control = new AbortController();
    installing = control;
    try {
      const result = await installVoice(setupContext(), opts, {
        signal: control.signal,
        onProgress: (payload) => ctx.emit({ type: 'module', name: VOICE_PROGRESS_EVENT, payload }),
        onError: (phase, error) => logError('voice:install', error, { phase }),
      });
      if (!result.ok) return result;
      const enable = opts.enable !== false;
      updateConfig((c) => {
        c.voice.depsInstalled = true;
        c.voice.sttModel = opts.sttModel;
        c.voice.engine = opts.engine;
        if (enable) c.voice.enabled = true;
        return c;
      });
      return { ...result, enabled: enable };
    } finally {
      installing = null;
    }
  });

  ctx.handle(VOICE_CHANNELS.installCancel, (): boolean => {
    installing?.abort();
    return installing !== null;
  });

  ctx.handle(VOICE_CHANNELS.test, async (): Promise<VoiceTestResult> => {
    if (installing) throw new Error('an install is running');
    return roundTrip();
  });

  ctx.handle(VOICE_CHANNELS.uninstall, (): VoiceUninstallResult => {
    if (installing) throw new Error('an install is running');
    stopSidecar();
    const result = uninstallVoice(setupContext());
    updateConfig((c) => {
      c.voice.enabled = false;
      c.voice.depsInstalled = activeVenv(setupContext().paths) !== null;
      return c;
    });
    return result;
  });

  // Off just stops the sidecar. On needs the dependencies: without them it changes nothing and says so, and the screen runs voice:install.
  ctx.handle(VOICE_CHANNELS.enable, (on: boolean): VoiceEnableResult => {
    if (!on) {
      updateConfig((c) => {
        c.voice.enabled = false;
        return c;
      });
      return { enabled: false, needsInstall: false };
    }
    if (!activeVenv(setupContext().paths)) return { enabled: false, needsInstall: true };
    updateConfig((c) => {
      c.voice.enabled = true;
      c.voice.depsInstalled = true;
      return c;
    });
    return { enabled: true, needsInstall: false };
  });
};

