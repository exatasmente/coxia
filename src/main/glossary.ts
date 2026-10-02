import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GLOSSARY, type Term, sanitizeGlossary, spoken } from '../shared/glossary';
import { learn } from '../shared/glossaryLearn';
import { getSettings } from './config';
import { DATA_ROOT } from './env';
import type { Module } from './module';
import { planSpeech, speakSegment, voicesFor } from './voice';

const FILE = join(DATA_ROOT, 'glossario.json');

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
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
  cached = next;
  return next;
}

async function hear(text: string, terms: unknown): Promise<ArrayBuffer> {
  const { engine } = getSettings().voice;
  const said = spoken(String(text).slice(0, 400), sanitizeGlossary(terms), engine);
  const [segment] = planSpeech(said, voicesFor(engine).moderator, engine, { prosody: false, glossary: [] });
  return segment ? speakSegment('glossary', segment) : new ArrayBuffer(0);
}

export const register: Module = (ctx) => {
  ctx.handle('glossary:get', () => ({ terms: glossary(), defaults: DEFAULT_GLOSSARY }));
  ctx.handle('glossary:save', (terms: unknown) => save(terms));
  // Plays a draft: the terms come from the screen, not from the saved file.
  // One click on a corrected transcription: adds the variant to its term (or creates the term).
  ctx.handle('glossary:learn', (heard: unknown, term: unknown) => {
    if (typeof heard !== 'string' || typeof term !== 'string' || !heard.trim() || !term.trim()) throw new Error('Correção inválida.');
    return save(learn(glossary(), { heard, term }));
  });
  ctx.handle('glossary:hear', (text: string, terms: unknown) => hear(text, terms));
};
