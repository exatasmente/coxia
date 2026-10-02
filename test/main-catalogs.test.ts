import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MSG_KEYS } from '../src/main/engine/open/messages';
import { CATALOGS, createTranslator } from '../src/shared/i18n';
import mainEn from '../src/shared/i18n/main.en.json';
import mainPt from '../src/shared/i18n/main.pt-BR.json';

const ROOT = join(import.meta.dirname, '..');
const pt = mainPt as Record<string, string>;
const en = mainEn as Record<string, string>;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(ROOT, dir, f));
}

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the main process catalogs (main.*.json)', () => {
  it('define the same keys in both languages, with the same placeholders in each text', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    for (const key of Object.keys(pt)) expect(holes(en[key]), key).toEqual(holes(pt[key]));
  });

  it('have no empty text, and no English text that was left as the Portuguese one', () => {
    for (const key of Object.keys(pt)) {
      expect(pt[key].length, key).toBeGreaterThan(0);
      expect(en[key].length, key).toBeGreaterThan(0);
    }
    // Names, codes and one-word terms are the same in both languages; a sentence never is.
    const same = Object.keys(pt).filter((key) => pt[key] === en[key] && /\s/.test(pt[key].trim()));
    expect(same.sort()).toEqual(['main.efeitos.issueFound', 'main.efeitos.mrFound', 'main.tempo.gateN', 'main.web.json'].sort());
  });

  it('answer every key the code asks for through t(): a typo would show the key on screen', () => {
    const asked = new Set<string>();
    for (const file of [...sources('src/main'), ...sources('src/shared')]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'(main\.[\w.-]+)'/g)) asked.add(m[1]);
    }
    expect(asked.size).toBeGreaterThan(300);
    const known = (key: string) => key in CATALOGS['pt-BR'] || `${key}_one` in CATALOGS['pt-BR'];
    expect([...asked].filter((key) => !known(key))).toEqual([]);
  });

  it('have the keys the code builds from a name: kinds, steps, tasks, voices and the engine messages', () => {
    const groups: Record<string, string[]> = {
      'main.radar.kind': ['same-fix', 'dependency', 'file', 'scope'],
      'main.radar.recommendation': ['same-fix', 'dependency', 'file', 'scope'],
      'main.conflict.step': ['none', 'prepared', 'proposed', 'applied', 'verify-failed', 'push-waiting', 'published', 'appliedNoTests'],
      'main.saude.task': ['status', 'release', 'watchers', 'efeitos', 'retention', 'feedback', 'radar', 'gitlab-quick', 'tempo-export', 'saude-deps'],
      'main.saude.dep': ['glab', 'openrouter-key', 'voice', 'model'],
      'main.retention.kind': ['sessoes', 'historico', 'gates', 'qa', 'retros', 'atividade', 'feedback'],
      'main.retention.app': ['turn', 'unblock', 'gate', 'qa', 'retro', 'teams', 'sync', 'reentry', 'review'],
      'main.tempo.label': ['pre-daily', 'desbloqueio', 'gate', 'qa', 'retro', 'daily'],
      'main.custo.kind': ['turn', 'deep', 'gate', 'qa', 'retro', 'teams', 'release'],
      'main.outbox': ['agent:reply', 'deep:ask', 'gate:answer', 'gate:explain', 'qa:ask', 'retro:ask', 'actions:conflict'],
      'main.retro.digest': ['cerimonias', 'dia', 'atividades', 'decisoes', 'efeitos', 'sem_resposta', 'desbloqueios', 'acoes_de_release', 'tipo', 'estado', 'reteste', 'arquivos', 'rodadas', 'erros', 'mudancas_gitlab'],
      'main.engine': MSG_KEYS as unknown as string[],
    };
    const missing = Object.entries(groups).flatMap(([prefix, names]) => names.map((n) => `${prefix}.${n}`)).filter((key) => !(key in pt));
    expect(missing).toEqual([]);
    // Every hint of the error log is a key too.
    const hints = readFileSync(join(ROOT, 'src/shared/errorlog.ts'), 'utf8').matchAll(/hint: '(main\.errorlog\.hint\.\w+)'/g);
    for (const m of hints) expect(pt, m[1]).toHaveProperty([m[1]]);
  });

  it('read in English through the translator, with a plural where the count says so', () => {
    const tr = createTranslator('en');
    expect(tr('main.actions.newActions', { count: 1 })).toBe('1 new action.');
    expect(tr('main.actions.newActions', { count: 3 })).toBe('3 new actions.');
    expect(createTranslator('pt-BR')('main.actions.newActions', { count: 3 })).toBe('3 ação(ões) nova(s).');
    expect(tr('main.tray.quit')).toBe('Quit');
    expect(createTranslator('pt-BR')('main.tray.quit')).toBe('Sair');
  });
});
