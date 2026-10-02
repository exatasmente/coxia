import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Voice } from '../shared/types';
import { PACKAGED, SIDECAR_DIR, VENV_DIR } from './paths';
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

type Reply = { id: number; text?: string; path?: string; error?: string; ready?: boolean };

let proc: ChildProcessWithoutNullStreams | null = null;
let starting: Promise<ChildProcessWithoutNullStreams> | null = null;
let installer: ChildProcess | null = null;
let nextId = 1;
const waiting = new Map<number, (r: Reply) => void>();

function launch(python: string): ChildProcessWithoutNullStreams {
  mkdirSync(AUDIO, { recursive: true });
  const child = spawn(python, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const r = JSON.parse(line) as Reply;
    waiting.get(r.id)?.(r);
    waiting.delete(r.id);
  });
  child.stderr.on('data', (d) => process.stderr.write(`[voice] ${d}`));
  child.on('exit', () => {
    proc = null;
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
      ? await ensureVenv(VENV_DIR, join(SIDECAR_DIR, 'requirements.txt'), (c) => (installer = c))
      : venvPython(VENV_DIR);
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

export function startVoice(): void {
  rmSync(AUDIO, { recursive: true, force: true });
  sidecar().catch((e) => console.error('[voice]', (e as Error).message));
}

export function stopVoice(): void {
  installer?.kill();
  proc?.kill();
  rmSync(AUDIO, { recursive: true, force: true });
}

export async function speak(text: string, voice: Voice): Promise<string> {
  const out = join(AUDIO, `tts-${Date.now()}-${nextId}.mp3`);
  const r = await call({ cmd: 'tts', text, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, out });
  return r.path ?? out;
}

export async function transcribe(audio: ArrayBuffer): Promise<string> {
  const path = join(AUDIO, `stt-${Date.now()}.webm`);
  writeFileSync(path, Buffer.from(audio));
  try {
    const r = await call({ cmd: 'stt', path });
    return r.text ?? '';
  } finally {
    unlinkSync(path);
  }
}
