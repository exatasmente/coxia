import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, createVoiceTranslator, setLanguage, setVoiceEnabled, t, tv } from '../src/shared/i18n';
import { UI_EN, UI_PT_BR } from '../src/shared/i18n/ui';
import { intlLocale, tNodes, withNodes } from '../src/renderer/src/i18n';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has no window.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});

const ROOT = join(import.meta.dirname, '..');
const I18N_DIR = join(ROOT, 'src/shared/i18n');
const RENDERER = join(ROOT, 'src/renderer/src');

const holes = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const SOURCES = walk(RENDERER).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
const USED = new Set(SOURCES.flatMap(({ text }) => [...text.matchAll(/'(ui\.[\w.-]+)'/g)].map((m) => m[1])));

afterEach(() => {
  setLanguage('pt-BR');
  setVoiceEnabled(true);
});

describe('the ui catalogs', () => {
  it('have an English twin with the same keys and the same {placeholders}', () => {
    expect(Object.keys(UI_EN).sort()).toEqual(Object.keys(UI_PT_BR).sort());
    for (const key of Object.keys(UI_PT_BR)) expect(holes(UI_EN[key]), key).toEqual(holes(UI_PT_BR[key]));
  });

  it('are registered in the shared catalogs, and every ui-*.json file is part of them', () => {
    const files = readdirSync(I18N_DIR).filter((n) => /^ui-.+\.(pt-BR|en)\.json$/.test(n));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const lang = file.endsWith('.pt-BR.json') ? 'pt-BR' : 'en';
      const keys = Object.keys(JSON.parse(readFileSync(join(I18N_DIR, file), 'utf8')));
      for (const key of keys) expect(CATALOGS[lang][key], `${file}: ${key}`).toBeDefined();
    }
  });

  it('keep every key sorted and namespaced by screen', () => {
    for (const file of readdirSync(I18N_DIR).filter((n) => /^ui-.+\.json$/.test(n))) {
      const keys = Object.keys(JSON.parse(readFileSync(join(I18N_DIR, file), 'utf8')));
      expect(keys.every((k) => k.startsWith('ui.')), file).toBe(true);
      expect(keys, file).toEqual([...keys].sort());
    }
  });

  it('are not empty: no value is blank, and an English value is not the pt-BR one unless it is a name', () => {
    const same: string[] = [];
    for (const key of Object.keys(UI_PT_BR)) {
      expect(UI_PT_BR[key].trim(), key).not.toBe('');
      expect(UI_EN[key].trim(), key).not.toBe('');
      if (UI_EN[key] === UI_PT_BR[key] && /[ãõçáéíóúâêô]/i.test(UI_EN[key])) same.push(key);
    }
    expect(same, 'English text that still has Portuguese letters').toEqual([]);
  });
});

describe('the renderer sources', () => {
  it('only use ui.* keys that exist in both languages', () => {
    const has = (catalog: Record<string, string>, key: string) => key in catalog || `${key}_one` in catalog;
    const missing = [...USED].filter((key) => !has(UI_PT_BR, key) || !has(UI_EN, key));
    expect(missing).toEqual([]);
  });

  it('leave no ui.* key unused (a key counts as used through its .novoice or _one/_other siblings too)', () => {
    const used = (key: string) => {
      const base = key.replace(/\.(novoice|on-github|on-gitlab|on-bitbucket)$/, '').replace(/_(one|other)$/, '');
      return USED.has(key) || USED.has(base) || USED.has(`${base}.novoice`);
    };
    expect(Object.keys(UI_PT_BR).filter((key) => !used(key))).toEqual([]);
  });

  it('pair every host variant with its plain wording and keep its placeholders', () => {
    for (const key of Object.keys(UI_PT_BR).filter((k) => /\.on-(github|gitlab|bitbucket)$/.test(k))) {
      const base = key.replace(/\.on-[a-z]+$/, '');
      expect(base in UI_PT_BR, key).toBe(true);
      expect(holes(UI_PT_BR[key]), key).toEqual(holes(UI_PT_BR[base]));
    }
  });

  it('pair every .novoice variant with its voice wording', () => {
    for (const key of Object.keys(UI_PT_BR).filter((k) => k.endsWith('.novoice'))) expect(key.replace(/\.novoice$/, '') in UI_PT_BR, key).toBe(true);
  });

  it('never hand a hard-coded locale to Intl or toLocale*String', () => {
    const offenders = SOURCES.filter(({ text }) => /(toLocale\w*String|localeCompare|Intl\.\w+)\(\s*['"](pt|en)(-[A-Za-z]+)?['"]/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('switching the language', () => {
  it('turns a ui key into English and back, and keeps the voice wording', () => {
    const key = Object.keys(UI_PT_BR).find((k) => !k.endsWith('.novoice') && holes(UI_PT_BR[k]).length === 0) as string;
    expect(t(key)).toBe(UI_PT_BR[key]);
    setLanguage('en');
    expect(t(key)).toBe(UI_EN[key]);
    setLanguage('pt-BR');
    expect(t(key)).toBe(UI_PT_BR[key]);

    const voiceKey = Object.keys(UI_EN).find((k) => k.endsWith('.novoice'));
    if (voiceKey) {
      const base = voiceKey.replace(/\.novoice$/, '');
      setLanguage('en');
      setVoiceEnabled(false);
      expect(tv(base)).toBe(UI_EN[voiceKey]);
      setVoiceEnabled(true);
      expect(tv(base)).toBe(UI_EN[base]);
    }
    expect(createVoiceTranslator('en', false)('ui.nobody.has.this')).toBe('ui.nobody.has.this');
  });

  it('formats dates with the language in force', () => {
    const day = new Date(2026, 8, 17, 14, 5);
    expect(intlLocale()).toBe('pt-BR');
    expect(day.toLocaleDateString(intlLocale(), { weekday: 'long' })).toBe('quinta-feira');
    setLanguage('en');
    expect(intlLocale()).toBe('en-US');
    expect(day.toLocaleDateString(intlLocale(), { weekday: 'long' })).toBe('Thursday');
    expect(day.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })).toMatch(/2:05/);
  });

  it('puts React nodes into the {placeholders} of a sentence', () => {
    const html = (node: unknown) => renderToStaticMarkup(createElement('p', null, node as never));
    expect(html(withNodes('Press {key} to open {name}', { key: createElement('kbd', null, 'F1') }))).toBe('<p>Press <kbd>F1</kbd> to open {name}</p>');
    expect(html(tNodes('ui.nobody.has.this', {}))).toBe('<p>ui.nobody.has.this</p>');
  });
});

describe('the lint script', () => {
  // Each run parses the whole renderer; under a loaded suite that can pass the default 5 s.
  const SLOW = { timeout: 60_000 };

  const lint = (...args: string[]) => execFileSync('node', [join(ROOT, 'scripts/i18n-lint.mjs'), ...args], { encoding: 'utf8' });

  it('finds no untranslated literal in the renderer, and the catalogs agree', SLOW, () => {
    expect(lint('--scope', 'renderer', '--max', '0', '--keys')).toMatch(/0\s+total in 0 file/);
  });

  it('flags what a person reads and lets the machine text and the ignore comments through', SLOW, () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
    try {
      writeFileSync(
        join(dir, 'Sample.tsx'),
        [
          "import { t } from './i18n';",
          'export function Sample({ n, on }: { n: number; on: boolean }) {',
          "  const state = on === true ? 'open' : 'closed';",
          "  const day = new Date().toLocaleDateString('pt-BR');",
          '  return (',
          '    <div className="box wide" id="main">',
          '      <h1>Configurações</h1>',
          "      <button type=\"button\" title=\"Fechar a janela\" aria-label={t('ui.x.close')}>Salvar</button>",
          '      <p>{`${n} agentes prontos`}</p>',
          "      <input placeholder='Buscar' data-kind=\"free text\" />",
          "      <span className={`pill ${state}`}>{on ? 'Ligado' : t('ui.x.off')}</span>",
          "      <code>{'font-family: Inter, sans-serif'}</code> {/* i18n-ignore */}",
          '    </div>',
          '  );',
          '}',
          '',
        ].join('\n'),
      );
      const report = JSON.parse(lint('--dir', dir, '--json')) as Record<string, { line: number; text: string }[]>;
      const texts = Object.values(report).flat().map((f) => f.text);
      expect(texts).toEqual(expect.arrayContaining(['Configurações', 'Fechar a janela', 'Salvar', '${} agentes prontos', 'Buscar', 'Ligado']));
      expect(texts.some((x) => x.startsWith("hard-coded locale 'pt-BR'"))).toBe(true);
      for (const quiet of ['box wide', 'main', 'free text', 'open', 'closed', 'ui.x.close', 'ui.x.off']) expect(texts).not.toContain(quiet);
      expect(texts.some((x) => x.includes('sans-serif'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero above the allowed total, so it can gate CI', SLOW, () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-lint-'));
    try {
      writeFileSync(join(dir, 'A.tsx'), 'export const A = () => <p>Olá, mundo</p>;\n');
      expect(() => lint('--dir', dir, '--max', '0')).toThrow();
      expect(lint('--dir', dir, '--max', '1')).toMatch(/total in 1 file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
