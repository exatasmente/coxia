import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type Term, corrected, spoken, whisperHint } from '../shared/glossary';
import type { Voice, VoiceEngine } from '../shared/types';
import { PACKAGED, SIDECAR_DIR, venvDir } from './paths';
import { edgePitch, edgeRate, kokoroSpeed, needsJoin, prosodyPlan, speakable } from './prosody';
import { ensureVenv, venvPython } from './venv';

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
let installer: ChildProcess | null = null;
let nextId = 1;
const waiting = new Map<number, (r: Reply) => void>();

function launch(python: string): ChildProcessWithoutNullStreams {
  mkdirSync(AUDIO, { recursive: true });
  const child = spawn(python, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const r = JSON.parse(line) as Reply;
    if (r.ready) ready = true;
    waiting.get(r.id)?.(r);
    waiting.delete(r.id);
  });
  child.stderr.on('data', (d) => process.stderr.write(`[voice] ${d}`));
  child.on('exit', () => {
    proc = null;
    ready = false;
    for (const [, resolve] of waiting) resolve({ id: -1, error: 'voice sidecar exited' });
    waiting.clear();
  });
  return child;
}

// Installed app: the venv is built on first use (uv, from requirements.txt). Dev: sidecar/.venv as before.
async function sidecar(): Promise<ChildProcessWithoutNullStreams> {
  if (proc) return proc;
  starting ??= (async () => {
    const python = PACKAGED
      ? await ensureVenv(venvDir(), join(SIDECAR_DIR, 'requirements.txt'), (c) => (installer = c))
      : venvPython(venvDir());
    proc = launch(python);
    return proc;
  })().finally(() => {
    starting = null;
    installer = null;
  });
  return starting;
}

function call(req: Record<string, unknown>): Promise<Reply> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve(r)));
    sidecar().then(
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
  const t = Date.now();
  const answered = await Promise.race([
    call({ cmd: 'ping' }).then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  return { alive: Boolean(proc), ready, pingMs: answered ? Date.now() - t : null };
}

export function startVoice(): void {
  rmSync(AUDIO, { recursive: true, force: true });
  sidecar().catch((e) => console.error('[voice]', (e as Error).message));
}

export function stopVoice(): void {
  installer?.kill();
  proc?.kill();
  rmSync(AUDIO, { recursive: true, force: true });
}

export async function speak(text: string, wanted: Voice, engine: VoiceEngine, opts: { prosody: boolean; glossary: Term[] }): Promise<string> {
  const voice = resolveVoice(wanted, engine);
  // the tone is read from the written terms, the voice gets their pronunciation
  const plan = (opts.prosody ? prosodyPlan(text) : []).map((s) => ({ ...s, text: spoken(s.text, opts.glossary) }));
  if (needsJoin(plan)) {
    const out = join(AUDIO, `tts-${Date.now()}-${nextId}.wav`);
    const segments = plan.map((s) => ({
      text: s.text,
      rate: edgeRate(voice.rate, s.rate),
      pitch: edgePitch(voice.pitch, s.pitch),
      speed: kokoroSpeed(voice.speed ?? 1, s.rate),
      pause_ms: s.pauseMs,
    }));
    const r = await call({ cmd: 'tts', engine, voice: voice.voice, segments, out });
    return r.path ?? out;
  }
  const out = join(AUDIO, `tts-${Date.now()}-${nextId}.${engine === 'kokoro' ? 'wav' : 'mp3'}`);
  const said = plan[0]?.text ?? spoken(speakable(text), opts.glossary);
  const r = await call({ cmd: 'tts', engine, text: said, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, speed: voice.speed ?? 1, out });
  return r.path ?? out;
}

export async function transcribe(audio: ArrayBuffer, glossary: Term[]): Promise<string> {
  const path = join(AUDIO, `stt-${Date.now()}.webm`);
  writeFileSync(path, Buffer.from(audio));
  try {
    const r = await call({ cmd: 'stt', path, prompt: whisperHint(glossary) });
    return corrected(r.text ?? '', glossary);
  } finally {
    unlinkSync(path);
  }
}
