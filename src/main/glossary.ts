import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GLOSSARY, type Term, sanitizeGlossary, spoken } from '../shared/glossary';
import { getSettings } from './config';
import { ATAS } from './env';
import type { Module } from './module';
import { speak, voicesFor } from './voice';

const FILE = join(ATAS, 'glossario.json');

let cached: Term[] | null = null;

export function glossary(): Term[] {
  if (cached) return cached;
  try {
    cached = existsSync(FILE) ? sanitizeGlossary(JSON.parse(readFileSync(FILE, 'utf8'))) : DEFAULT_GLOSSARY;
  } catch {
    cached = DEFAULT_GLOSSARY;
  }
  return cached;
}

function save(terms: unknown): Term[] {
  const next = sanitizeGlossary(terms);
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
  cached = next;
  return next;
}

async function hear(text: string, terms: unknown): Promise<ArrayBuffer> {
  const { engine } = getSettings().voice;
  const said = spoken(String(text).slice(0, 400), sanitizeGlossary(terms), engine);
  const path = await speak(said, voicesFor(engine).moderator, engine, { prosody: false, glossary: [] });
  const bytes = readFileSync(path);
  unlinkSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export const register: Module = (ctx) => {
  ctx.handle('glossary:get', () => ({ terms: glossary(), defaults: DEFAULT_GLOSSARY }));
  ctx.handle('glossary:save', (terms: unknown) => save(terms));
  // Plays a draft: the terms come from the screen, not from the saved file.
  ctx.handle('glossary:hear', (text: string, terms: unknown) => hear(text, terms));
};
