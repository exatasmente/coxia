import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The list of captures is the file the README, the pages and the site reference images through. It must name a script that
// exists, cover the five screens the README already promised, and stay valid JSON. Nothing here opens the app.

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): unknown => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

interface Feature {
  id: string;
  title: Record<string, string>;
  script: string;
  screens: string[];
  langs: string[];
  theme: string;
  usedIn: string[];
}

const features = (): Feature[] => {
  const index = read('scripts/captures/index.json') as Feature[] | { features: Feature[] };
  return Array.isArray(index) ? index : index.features;
};

describe('the list of captures', () => {
  it('names a script that exists for every feature', () => {
    const list = features();
    expect(list.map((f) => f.id)).toEqual(['today', 'call', 'actions', 'wizard', 'phone']);
    for (const f of list) expect(existsSync(join(ROOT, 'scripts/captures', f.script)), f.script).toBe(true);
  });

  it('covers the five captures the README promises, each in both languages and one theme', () => {
    const list = features();
    for (const f of list) {
      expect(f.title['pt-BR'], f.id).toBeTruthy();
      expect(f.title.en, f.id).toBeTruthy();
      expect(f.langs, f.id).toEqual(['pt-BR', 'en']);
      expect(f.theme, f.id).toBe('light');
      expect(f.usedIn.length, f.id).toBeGreaterThan(0);
      expect(f.screens.length, f.id).toBeGreaterThan(0);
    }
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const f of list) expect(readme, f.id).toContain(`docs/images/${f.id}.png`);
  });
});
