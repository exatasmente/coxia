// The persona has a name the person chose and a gender nobody asked about: the texts the person reads about it (the chat and the persona's pages) never use a gendered
// pronoun for it. They name it, or say "the persona", or leave the subject out.
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/shared/i18n';

const GENDERED: Record<'pt-BR' | 'en', RegExp> = {
  'pt-BR': /\b(ele|ela|eles|elas|dele|dela|deles|delas|nele|nela)\b/i,
  en: /\b(he|she|him|her|hers|his|himself|herself)\b/i,
};

describe('the texts about the persona', () => {
  it.each(['pt-BR', 'en'] as const)('use no gendered pronoun for it in %s', (language) => {
    const keys = Object.keys(CATALOGS[language]).filter((k) => k.startsWith('ui.chat.') || k.startsWith('ui.persona.'));
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) expect(CATALOGS[language][key], `${language} ${key}`).not.toMatch(GENDERED[language]);
  });

  it('does not give the persona a gender in the prompt it is told who it is', () => {
    expect(CATALOGS['pt-BR']['prompt.sdd.runner.mention.persona.system']).not.toMatch(/\bo representante\b/i);
  });
});
