import type { VoiceEngine } from './config/types';

// The voice setup API (channels voice:*): what the wizard and Settings → Voz call to find out whether voice can run here, to install it,
// to test it and to take it away. Every text a person reads is chosen by the screen from the codes below; nothing here is prose.

/** Channels, for the screens and the tests. */
export const VOICE_CHANNELS = {
  status: 'voice:status',
  check: 'voice:check',
  install: 'voice:install',
  installCancel: 'voice:install-cancel',
  test: 'voice:test',
  uninstall: 'voice:uninstall',
  enable: 'voice:enable',
} as const;

/** Module event carrying a VoiceProgress while an install runs. */
export const VOICE_PROGRESS_EVENT = 'voice:progress';

/** faster-whisper models the setup offers, smallest first, with the download size (bytes, approximate). */
export const STT_MODELS = ['tiny', 'base', 'small'] as const;
export type SttModel = (typeof STT_MODELS)[number];
export const STT_MODEL_BYTES: Record<SttModel, number> = { tiny: 80_000_000, base: 150_000_000, small: 490_000_000 };

/** The Python packages (venv, wheels, uv cache headroom) on top of the model. */
export const VOICE_PACKAGES_BYTES = 700_000_000;
/** Free space kept beyond what the install needs. */
export const VOICE_DISK_MARGIN_BYTES = 300_000_000;

export type VoicePhase = 'check' | 'uv' | 'venv' | 'packages' | 'model' | 'verify' | 'done' | 'failed' | 'cancelled';

export interface VoiceProgress {
  phase: VoicePhase;
  /** Overall progress 0..100, or null while the phase cannot tell (the packages step). */
  percent: number | null;
  /** Bytes of the model downloaded and expected, during the model phase. */
  bytes?: { done: number; total: number | null };
  /** The last line the tool printed, for the log pane. Raw tool output, not translated. */
  detail?: string;
}

export type VoiceProblem =
  /** No python3 on PATH and no uv: nothing can create the environment. */
  | 'no-python'
  /** python3 is older than 3.9 or newer than 3.13 and uv is not there to fetch another one. */
  | 'python-version'
  /** Less free space than the install needs. */
  | 'disk-low';

export interface VoiceEngineInfo {
  id: VoiceEngine;
  /** Text and audio stay on this machine. */
  local: boolean;
  /** Where the text to be spoken goes when the engine is not local ("Microsoft"); null when it stays here. */
  sendsTextTo: string | null;
  /** Can be used now (Edge: always; Kokoro: its model files are present). */
  available: boolean;
  /** Folder of the model files, when found. */
  modelDir: string | null;
  /** Where to put the model files when they are missing (the app data folder). null for an engine with no files. */
  expectedDir: string | null;
}

export interface VoiceCheck {
  python: { found: boolean; version: string | null; ok: boolean };
  /** found: a uv is on this machine. installable: none is, but python3 can fetch one into the app data folder. */
  uv: { found: boolean; path: string | null; installable: boolean };
  disk: { dir: string; freeBytes: number | null; neededBytes: number; enough: boolean };
  /** The environment the sidecar would run from. kind "legacy" is the repository's own sidecar/.venv (a development checkout). */
  installed: { venv: boolean; kind: 'data' | 'legacy' | null; dir: string | null; models: Record<SttModel, boolean>; /** What voice:uninstall would free: the app's own environment, models and tools. */ removableBytes: number };
  engines: VoiceEngineInfo[];
  problems: VoiceProblem[];
  /** python3 or uv is available and the disk has room: voice:install can start. */
  canInstall: boolean;
  /** The microphone is checked by the screen (getUserMedia), not here. */
  microphone: 'renderer';
  /** A sentence for the screens that only show text (the wizard), in the app language. */
  message?: string;
}

export interface VoiceInstallOptions {
  sttModel: SttModel;
  engine: VoiceEngine;
  /** Required for the Edge engine: the person was told that the text to be spoken is sent to Microsoft. */
  acknowledgeEdge?: boolean;
  /** Turn voice on when the install succeeds. Default true. */
  enable?: boolean;
}

/**
 * `message` is a sentence in the app language for the screens that only show text (the wizard). The screens that map the codes themselves
 * ignore it. On a failure `detail` has what the tool printed, untranslated, for the error log pane.
 */
export type VoiceInstallResult =
  | { ok: true; enabled: boolean; sttModel: SttModel; engine: VoiceEngine; message?: string }
  | { ok: false; cancelled: true; message?: string }
  | { ok: false; cancelled: false; phase: VoicePhase; code: 'edge-not-acknowledged' | 'kokoro-missing' | 'busy' | 'no-uv' | 'failed'; message: string; detail?: string };

export interface VoiceStatus {
  enabled: boolean;
  depsInstalled: boolean;
  engine: VoiceEngine;
  sttModel: string;
  /** The sidecar process is up, and has loaded its models. */
  running: boolean;
  ready: boolean;
  installing: boolean;
}

export interface VoiceTestResult {
  ok: boolean;
  engine: VoiceEngine;
  expected: string;
  /** What the recognizer heard from the synthesized sentence. */
  heard: string;
  /** Share of the expected words found in what was heard, 0..1. */
  match: number;
  speakMs: number;
  listenMs: number;
  error?: string;
  /** A sentence in the app language, for the screens that only show text. */
  message?: string;
}

export interface VoiceUninstallResult {
  freedBytes: number;
  /** Things the app does not own and left alone: the checkout's own venv, the shared Hugging Face cache. */
  left: ('legacy-venv' | 'shared-model-cache')[];
}

export interface VoiceEnableResult {
  enabled: boolean;
  /** Voice was asked for but the dependencies are not here: run voice:install. */
  needsInstall: boolean;
}

/** The sentence the round trip speaks and expects back (pt-BR, as the voices are). */
// i18n-ignore: the sentence the voice round trip speaks: the voices are pt-BR
export const VOICE_TEST_SENTENCE = 'Olá, este é um teste da voz do Coxia.';

/** Share of the expected words (accents and case ignored) found in what was heard. */
export function wordMatch(expected: string, heard: string): number {
  const words = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const want = words(expected);
  if (want.length === 0) return 0;
  const got = new Set(words(heard));
  return want.filter((w) => got.has(w)).length / want.length;
}
