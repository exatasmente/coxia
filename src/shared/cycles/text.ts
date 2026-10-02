import type { Language, WorkspaceConfig } from '../config/types';
import { CATALOGS, FALLBACK_LANGUAGE, NOVOICE_SUFFIX, voiceEnabled, type Params } from '../i18n';

// Text of the development cycle: catalog keys or literals, placeholders, and the way the agents address the person.

/** The catalog entry for a key in a language, falling back to pt-BR (the source language); undefined when nobody has it. */
export function catalogText(key: string, language: Language): string | undefined {
  return CATALOGS[language]?.[key] ?? CATALOGS[FALLBACK_LANGUAGE][key];
}

export function fill(template: string, params?: Params): string {
  return params ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : template;
}

/** The catalog text of a key that has a wording for a conversation without voice: the ".novoice" one while voice is off. */
export function voiceText(key: string, language: Language, voice: boolean = voiceEnabled()): string {
  return (voice ? undefined : catalogText(`${key}${NOVOICE_SUFFIX}`, language)) ?? catalogText(key, language) ?? key;
}

/** A text of the cycle config: a catalog key resolves to the catalog's text in `language`, anything else is a literal. Placeholders are filled either way. */
export function cycleText(value: string, language: Language, params?: Params): string {
  return fill(catalogText(value, language) ?? value, params);
}

const upper = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The words that stand for the person in a prompt. pt-BR needs an article and a contraction ("o Luiz", "do Luiz", "ao Luiz"), which depend on
 * the name's gender, so the config says it (`userArticle`); with no article the name stands alone ("Luiz", "de Luiz", "a Luiz").
 * With no name at all the agents say "o usuário" / "the user".
 */
export function userTerms(language: Language, user: Pick<WorkspaceConfig, 'userName' | 'userArticle'>): Record<string, string> {
  const name = user.userName.trim();
  if (language === 'en') {
    const terms = name
      ? { userName: name, theUser: name, ofUser: `${name}'s`, toUser: name, he: 'they', his: 'their' }
      : { userName: '', theUser: 'the user', ofUser: "the user's", toUser: 'the user', he: 'they', his: 'their' };
    return { ...terms, TheUser: upper(terms.theUser) };
  }
  const a = user.userArticle;
  const terms = !name
    ? { userName: '', theUser: 'o usuário', ofUser: 'do usuário', toUser: 'ao usuário', he: 'a pessoa', his: 'da pessoa' }
    : a === 'o'
      ? { userName: name, theUser: `o ${name}`, ofUser: `do ${name}`, toUser: `ao ${name}`, he: 'ele', his: 'dele' }
      : a === 'a'
        ? { userName: name, theUser: `a ${name}`, ofUser: `da ${name}`, toUser: `à ${name}`, he: 'ela', his: 'dela' }
        : { userName: name, theUser: name, ofUser: `de ${name}`, toUser: `a ${name}`, he: 'a pessoa', his: 'da pessoa' };
  return { ...terms, TheUser: upper(terms.theUser) };
}

/** "a, b and c" / "a, b e c". */
export function joinList(items: string[], language: Language): string {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} ${language === 'en' ? 'and' : 'e'} ${list[list.length - 1]}`;
}

export interface RenderOptions {
  /** Placeholders whose line stays (as an empty line) when the value is empty. By default such a line is dropped. */
  keepEmpty?: string[];
}

/**
 * Fills a multi-line prompt. A line that is nothing but one placeholder, with an empty value, disappears (that is how an optional sentence
 * is left out); the other lines are filled in place.
 */
export function renderLines(template: string, params: Params, options: RenderOptions = {}): string {
  const keep = new Set(options.keepEmpty ?? []);
  return template
    .split('\n')
    .flatMap((line) => {
      const only = /^\{(\w+)\}$/.exec(line);
      if (only && only[1] in params && String(params[only[1]]) === '' && !keep.has(only[1])) return [];
      return [fill(line, params)];
    })
    .join('\n');
}
