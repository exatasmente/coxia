import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VoiceEngine } from '../shared/config/types';
import {
  STT_MODELS,
  STT_MODEL_BYTES,
  type SttModel,
  VOICE_DISK_MARGIN_BYTES,
  VOICE_PACKAGES_BYTES,
  type VoiceCheck,
  type VoiceEngineInfo,
  type VoiceInstallOptions,
  type VoiceInstallResult,
  type VoicePhase,
  type VoiceProblem,
  type VoiceProgress,
  type VoiceUninstallResult,
} from '../shared/voiceSetup';
import { CancelledError, PYTHON_VERSION, READY, dirSize, findUv, freeBytes, runStep, venvPython, venvReady } from './venv';
import { t } from '../shared/i18n';

// What the voice needs on a machine and how it gets there. No Electron here: the paths and the environment come in, so the flow runs the same
// in the app and in the tests (with a fake uv and a fake python on PATH).

const exec = promisify(execFile);

export interface VoicePaths {
  /** Where an install puts the Python environment (the app data folder). */
  venv: string;
  /** HF_HOME for models the app downloads. */
  models: string;
  /** Where a uv fetched by the app lives. */
  tools: string;
  requirements: string;
  /** voice_fetch.py: the model download with progress. */
  fetchScript: string;
  /** The checkout's own sidecar/.venv, in a development run; null when installed. */
  legacyVenv: string | null;
  /** Folders that may hold kokoro-v1.0.onnx and voices-v1.0.bin. */
  kokoroDirs: string[];
  home: string;
}

export interface SetupContext {
  paths: VoicePaths;
  env: NodeJS.ProcessEnv;
}

const KOKORO_FILES = ['kokoro-v1.0.onnx', 'voices-v1.0.bin'];
const PYTHON_MIN = 9;
const PYTHON_MAX = 13;

export const isSttModel = (v: unknown): v is SttModel => typeof v === 'string' && (STT_MODELS as readonly string[]).includes(v);

// --- what is on the machine ---

export async function pythonInfo(env: NodeJS.ProcessEnv): Promise<VoiceCheck['python']> {
  try {
    const { stdout, stderr } = await exec('python3', ['--version'], { env, timeout: 10_000 });
    const m = /Python (\d+)\.(\d+)(?:\.(\d+))?/.exec(`${stdout}${stderr}`);
    if (!m) return { found: true, version: null, ok: false };
    const minor = Number(m[2]);
    return { found: true, version: `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`, ok: m[1] === '3' && minor >= PYTHON_MIN && minor <= PYTHON_MAX };
  } catch {
    return { found: false, version: null, ok: false };
  }
}

/** The environment the sidecar runs from: the app's own, else (development only) the checkout's. */
export function activeVenv(paths: VoicePaths): { dir: string; python: string; kind: 'data' | 'legacy' } | null {
  if (venvReady(paths.venv)) return { dir: paths.venv, python: venvPython(paths.venv), kind: 'data' };
  if (paths.legacyVenv && existsSync(venvPython(paths.legacyVenv))) return { dir: paths.legacyVenv, python: venvPython(paths.legacyVenv), kind: 'legacy' };
  return null;
}

function snapshotHas(hub: string, model: SttModel): boolean {
  const snapshots = join(hub, `models--Systran--faster-whisper-${model}`, 'snapshots');
  try {
    return readdirSync(snapshots).some((rev) => existsSync(join(snapshots, rev, 'model.bin')));
  } catch {
    return false;
  }
}

/** Models the app downloaded (its own folder). */
export function modelsInApp(paths: VoicePaths): Record<SttModel, boolean> {
  return Object.fromEntries(STT_MODELS.map((m) => [m, snapshotHas(join(paths.models, 'hub'), m)])) as Record<SttModel, boolean>;
}

/** Where the Hugging Face cache lives when HF_HOME is not set by the app. */
export function defaultHub(ctx: SetupContext): string {
  if (ctx.env.HF_HUB_CACHE) return ctx.env.HF_HUB_CACHE;
  return join(ctx.env.HF_HOME ?? join(ctx.env.XDG_CACHE_HOME ?? join(ctx.paths.home, '.cache'), 'huggingface'), 'hub');
}

/** A model counts as downloaded when the app's folder or the user's own Hugging Face cache has it (a migrated user already has "small"). */
export function modelsAnywhere(ctx: SetupContext): Record<SttModel, boolean> {
  const own = modelsInApp(ctx.paths);
  const hub = defaultHub(ctx);
  return Object.fromEntries(STT_MODELS.map((m) => [m, own[m] || snapshotHas(hub, m)])) as Record<SttModel, boolean>;
}

/** HF_HOME for the sidecar: the app's folder when it holds the chosen model, else the user's own cache (null: leave the variable alone). */
export function modelHome(ctx: SetupContext, model: string): string | null {
  return isSttModel(model) && modelsInApp(ctx.paths)[model] ? ctx.paths.models : null;
}

export function kokoroDir(dirs: string[]): string | null {
  return dirs.find((d) => d && KOKORO_FILES.every((f) => existsSync(join(d, f)))) ?? null;
}

export function engines(paths: VoicePaths): VoiceEngineInfo[] {
  const dir = kokoroDir(paths.kokoroDirs);
  return [
    { id: 'edge', local: false, sendsTextTo: 'Microsoft', available: true, modelDir: null, expectedDir: null },
    { id: 'kokoro', local: true, sendsTextTo: null, available: dir !== null, modelDir: dir, expectedDir: join(paths.models, 'kokoro') },
  ];
}

export function neededBytes(model: SttModel, haveVenv: boolean, haveModel: boolean): number {
  return (haveVenv ? 0 : VOICE_PACKAGES_BYTES) + (haveModel ? 0 : STT_MODEL_BYTES[model]) + VOICE_DISK_MARGIN_BYTES;
}

export async function checkVoice(ctx: SetupContext, wanted: SttModel = 'small'): Promise<VoiceCheck> {
  const python = await pythonInfo(ctx.env);
  const uvPath = findUv({ home: ctx.paths.home, env: ctx.env, extraDirs: [join(ctx.paths.tools, 'bin')] });
  const venv = activeVenv(ctx.paths);
  const models = modelsAnywhere(ctx);
  const needed = neededBytes(wanted, venv !== null, models[wanted]);
  const free = freeBytes(ctx.paths.venv);
  const problems: VoiceProblem[] = [];
  if (!uvPath && !python.found) problems.push('no-python');
  else if (!uvPath && !python.ok) problems.push('python-version');
  const enough = free === null || free >= needed;
  if (!enough) problems.push('disk-low');
  return {
    python,
    uv: { found: uvPath !== null, path: uvPath, installable: uvPath === null && python.ok },
    disk: { dir: ctx.paths.venv, freeBytes: free, neededBytes: needed, enough },
    installed: { venv: venv !== null, kind: venv?.kind ?? null, dir: venv?.dir ?? null, models, removableBytes: [ctx.paths.venv, ctx.paths.models, ctx.paths.tools].reduce((n, d) => n + dirSize(d), 0) },
    engines: engines(ctx.paths),
    problems,
    canInstall: problems.length === 0,
    microphone: 'renderer',
  };
}

// --- install ---

export interface InstallHooks {
  signal: AbortSignal;
  onProgress: (p: VoiceProgress) => void;
  /** A failure goes to the error log. */
  onError: (phase: VoicePhase, error: Error) => void;
}

// Where each phase starts in the overall percentage; the model phase fills its own range with bytes.
const SPAN: Record<'check' | 'uv' | 'venv' | 'packages' | 'model' | 'verify', [number, number]> = {
  check: [0, 2],
  uv: [2, 8],
  venv: [8, 15],
  packages: [15, 65],
  model: [65, 97],
  verify: [97, 100],
};

class PhaseError extends Error {
  constructor(
    readonly phase: VoicePhase,
    readonly code: 'no-uv' | 'failed',
    cause: Error,
  ) {
    super(cause.message);
    this.stack = cause.stack;
  }
}

// i18n-ignore: python import check
const IMPORTS = 'import faster_whisper, edge_tts, av, soundfile, kokoro_onnx';

/** Gets uv: the one on the machine, else one installed from PyPI into the app's tools folder with python3. */
async function ensureUv(ctx: SetupContext, hooks: InstallHooks, step: (line: string) => void): Promise<string> {
  const found = findUv({ home: ctx.paths.home, env: ctx.env, extraDirs: [join(ctx.paths.tools, 'bin')] });
  if (found) return found;
  const python = await pythonInfo(ctx.env);
  if (!python.ok) throw new PhaseError('uv', 'no-uv', new Error(python.found ? t('main.voiceSetup.pythonRange', { version: python.version ?? '?' }) : t('main.voiceSetup.noPython')));
  mkdirSync(ctx.paths.tools, { recursive: true });
  const opts = { env: ctx.env, signal: hooks.signal, onLine: step };
  try {
    await runStep('python3', ['-m', 'venv', ctx.paths.tools], opts);
    await runStep(join(ctx.paths.tools, 'bin/pip'), ['install', '--disable-pip-version-check', 'uv'], opts);
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    throw new PhaseError('uv', 'no-uv', e as Error);
  }
  const installed = join(ctx.paths.tools, 'bin/uv');
  if (!existsSync(installed)) throw new PhaseError('uv', 'no-uv', new Error(t('main.voiceSetup.uvMissing')));
  return installed;
}

function parseFetchLine(line: string): { phase?: string; done?: number; total?: number | null; error?: string } | null {
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, never>) : null;
  } catch {
    return null;
  }
}

/**
 * Creates the Python environment, installs the sidecar's packages and downloads the speech model, reporting progress.
 * Each step is skipped when its result is already there, so a cancelled or failed run is resumed by running it again (uv keeps its download
 * cache and the model download continues its partial files). An environment that already exists (a migrated install, or the checkout's own
 * venv in development) is never reinstalled.
 */
export async function installVoice(ctx: SetupContext, opts: VoiceInstallOptions, hooks: InstallHooks): Promise<VoiceInstallResult> {
  const progress = (phase: VoicePhase, within: number | null, extra: Partial<VoiceProgress> = {}) => {
    const [from, to] = SPAN[phase as keyof typeof SPAN] ?? [0, 100];
    hooks.onProgress({ phase, percent: within === null ? null : Math.round(from + (to - from) * within), ...extra });
  };
  const fail = (phase: VoicePhase, code: 'no-uv' | 'failed', e: Error): VoiceInstallResult => {
    hooks.onError(phase, e);
    hooks.onProgress({ phase: 'failed', percent: null, detail: e.message.slice(-400) });
    return { ok: false, cancelled: false, phase, code, message: e.message.slice(-400) };
  };

  if (opts.engine === 'edge' && opts.acknowledgeEdge !== true) {
    return { ok: false, cancelled: false, phase: 'check', code: 'edge-not-acknowledged', message: t('main.voiceSetup.edgeAck') };
  }
  if (opts.engine === 'kokoro' && !kokoroDir(ctx.paths.kokoroDirs)) {
    return { ok: false, cancelled: false, phase: 'check', code: 'kokoro-missing', message: t('main.voiceSetup.kokoroMissing') };
  }
  if (!isSttModel(opts.sttModel)) {
    return { ok: false, cancelled: false, phase: 'check', code: 'failed', message: t('main.voiceSetup.unknownModel', { model: String(opts.sttModel) }) };
  }

  let phase: VoicePhase = 'check';
  const last = (line: string) => progress(phase, null, { detail: line.slice(0, 300) });
  try {
    progress('check', 0);
    let venv = activeVenv(ctx.paths);

    if (!venv) {
      phase = 'uv';
      progress('uv', 0);
      const uv = await ensureUv(ctx, hooks, last);
      const stepOpts = { env: ctx.env, signal: hooks.signal, onLine: last };

      phase = 'venv';
      progress('venv', 0);
      const python = venvPython(ctx.paths.venv);
      if (!existsSync(python)) {
        // a partial folder from a run that died before the interpreter existed
        rmSync(ctx.paths.venv, { recursive: true, force: true });
        mkdirSync(join(ctx.paths.venv, '..'), { recursive: true });
        await runStep(uv, ['venv', '--python', PYTHON_VERSION, ctx.paths.venv], stepOpts);
      }

      phase = 'packages';
      progress('packages', null);
      await runStep(uv, ['pip', 'install', '--python', python, '-r', ctx.paths.requirements], stepOpts);
      writeFileSync(join(ctx.paths.venv, READY), new Date().toISOString());
      venv = activeVenv(ctx.paths);
    }
    if (!venv) throw new Error(t('main.voiceSetup.envBroken'));

    phase = 'model';
    progress('model', 0);
    if (!modelsAnywhere(ctx)[opts.sttModel]) {
      mkdirSync(ctx.paths.models, { recursive: true });
      let failure: string | null = null;
      await runStep(venv.python, [ctx.paths.fetchScript, opts.sttModel], {
        // plain HTTP downloads: the partial file grows as it arrives (progress) and is continued by a range request (resume); xet writes it in one go at the end
        env: { ...ctx.env, HF_HOME: ctx.paths.models, HF_HUB_DISABLE_XET: '1' },
        signal: hooks.signal,
        onLine: (line, stream) => {
          if (stream !== 'out') return last(line);
          const msg = parseFetchLine(line);
          if (!msg) return last(line);
          if (msg.phase === 'error') failure = String(msg.error ?? t('main.voiceSetup.downloadFailed'));
          if (msg.phase === 'start' || msg.phase === 'progress') {
            const total = typeof msg.total === 'number' && msg.total > 0 ? msg.total : null;
            const done = typeof msg.done === 'number' ? msg.done : 0;
            progress('model', total ? Math.min(0.99, done / total) : null, { bytes: { done, total } });
          }
        },
      });
      if (failure) throw new Error(failure);
    }

    phase = 'verify';
    progress('verify', 0);
    await runStep(venv.python, ['-c', IMPORTS], { env: ctx.env, signal: hooks.signal, onLine: last });

    hooks.onProgress({ phase: 'done', percent: 100 });
    return { ok: true, enabled: false, sttModel: opts.sttModel, engine: opts.engine as VoiceEngine };
  } catch (e) {
    if (e instanceof CancelledError || hooks.signal.aborted) {
      hooks.onProgress({ phase: 'cancelled', percent: null });
      return { ok: false, cancelled: true };
    }
    if (e instanceof PhaseError) return fail(e.phase, e.code, e);
    return fail(phase, 'failed', e as Error);
  }
}

// --- uninstall ---

/** Removes what the app installed: its environment, the models it downloaded and the uv it fetched. Never the checkout's venv nor the user's own Hugging Face cache. */
export function uninstallVoice(ctx: SetupContext): VoiceUninstallResult {
  const targets = [ctx.paths.venv, ctx.paths.models, ctx.paths.tools];
  const freedBytes = targets.reduce((n, t) => n + dirSize(t), 0);
  for (const t of targets) rmSync(t, { recursive: true, force: true });
  const left: VoiceUninstallResult['left'] = [];
  if (ctx.paths.legacyVenv && existsSync(venvPython(ctx.paths.legacyVenv))) left.push('legacy-venv');
  if (Object.values(modelsAnywhere(ctx)).some(Boolean)) left.push('shared-model-cache');
  return { freedBytes, left };
}
