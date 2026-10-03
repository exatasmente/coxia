import { describe, expect, it } from 'vitest';
import { termsFor } from '../src/shared/cycles';
import { defaultTerms, type Terms } from '../src/shared/i18n/terms';
import { createTermsLoader, isTerms, parseTermsCache, serializeTermsCache } from '../src/shared/i18n/termsCache';
import type { Language } from '../src/shared/config/types';
import { hostConfig } from './helpers/config';

// The renderer's cache of a workspace's terms: only for the workspace and language it was built for, only with the shape of a Terms, and never
// left on screen when the workspace's own view cannot be loaded.

const github = (language: Language = 'en'): Terms => termsFor(hostConfig('github', { language }), language);

describe('what a cache may hold', () => {
  it('accepts the terms a workspace builds', () => {
    for (const language of ['pt-BR', 'en'] as const) for (const kind of ['gitlab', 'github', 'bitbucket', null] as const) expect(isTerms(termsFor(hostConfig(kind, { language }), language), language)).toBe(true);
  });

  it('refuses a shape that is not a Terms', () => {
    const good = github();
    expect(isTerms(null, 'en')).toBe(false);
    expect(isTerms('x', 'en')).toBe(false);
    expect(isTerms({ ...good, words: null }, 'en')).toBe(false);
    expect(isTerms({ ...good, words: [] }, 'en')).toBe(false);
    expect(isTerms({ ...good, words: { ...good.words, cr: 7 } }, 'en')).toBe(false);
    expect(isTerms({ kind: good.kind, flags: good.flags }, 'en')).toBe(false);
    expect(isTerms({ ...good, kind: 'svn' }, 'en')).toBe(false);
    expect(isTerms({ ...good, flags: 'off-sdd' }, 'en')).toBe(false);
    expect(isTerms({ ...good, flags: ['nonsense'] }, 'en')).toBe(false);
    const { cr: _cr, ...missing } = good.words;
    expect(isTerms({ ...good, words: missing }, 'en')).toBe(false);
  });

  it('refuses the cache of an older build, which had no variants', () => {
    const { flags: _flags, ...old } = github();
    expect(isTerms(old, 'en')).toBe(false);
  });
});

describe('reading a cache back', () => {
  const stored = serializeTermsCache('main', 'en', github());

  it('gives the terms of the same workspace and language', () => {
    expect(parseTermsCache(stored, { workspaceId: 'main', language: 'en' })).toEqual(github());
  });

  it('ignores the cache of another workspace or another language', () => {
    expect(parseTermsCache(stored, { workspaceId: 'other', language: 'en' })).toBeNull();
    expect(parseTermsCache(stored, { workspaceId: 'main', language: 'pt-BR' })).toBeNull();
  });

  it('ignores a cache of the old layout, text that is not JSON and a missing one', () => {
    expect(parseTermsCache(JSON.stringify({ language: 'en', terms: github() }), { workspaceId: 'main', language: 'en' })).toBeNull();
    expect(parseTermsCache('{not json', { workspaceId: 'main', language: 'en' })).toBeNull();
    expect(parseTermsCache('null', { workspaceId: 'main', language: 'en' })).toBeNull();
    expect(parseTermsCache(null, { workspaceId: 'main', language: 'en' })).toBeNull();
    expect(parseTermsCache(JSON.stringify({ workspaceId: 'main', language: 'en', terms: { kind: null, flags: [], words: 'x' } }), { workspaceId: 'main', language: 'en' })).toBeNull();
  });
});

describe('the terms of the first moments', () => {
  function rig(initial: string | null, language: Language = 'en') {
    let stored = initial;
    let terms: Terms = defaultTerms(language);
    const calls: string[] = [];
    const loader = createTermsLoader({
      read: () => stored,
      write: (text) => {
        stored = text;
      },
      setTerms: (t) => {
        terms = t;
        calls.push('set');
      },
      resetTerms: () => {
        terms = defaultTerms(language);
        calls.push('reset');
      },
      getLanguage: () => language,
    });
    return { loader, terms: () => terms, stored: () => stored, calls };
  }

  it('uses the cache of the running workspace until its view answers, and the view replaces it and refreshes the cache', () => {
    const r = rig(serializeTermsCache('main', 'en', github()));
    r.loader.workspaceKnown('main');
    expect(r.terms().words.cr).toBe('PR');
    const gitlab = termsFor(hostConfig('gitlab'), 'en');
    r.loader.fromView(gitlab, 'main');
    expect(r.terms().words.cr).toBe('MR');
    expect(parseTermsCache(r.stored(), { workspaceId: 'main', language: 'en' })).toEqual(gitlab);
  });

  it('does not use the cache of another workspace', () => {
    const r = rig(serializeTermsCache('other', 'en', github()));
    r.loader.workspaceKnown('main');
    expect(r.terms().words.cr).toBe('MR');
    expect(r.calls).toEqual([]);
  });

  it('does not put the cache over a view that already answered', () => {
    const r = rig(serializeTermsCache('main', 'en', github()));
    r.loader.fromView(termsFor(hostConfig('gitlab'), 'en'), 'main');
    r.loader.workspaceKnown('main');
    expect(r.terms().words.cr).toBe('MR');
  });

  it('falls back to the defaults when the view cannot be loaded, and the cache does not come back after', () => {
    const r = rig(serializeTermsCache('main', 'en', github()));
    r.loader.workspaceKnown('main');
    expect(r.terms().words.cr).toBe('PR');
    r.loader.viewFailed();
    expect(r.terms()).toEqual(defaultTerms('en'));
    r.loader.workspaceKnown('main');
    expect(r.terms()).toEqual(defaultTerms('en'));
  });

  it('keeps the terms of a view that loaded when a later reload fails', () => {
    const r = rig(null);
    r.loader.fromView(github(), 'main');
    r.loader.viewFailed();
    expect(r.terms().words.cr).toBe('PR');
    expect(r.calls).toEqual(['set']);
  });

  it('writes no cache for a view that does not say its workspace', () => {
    const r = rig(null);
    r.loader.fromView(github(), null);
    expect(r.stored()).toBeNull();
  });
});
