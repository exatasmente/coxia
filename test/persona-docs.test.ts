// What the persona's documentation says (#248): it no longer says the persona only chats or approves nothing, in either language, names the eleven tools, the Audit and the Stop, and
// its own links to its sections land on a heading. The README rows say it acts too. Reads the repository's own documents, nothing of the computer's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONA_TOOLS } from '../src/shared/personaTools';

const root = join(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const doc = read('docs/persona.md');
const [pt, en] = [doc.slice(doc.indexOf('## Português'), doc.indexOf('## English')), doc.slice(doc.indexOf('## English'))];

/** The anchor GitHub makes of a heading. */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
const anchors = (text: string): Set<string> => new Set([...text.matchAll(/^#{1,4} (.+)$/gm)].map((m) => slug(m[1])));

describe('docs/persona.md', () => {
  it('has both languages, and neither says the persona only chats or approves nothing', () => {
    expect(pt.length).toBeGreaterThan(1000);
    expect(en.length).toBeGreaterThan(1000);
    // (the test copy in the wizard does only talk, and the text says so)
    expect(pt).not.toMatch(/ela \*\*só conversa|Ela não aprova nada|Nesta versão ela/i);
    expect(en).not.toMatch(/it \*\*only chats|It approves nothing|In this version it/i);
    expect(pt).toMatch(/age no app por você/);
    expect(en).toMatch(/acts in the app for you/);
  });

  it('says what the persona does, the Audit and the Stop, in both languages, with the eleven tools in a table', () => {
    for (const [language, text] of [['pt', pt], ['en', en]] as const) {
      for (const name of PERSONA_TOOLS) expect(text, `${language} ${name}`).toContain(`\`${name}\``);
      expect(text, language).toContain('persona-latch.json');
      expect(text, language).toContain('`why`');
    }
    expect(pt).toMatch(/### O que a persona faz[\s\S]*### A Auditoria[\s\S]*### O Parar/);
    expect(en).toMatch(/### What the persona does[\s\S]*### The Audit[\s\S]*### The Stop/);
  });

  it('keeps every link to one of its own sections pointing at a heading', () => {
    const have = anchors(doc);
    const links = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(4);
    for (const link of links) expect(have, link).toContain(link);
  });

  it('is the README\'s account too: the persona acts, in English and in Portuguese', () => {
    expect(read('README.md')).not.toMatch(/It only chats and reads/);
    expect(read('README.pt-BR.md')).not.toMatch(/ela só conversa e lê/);
    expect(read('README.md')).toMatch(/acts in the app on your behalf/);
    expect(read('README.pt-BR.md')).toMatch(/age no app por você/);
  });
});
