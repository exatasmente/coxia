import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/shared/i18n';
import team from '../src/shared/i18n/ui-team.en.json';

// The team and cycle screens keep their texts in ui-team.*.json. A key the code names must exist in both languages, and a key nobody names is dead weight.

const DIR = join(__dirname, '../src/renderer/src/screens/team');
const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
const source = files.map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');

// Literal keys, and the template ones (`ui.team.tab.${id}`) as patterns.
const literals = new Set([...source.matchAll(/['"`](ui\.[a-zA-Z0-9]+\.[\w.]*[\w])['"`]/g)].map((m) => m[1]));
const templates = [...source.matchAll(/`(ui\.[a-z]+\.[\w.]*)\$\{[^`]*`/g)].map((m) => new RegExp(`^${m[1].replace(/\./g, '\\.')}`));

describe('the team and cycle catalogs', () => {
  it('define every key the screens name, in both languages', () => {
    expect(literals.size).toBeGreaterThan(30);
    for (const key of literals) {
      for (const language of ['pt-BR', 'en'] as const) expect(CATALOGS[language][key] ?? CATALOGS[language][`${key}_other`], `${language} ${key}`).toBeTruthy();
    }
  });

  it('hold no key that no screen names', () => {
    // A plural key (`_one`, `_other`) is named by its plain key.
    const named = (k: string) => literals.has(k) || literals.has(k.replace(/_(one|other)$/, '')) || templates.some((re) => re.test(k));
    const unused = Object.keys(team).filter((k) => !named(k));
    expect(unused).toEqual([]);
  });
});
