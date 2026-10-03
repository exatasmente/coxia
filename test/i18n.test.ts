import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGS, createTranslator, getLanguage, normalizeLanguage, setLanguage, subscribeLanguage, t } from '../src/shared/i18n';
import { webAccess, webRefusal } from '../src/main/webPolicy';

const ROOT = join(import.meta.dirname, '..');

describe('translator', () => {
  const catalogs = {
    'pt-BR': { a: 'Olá, {name}', only_pt: 'só em português', n_one: '{count} item', n_other: '{count} itens' },
    en: { a: 'Hello, {name}', n_one: '{count} item', n_other: '{count} items' },
  };

  it('interpolates parameters and leaves an unknown placeholder visible', () => {
    expect(createTranslator('en', catalogs)('a', { name: 'Ana' })).toBe('Hello, Ana');
    expect(createTranslator('en', catalogs)('a', {})).toBe('Hello, {name}');
    expect(createTranslator('pt-BR', catalogs)('a', { name: 'Ana' })).toBe('Olá, Ana');
  });

  it('falls back to pt-BR for a key the language lacks, and to the key itself for one nobody has', () => {
    const en = createTranslator('en', catalogs);
    expect(en('only_pt')).toBe('só em português');
    expect(en('nobody.has.this')).toBe('nobody.has.this');
  });

  it('picks _one or _other from count', () => {
    const en = createTranslator('en', catalogs);
    expect(en('n', { count: 1 })).toBe('1 item');
    expect(en('n', { count: 3 })).toBe('3 items');
    expect(createTranslator('pt-BR', catalogs)('n', { count: 0 })).toBe('0 itens');
  });

  it('normalizes a language tag and defaults to pt-BR', () => {
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('pt')).toBe('pt-BR');
    expect(normalizeLanguage('fr')).toBe('pt-BR');
    expect(normalizeLanguage(undefined)).toBe('pt-BR');
  });
});

describe('the process-wide language', () => {
  it('starts in pt-BR, switches, and tells subscribers', () => {
    let calls = 0;
    const off = subscribeLanguage(() => calls++);
    expect(getLanguage()).toBe('pt-BR');
    expect(t('settings.title')).toBe('Configurações');
    setLanguage('en');
    expect(t('settings.title')).toBe('Settings');
    expect(calls).toBe(1);
    setLanguage('en');
    expect(calls).toBe(1);
    setLanguage('pt-BR');
    off();
    expect(t('settings.models.title')).toBe('Modelos');
  });
});

describe('catalogs', () => {
  it('define the same keys in both languages, and every {placeholder} appears in both', () => {
    const pt = Object.keys(CATALOGS['pt-BR']).sort();
    const en = Object.keys(CATALOGS.en).sort();
    expect(en).toEqual(pt);
    const holes = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].toLowerCase().replace(/^(cr|crlong)s$/, '$1')))].sort();
    // The English text of this key never named the host ("Quick code host actions"), and a GitLab workspace keeps reading it that way.
    const neutralInEnglish = new Set(['main.saude.task.gitlab-quick']);
    for (const key of pt.filter((k) => !neutralInEnglish.has(k))) expect(holes(CATALOGS.en[key]), key).toEqual(holes(CATALOGS['pt-BR'][key]));
  });

  it('the Settings headings go through t(): the screen has no literal heading left', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/screens/Settings.tsx'), 'utf8');
    for (const heading of ['Configurações', 'Modelos', 'Ferramentas dos agentes', 'Voz', 'Agenda e notificações', 'Aparência', 'Início']) {
      expect(src).not.toMatch(new RegExp(`<h[12][^>]*>${heading}</h[12]>`));
    }
    expect((src.match(/t\('settings\.[\w.]+title'\)/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
});

describe('the lint script', () => {
  // Each run parses the whole renderer; under a loaded suite that can pass the default 5 s.
  const SLOW = { timeout: 60_000 };

  const lint = (...args: string[]) => execFileSync('node', [join(ROOT, 'scripts/i18n-lint.mjs'), ...args], { encoding: 'utf8' });

  it('checks that both catalogs define the same keys', SLOW, () => {
    expect(lint('--keys', '--scope', 'renderer')).toMatch(/i18n keys: \d+ in both languages/);
  });

  it('refuses a scope it does not know', SLOW, () => {
    expect(() => lint('--scope', 'nowhere')).toThrow();
  });
});

describe('web policy for the configuration channels', () => {
  it('lets a paired browser read the config and its schema, and nothing that writes, stores a secret or touches files', () => {
    expect(webAccess('config:get')).toBe('allow');
    expect(webAccess('config:schema')).toBe('allow');
    expect(webAccess('config:validate')).toBe('allow');
    for (const channel of ['config:save', 'config:secret-set', 'config:secret-remove', 'config:secret-check', 'config:secrets-accept-insecure', 'config:export', 'config:import-pick', 'config:import-preview', 'config:import-apply']) {
      expect(webAccess(channel), channel).toBe('deny');
      expect(webRefusal(channel, true)).toMatch(/só funciona na janela do app/);
    }
  });
});
