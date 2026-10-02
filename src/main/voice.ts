import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type Term, corrected, spoken, whisperHint } from '../shared/glossary';
import { expandHome } from '../shared/config/paths';
import { t } from '../shared/i18n';
import type { SpeechSegment, Voice, VoiceEngine } from '../shared/types';
import { VOICE_TEST_SENTENCE, type VoiceTestResult, wordMatch } from '../shared/voiceSetup';
import { logError } from './errorlog';
import { SIDECAR_DIR, legacyVenvDir, voiceModelsDir, voiceToolsDir, voiceVenvDir } from './paths';
import { edgePitch, edgeRate, kokoroSpeed, needsJoin, prosodyPlan, speakable } from './prosody';
import { type SetupContext, activeVenv, kokoroDir, modelHome } from './voice-setup';
import { getConfig } from './workspaceConfig';

const SCRIPT = join(SIDECAR_DIR, 'voice_sidecar.py');
const AUDIO = process.env.CERIMONIAS_AUDIO_DIR ?? join(tmpdir(), 'cerimonias-audio');

export const MODERATOR: Voice = { voice: 'pt-BR-ThalitaMultilingualNeural', rate: '+0%', pitch: '+0Hz', label: 'Thalita' };

// The free Edge endpoint has three pt-BR voices; rate and pitch tell the activity agents apart.
export const AGENT_VOICES: Voice[] = [
  { voice: 'pt-BR-AntonioNeural', rate: '+5%', pitch: '+0Hz', label: 'Antonio' },
  { voice: 'pt-BR-FranciscaNeural', rate: '+5%', pitch: '+0Hz', label: 'Francisca' },
  { voice: 'pt-BR-AntonioNeural', rate: '+0%', pitch: '-8Hz', label: 'Antonio grave' },
  { voice: 'pt-BR-FranciscaNeural', rate: '+0%', pitch: '+6Hz', label: 'Francisca aguda' },
  { voice: 'pt-BR-AntonioNeural', rate: '+10%', pitch: '+5Hz', label: 'Antonio rápido' },
  { voice: 'pt-BR-FranciscaNeural', rate: '-5%', pitch: '-6Hz', label: 'Francisca grave' },
  { voice: 'pt-BR-ThalitaMultilingualNeural', rate: '+5%', pitch: '-5Hz', label: 'Thalita grave' },
  { voice: 'pt-BR-AntonioNeural', rate: '-5%', pitch: '+3Hz', label: 'Antonio calmo' },
];

// Kokoro has three pt-BR voices and no pitch: speed tells the agents apart. Same length as the Edge list so a slot keeps its index.
const KOKORO_MODERATOR: Voice = { voice: 'pf_dora', rate: '+0%', pitch: '+0Hz', label: 'Dora', engine: 'kokoro', speed: 1 };

const KOKORO_AGENTS: Voice[] = [
  { voice: 'pm_alex', speed: 1.05, label: 'Alex' },
  { voice: 'pm_santa', speed: 1.05, label: 'Santa' },
  { voice: 'pf_dora', speed: 1.15, label: 'Dora rápida' },
  { voice: 'pm_alex', speed: 0.92, label: 'Alex calmo' },
  { voice: 'pm_santa', speed: 0.9, label: 'Santa calmo' },
  { voice: 'pm_alex', speed: 1.2, label: 'Alex rápido' },
  { voice: 'pf_dora', speed: 0.88, label: 'Dora calma' },
  { voice: 'pm_santa', speed: 1.18, label: 'Santa rápido' },
].map((v) => ({ ...v, rate: '+0%', pitch: '+0Hz', engine: 'kokoro' as const }));

export function voicesFor(engine: VoiceEngine): { moderator: Voice; agents: Voice[] } {
  return engine === 'kokoro' ? { moderator: KOKORO_MODERATOR, agents: KOKORO_AGENTS } : { moderator: MODERATOR, agents: AGENT_VOICES };
}

// A screen may still hold voices of the engine that was active when it loaded: map them to the same slot of the current one.
function resolveVoice(voice: Voice, engine: VoiceEngine): Voice {
  if ((voice.engine ?? 'edge') === engine) return voice;
  const from = voicesFor(voice.engine ?? 'edge');
  const to = voicesFor(engine);
  const slot = from.agents.findIndex((v) => v.label === voice.label);
  return slot < 0 ? to.moderator : to.agents[slot];
}

type Reply = { id: number; text?: string; path?: string; error?: string; ready?: boolean };

let proc: ChildProcessWithoutNullStreams | null = null;
let ready = false;
let starting: Promise<ChildProcessWithoutNullStreams> | null = null;
let nextId = 1;
const waiting = new Map<number, (r: Reply) => void>();
// The app is quitting: the sidecar's exit is expected.
let stopping = false;
// Sidecars the app stopped on purpose (voice turned off): their exit is not a failure.
const stoppedOnPurpose = new WeakSet<ChildProcess>();
// The last stderr lines tell why the sidecar died; they go to the error log with the exit.
const stderrTail: string[] = [];

/** Voice is off: nothing here may start the sidecar, open a recording or synthesize a word. */
export class VoiceOffError extends Error {
  readonly code = 'voice-off';
  constructor() {
    super(t('voice.err.off'));
  }
}

export const voiceOn = (): boolean => getConfig().voice.enabled;

function requireVoice(): void {
  if (!voiceOn()) throw new VoiceOffError();
}

/** The folders the voice setup works in, in this app (userData moves with CERIMONIAS_DATA_DIR). */
export function setupContext(): SetupContext {
  const cfg = getConfig().voice;
  const own = [process.env.CERIMONIAS_KOKORO_DIR, join(SIDECAR_DIR, 'models'), join(voiceModelsDir(), 'kokoro'), cfg.kokoroDir ? expandHome(cfg.kokoroDir, homedir()) : null];
  return {
    env: process.env,
    paths: {
      venv: voiceVenvDir(),
      models: voiceModelsDir(),
      tools: voiceToolsDir(),
      requirements: join(SIDECAR_DIR, 'requirements.txt'),
      fetchScript: join(SIDECAR_DIR, 'voice_fetch.py'),
      legacyVenv: legacyVenvDir(),
      kokoroDirs: own.filter((d): d is string => !!d),
      home: homedir(),
    },
  };
}

// The model the config chose, the folder the app downloaded it to, and the Kokoro files, as the Python side reads them.
function sidecarEnv(): NodeJS.ProcessEnv {
  const ctx = setupContext();
  const env: NodeJS.ProcessEnv = { ...process.env, CERIMONIAS_WHISPER_MODEL: getConfig().voice.sttModel };
  const home = modelHome(ctx, getConfig().voice.sttModel);
  if (home) env.HF_HOME = home;
  const kokoro = kokoroDir(ctx.paths.kokoroDirs);
  if (kokoro) env.CERIMONIAS_KOKORO_DIR = kokoro;
  return env;
}

function launch(python: string): ChildProcessWithoutNullStreams {
  mkdirSync(AUDIO, { recursive: true });
  const child = spawn(python, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], env: sidecarEnv() });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const r = JSON.parse(line) as Reply;
    if (r.ready) ready = true;
    waiting.get(r.id)?.(r);
    waiting.delete(r.id);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[voice] ${d}`);
    stderrTail.push(...String(d).split('\n').filter(Boolean));
    stderrTail.splice(0, Math.max(0, stderrTail.length - 12));
  });
  child.on('exit', (code, signal) => {
    if (!stopping && !stoppedOnPurpose.has(child)) {
      const error = new Error(`voice sidecar exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`);
      error.stack = stderrTail.join('\n');
      logError('sidecar:voice', error, { exitCode: code ?? -1, signal: signal ?? 'none' });
    }
    // a newer sidecar may already have taken the place of this one
    if (proc === child) {
      proc = null;
      ready = false;
    }
    for (const [, resolve] of waiting) resolve({ id: -1, error: 'voice sidecar exited' });
    waiting.clear();
  });
  return child;
}

// The environment is the app's own (voice:install builds it) or, in a development checkout, the repository's sidecar/.venv.
// Nothing is created here: a machine without the voice installed gets an error that says so, not a download.
async function sidecar(force = false): Promise<ChildProcessWithoutNullStreams> {
  if (proc) return proc;
  if (!force) requireVoice();
  starting ??= (async () => {
    const venv = activeVenv(setupContext().paths);
    if (!venv) throw new Error(t('voice.err.notInstalled'));
    proc = launch(venv.python);
    return proc;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

function call(req: Record<string, unknown>, onId?: (id: number) => void, force = false): Promise<Reply> {
  const id = nextId++;
  onId?.(id);
  return new Promise((resolve, reject) => {
    waiting.set(id, (r) => {
      // A dead sidecar is logged once, by its exit; cancelled requests are not failures.
      if (r.error && r.id !== -1 && r.error !== 'cancelled') logError('sidecar:voice', new Error(r.error.slice(0, 160)), { cmd: String(req.cmd) });
      return r.error ? reject(new Error(r.error)) : resolve(r);
    });
    sidecar(force).then(
      (p) => p.stdin.write(`${JSON.stringify({ id, ...req })}\n`),
      (e) => {
        waiting.delete(id);
        reject(e);
      },
    );
  });
}

// Does not respawn a dead sidecar: the health panel has to see it dead.
export async function voiceStatus(): Promise<{ alive: boolean; ready: boolean; pingMs: number | null }> {
  if (!proc) return { alive: false, ready: false, pingMs: null };
  const t0 = Date.now();
  const answered = await Promise.race([
    call({ cmd: 'ping' }, undefined, true).then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  return { alive: Boolean(proc), ready, pingMs: answered ? Date.now() - t0 : null };
}

export function sidecarRunning(): { running: boolean; ready: boolean } {
  return { running: proc !== null, ready };
}

/** Starts the sidecar when voice is on. With voice off nothing is spawned, not even a cleanup of the audio folder. */
export function startVoice(): void {
  if (!voiceOn()) return;
  rmSync(AUDIO, { recursive: true, force: true });
  sidecar().catch((e) => {
    if (e instanceof VoiceOffError) return;
    console.error('[voice]', (e as Error).message);
    logError('sidecar:voice', e, { phase: 'start' });
  });
}

/** Stops the sidecar because voice was turned off (or removed): an expected exit, nothing is logged. */
export function stopSidecar(): void {
  const p = proc;
  if (!p) return;
  stoppedOnPurpose.add(p);
  p.kill();
  proc = null;
  ready = false;
  for (const [, resolve] of waiting) resolve({ id: -1, error: 'voice sidecar stopped' });
  waiting.clear();
  rmSync(AUDIO, { recursive: true, force: true });
}

/** Brings the sidecar in line with the config: up when voice is on, down when it is off. */
export function syncVoice(): void {
  if (voiceOn()) {
    if (!proc && !starting) startVoice();
  } else {
    stopSidecar();
  }
}

// The app is quitting.
export function stopVoice(): void {
  stopping = true;
  proc?.kill();
  rmSync(AUDIO, { recursive: true, force: true });
}

/** Speaks a fixed sentence with the configured engine and listens to it again, to prove the whole chain on this machine. Starts the sidecar for the test when voice is still off. */
export async function roundTrip(): Promise<VoiceTestResult> {
  const engine = getConfig().voice.engine;
  const voice = voicesFor(engine).moderator;
  const wasUp = proc !== null;
  const out = join(AUDIO, `test-${Date.now()}.${engine === 'kokoro' ? 'wav' : 'mp3'}`);
  const fail = (error: string, extra: Partial<VoiceTestResult> = {}): VoiceTestResult => ({ ok: false, engine, expected: VOICE_TEST_SENTENCE, heard: '', match: 0, speakMs: 0, listenMs: 0, error, ...extra });
  try {
    mkdirSync(AUDIO, { recursive: true });
    const t0 = Date.now();
    await call({ cmd: 'tts', engine, text: VOICE_TEST_SENTENCE, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, speed: voice.speed ?? 1, out }, undefined, true);
    const t1 = Date.now();
    const r = await call({ cmd: 'stt', path: out, prompt: '' }, undefined, true);
    const t2 = Date.now();
    const heard = (r.text ?? '').trim();
    const match = wordMatch(VOICE_TEST_SENTENCE, heard);
    return { ok: match >= 0.6, engine, expected: VOICE_TEST_SENTENCE, heard, match, speakMs: t1 - t0, listenMs: t2 - t1 };
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    if (existsSync(out)) unlinkSync(out);
    if (!wasUp && !voiceOn()) stopSidecar();
  }
}

// The renderer plays sentence by sentence: the plan carries what each sentence needs, and every sentence is its own request.
export function planSpeech(text: string, wanted: Voice, engine: VoiceEngine, opts: { prosody: boolean; glossary: Term[] }): SpeechSegment[] {
  // Voice off: nothing is planned, so the screen has nothing to synthesize.
  if (!voiceOn()) return [];
  const voice = resolveVoice(wanted, engine);
  // the tone is read from the written terms, the voice gets their pronunciation
  const plan = (opts.prosody ? prosodyPlan(text) : []).map((s) => ({ ...s, text: spoken(s.text, opts.glossary, engine) }));
  if (needsJoin(plan)) {
    return plan.map((s) => ({
      text: s.text,
      engine,
      voice: voice.voice,
      rate: edgeRate(voice.rate, s.rate),
      pitch: edgePitch(voice.pitch, s.pitch),
      speed: kokoroSpeed(voice.speed ?? 1, s.rate),
      pauseMs: s.pauseMs,
    }));
  }
  const said = plan[0]?.text ?? spoken(speakable(text), opts.glossary, engine);
  return said.trim() ? [{ text: said, engine, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, speed: voice.speed ?? 1, pauseMs: 0 }] : [];
}

// Requests in flight per speech, so stopping it can tell the sidecar to skip the ones it has not started.
const live = new Map<string, Set<number>>();
const cancelled = new Set<string>();

export async function speakSegment(token: string, seg: SpeechSegment): Promise<ArrayBuffer> {
  requireVoice();
  if (cancelled.has(token)) throw new Error('cancelled');
  const out = join(AUDIO, `tts-${Date.now()}-${nextId}.${seg.engine === 'kokoro' ? 'wav' : 'mp3'}`);
  const ids = live.get(token) ?? new Set<number>();
  live.set(token, ids);
  let id = 0;
  try {
    const r = await call({ cmd: 'tts', engine: seg.engine, text: seg.text, voice: seg.voice, rate: seg.rate, pitch: seg.pitch, speed: seg.speed, out }, (n) => ids.add((id = n)));
    const path = r.path ?? out;
    const bytes = readFileSync(path);
    unlinkSync(path);
    return new Uint8Array(bytes).buffer;
  } finally {
    ids.delete(id);
    if (ids.size === 0) live.delete(token);
  }
}

export function cancelSpeech(token: string): void {
  cancelled.add(token);
  if (cancelled.size > 200) cancelled.delete(cancelled.values().next().value as string);
  for (const id of live.get(token) ?? []) proc?.stdin.write(`${JSON.stringify({ id: nextId++, cmd: 'cancel', target: id })}\n`);
}

// The browser picks the container (WebM in Chromium, MP4 in Safari); the extension only helps the decoder guess.
export function recordingExtension(audio: ArrayBuffer): 'webm' | 'mp4' | 'ogg' {
  const head = new TextDecoder('latin1').decode(new Uint8Array(audio, 0, Math.min(12, audio.byteLength)));
  if (head.slice(4, 8) === 'ftyp') return 'mp4';
  if (head.startsWith('OggS')) return 'ogg';
  return 'webm';
}

export async function transcribe(audio: ArrayBuffer, glossary: Term[]): Promise<string> {
  requireVoice();
  const path = join(AUDIO, `stt-${Date.now()}.${recordingExtension(audio)}`);
  writeFileSync(path, Buffer.from(audio));
  try {
    const r = await call({ cmd: 'stt', path, prompt: whisperHint(glossary) });
    return corrected(r.text ?? '', glossary);
  } finally {
    unlinkSync(path);
  }
}
