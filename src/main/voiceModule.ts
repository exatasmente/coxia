import { t } from '../shared/i18n';
import { VOICE_CHANNELS, VOICE_PROGRESS_EVENT, type VoiceCheck, type VoiceEnableResult, type VoiceInstallOptions, type VoiceInstallResult, type VoiceStatus, type VoiceTestResult, type VoiceUninstallResult, type SttModel } from '../shared/voiceSetup';
import { getSettings } from './config';
import { logError } from './errorlog';
import type { Module } from './module';
import { roundTrip, setupContext, sidecarRunning, stopSidecar, syncVoice } from './voice';
import { activeVenv, checkVoice, installVoice, isSttModel, modelsAnywhere, uninstallVoice } from './voice-setup';
import { getConfig, onConfigChange, updateConfig } from './workspaceConfig';

// The voice setup channels (voice:*). Desktop only (webPolicy): they install software, delete files and start processes on the machine.
// voice:install is one long call: it resolves when the install ends, and tells how far it is through the module event VOICE_PROGRESS_EVENT.

let installing: AbortController | null = null;

function status(): VoiceStatus {
  const { voice } = getConfig();
  const { running, ready } = sidecarRunning();
  return { enabled: voice.enabled, depsInstalled: voice.depsInstalled, engine: voice.engine, sttModel: voice.sttModel, running, ready, installing: installing !== null };
}

const size = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

// A sentence per result, in the app language, for the screens that show only text (the wizard step). The Settings screen maps the codes itself.
function checkMessage(c: VoiceCheck): string {
  if (c.problems.length) return c.problems.map((p) => t(`voice.problem.${p}`)).join(' ');
  const kokoro = t(c.engines.some((e) => e.id === 'kokoro' && e.available) ? 'voice.check.kokoro.yes' : 'voice.check.kokoro.no');
  if (c.installed.kind) return t('voice.check.installed', { deps: t(`voice.status.deps.${c.installed.kind}`), kokoro });
  const python = c.python.found ? t('voice.status.python.found', { version: c.python.version ?? '?' }) : t('voice.status.python.none');
  const uv = t(c.uv.found ? 'voice.status.uv.found' : c.uv.installable ? 'voice.status.uv.installable' : 'voice.status.uv.none');
  const free = c.disk.freeBytes === null ? t('voice.check.free.unknown') : size(c.disk.freeBytes);
  return t('voice.check.ready', { python, uv, free, kokoro });
}

function installMessage(r: VoiceInstallResult): VoiceInstallResult {
  if (r.ok) return { ...r, message: t('voice.install.ok') };
  if (r.cancelled) return { ...r, message: t('voice.phase.cancelled') };
  return { ...r, message: t(`voice.fail.${r.code}`), detail: r.message };
}

function testMessage(r: VoiceTestResult): VoiceTestResult {
  return { ...r, message: r.ok ? t('voice.test.ok', { heard: r.heard, speak: r.speakMs, listen: r.listenMs }) : t('voice.test.fail', { heard: r.heard, expected: r.expected, error: r.error ?? '' }) };
}

// voice:check takes the model as a string, or as the options object the wizard passes to every voice action.
function modelArg(arg: unknown): SttModel {
  const wanted = typeof arg === 'object' && arg !== null ? (arg as { sttModel?: unknown }).sttModel : arg;
  if (isSttModel(wanted)) return wanted;
  const configured = getConfig().voice.sttModel;
  return isSttModel(configured) ? configured : 'small';
}

export const voiceModule: Module = (ctx) => {
  // Anything that changes the config (Settings, the wizard, an import) brings the sidecar and the screens in line.
  onConfigChange(() => {
    syncVoice();
    ctx.emit({ type: 'settings', settings: getSettings() });
  });

  ctx.handle(VOICE_CHANNELS.status, (): VoiceStatus => status());

  ctx.handle(VOICE_CHANNELS.check, async (arg?: unknown): Promise<VoiceCheck> => {
    const check = await checkVoice(setupContext(), modelArg(arg));
    return { ...check, message: checkMessage(check) };
  });

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
      if (!result.ok) return installMessage(result);
      const enable = opts.enable !== false;
      updateConfig((c) => {
        c.voice.depsInstalled = true;
        c.voice.sttModel = opts.sttModel;
        c.voice.engine = opts.engine;
        if (enable) c.voice.enabled = true;
        return c;
      });
      return installMessage({ ...result, enabled: enable });
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
    return testMessage(await roundTrip());
  });

  ctx.handle(VOICE_CHANNELS.uninstall, (): VoiceUninstallResult => {
    if (installing) throw new Error('an install is running');
    stopSidecar();
    const result = uninstallVoice(setupContext());
    // The chosen model went with the folder: fall back to one that is still on the machine, so turning voice on later never downloads in the background.
    const left = modelsAnywhere(setupContext());
    updateConfig((c) => {
      c.voice.enabled = false;
      c.voice.depsInstalled = activeVenv(setupContext().paths) !== null;
      if (!left[c.voice.sttModel as SttModel]) c.voice.sttModel = (['small', 'base', 'tiny'] as const).find((m) => left[m]) ?? c.voice.sttModel;
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

