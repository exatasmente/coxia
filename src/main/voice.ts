import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Voice } from '../shared/types';

const ROOT = join(import.meta.dirname, '../..');
const PYTHON = join(ROOT, 'sidecar/.venv/bin/python');
const SCRIPT = join(ROOT, 'sidecar/voice_sidecar.py');
const AUDIO = join(tmpdir(), 'cerimonias-audio');

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
let nextId = 1;
const waiting = new Map<number, (r: Reply) => void>();

function sidecar(): ChildProcessWithoutNullStreams {
  if (proc) return proc;
  mkdirSync(AUDIO, { recursive: true });
  proc = spawn(PYTHON, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: proc.stdout }).on('line', (line) => {
    const r = JSON.parse(line) as Reply;
    waiting.get(r.id)?.(r);
    waiting.delete(r.id);
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[voice] ${d}`));
  proc.on('exit', () => {
    proc = null;
    for (const [, resolve] of waiting) resolve({ id: -1, error: 'voice sidecar exited' });
    waiting.clear();
  });
  return proc;
}

function call(req: Record<string, unknown>): Promise<Reply> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve(r)));
    sidecar().stdin.write(`${JSON.stringify({ id, ...req })}\n`);
  });
}

export function startVoice(): void {
  sidecar();
}

export function stopVoice(): void {
  proc?.kill();
}

export async function speak(text: string, voice: Voice): Promise<string> {
  const out = join(AUDIO, `tts-${Date.now()}-${nextId}.mp3`);
  const r = await call({ cmd: 'tts', text, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, out });
  return r.path ?? out;
}

export async function transcribe(audio: ArrayBuffer): Promise<string> {
  const path = join(AUDIO, `stt-${Date.now()}.webm`);
  writeFileSync(path, Buffer.from(audio));
  const r = await call({ cmd: 'stt', path });
  return r.text ?? '';
}
