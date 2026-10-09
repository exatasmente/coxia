// The words of a move to another model of the pool: the live line, the thread line's code and params, in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import { type PoolNotice, poolNoticeCode, poolNoticeLine, poolNoticeText } from '../src/main/engine/contract';
import { CATALOGS, setLanguage } from '../src/shared/i18n';
import { messageText } from '../src/shared/forum';

afterEach(() => setLanguage('pt-BR'));

const at = Date.parse('2026-01-01T14:05:00');
const busy: PoolNotice = { from: { label: 'model-a', provider: 'p1' }, to: { label: 'model-b', provider: 'p1' }, reason: 'rate_limit', until: at, activity: 'write' };
const clock = new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

describe('a switch of model, in words', () => {
  it('names the model that was busy, the one that took over and when the first is back, in both languages', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      setLanguage(lang);
      const text = poolNoticeText(busy);
      expect(text, lang).toContain('model-a');
      expect(text, lang).toContain('model-b');
      expect(text, lang).toContain(new Date(at).toLocaleTimeString(lang === 'en' ? 'en' : 'pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }
  });

  it('is a thread line of the agent, whose text reads the same params', () => {
    setLanguage('pt-BR');
    const line = poolNoticeLine('developer', busy);
    expect(line.code).toBe('runner.model.switched');
    expect(line.params).toMatchObject({ agent: 'developer', from: 'model-a', to: 'model-b', time: clock });
    expect(messageText(line)).toContain('developer');
  });

  it('says a move for the kind of work without a time, and names the work', () => {
    setLanguage('en');
    const moved: PoolNotice = { ...busy, reason: 'activity', until: null, activity: 'screen' };
    expect(poolNoticeCode(moved)).toBe('runner.model.moved');
    expect(poolNoticeText(moved)).toContain('the screen');
    expect(poolNoticeText(moved)).not.toContain('rests until');
  });

  it('says a delegation: the main model handed the kind of work to a sub-agent on another model, with no time and no rest', () => {
    const handed: PoolNotice = { from: { label: 'model-a', provider: 'p1' }, to: { label: 'model-b', provider: 'p2' }, reason: 'delegate', until: null, activity: 'edit' };
    expect(poolNoticeCode(handed)).toBe('runner.model.delegated');
    setLanguage('en');
    expect(poolNoticeText(handed)).toBe('The main model (model-a (p1)) handed editing to a sub-agent (model-b (p2)).');
    setLanguage('pt-BR');
    expect(poolNoticeText(handed)).toContain('subagente');
    expect(poolNoticeText(handed)).toContain('a edição');
    const line = poolNoticeLine('developer', handed);
    expect(line.code).toBe('runner.model.delegated');
    expect(line.params).toMatchObject({ agent: 'developer', from: 'model-a (p1)', to: 'model-b (p2)', work: 'a edição' });
    expect(messageText(line)).toContain('developer');
    for (const kind of ['explore', 'edit', 'shell', 'screen'] as const) {
      for (const lang of ['pt-BR', 'en'] as const) {
        setLanguage(lang);
        expect(poolNoticeText({ ...handed, activity: kind }), `${lang} ${kind}`).not.toMatch(/main\.engine\.pool/);
      }
    }
  });

  it('has every key in both catalogs, with the same placeholders', () => {
    const keys = Object.keys(CATALOGS.en).filter((k) => k.startsWith('main.engine.pool.') || k.startsWith('main.forum.code.runner.model.'));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) expect(holes(CATALOGS['pt-BR'][k] ?? ''), k).toEqual(holes(CATALOGS.en[k]));
  });
});
