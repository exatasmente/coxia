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
const templates = [...source.matchAll(/`(ui\.team\.[\w.]*)\$\{[^`]*`/g)].map((m) => new RegExp(`^${m[1].replace(/\./g, '\\.')}`));

describe('the team and cycle catalogs', () => {
  it('define every key the screens name, in both languages', () => {
    expect(literals.size).toBeGreaterThan(30);
    for (const key of literals) {
      expect(CATALOGS['pt-BR'][key], `pt-BR ${key}`).toBeTruthy();
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
    }
  });

  it('hold no key that no screen names', () => {
    const unused = Object.keys(team).filter((k) => !literals.has(k) && !templates.some((re) => re.test(k)));
    expect(unused).toEqual([]);
  });
});
