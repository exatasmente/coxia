import { LANGUAGES, type DevCycleConfig, type Language, type PromptOverride, type PromptRole } from '../config/types';
import { CATALOGS, keyCandidates, kindSuffix, NOVOICE_SUFFIX, voiceEnabled, type Params } from '../i18n';
import { CYCLE_VARIANTS } from '../i18n/terms';
import { catalogText, renderLines, type RenderOptions } from './text';

// The prompts of the ceremonies. Every text lives in the i18n catalogs under `prompt.<family>.<id>` (pt-BR and en); a cycle picks the family of
// each role (`devCycle.prompts`) and may replace any single text per language (`devCycle.promptOverrides`). A family only holds the texts that
// differ from the "sdd" family, which is complete: a lookup that finds nothing in the chosen family falls back to it.
//
// Prompt ids are "<head>.<name>". The head says which role family the text belongs to (HEAD_ROLE). Texts are templates with {placeholders};
// the placeholders every text can use are in main/cyclePrompts.ts, the ones of a single text are named where it is rendered.

export const BASE_FAMILY = 'sdd';

// Which role (and so which family choice) a prompt id belongs to. An id with a head that is not here is read from the base family.
export const HEAD_ROLE: Record<string, PromptRole> = {
  turn: 'turn',
  reply: 'reply',
  deep: 'deep',
  teams: 'teams',
  gate: 'gate',
  qa: 'qa',
  reentry: 'qa',
  discussion: 'qa',
  retro: 'retro',
  conflict: 'conflict',
  release: 'conflict',
};

export const catalogKey = (family: string, id: string): string => `prompt.${family}.${id}`;

/** The family a prompt id is read from in this cycle. */
export function familyOf(cycle: Pick<DevCycleConfig, 'prompts'>, id: string): string {
  const role = HEAD_ROLE[id.split('.')[0]];
  return (role && cycle.prompts[role]) || BASE_FAMILY;
}

/** The prompt families the catalogs define, with the ids each one has. */
export function promptFamilies(language: Language = 'pt-BR'): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(CATALOGS[language] ?? {})) {
    const m = /^prompt\.([\w-]+)\.(.+)$/.exec(key);
    if (m) (out[m[1]] ??= []).push(m[2]);
  }
  return out;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const openerCache = new Map<string, RegExp[]>();

/**
 * Regular expressions that recognise how a prompt begins, whatever the family, the language, the person's name or the ceremony label put in the
 * placeholders. The app tells its own sessions apart from the person's by the first prompt (cost and retention screens), so a reworded or
 * translated prompt must still be recognised: the patterns are built from the catalogs, never written by hand.
 */
export function openersOf(id: string): RegExp[] {
  const cached = openerCache.get(id);
  if (cached) return cached;
  const sources = new Set<string>();
  for (const catalog of Object.values(CATALOGS)) {
    for (const [key, template] of Object.entries(catalog)) {
      const m = /^prompt\.[\w-]+\.(.+)$/.exec(key);
      if (!m || m[1] !== id) continue;
      // The first line that is more than a placeholder (the leading ones may be optional context).
      const line = template.split('\n').find((l) => l.replace(/\{\w+\}/g, '').trim().length >= 8);
      if (!line) continue;
      let literal = 0;
      let source = '';
      let pending = '';
      // Just enough of the line to tell it from the others: a placeholder stands for any short text, the literal stops after about 14-24 characters.
      for (const part of line.split(/(\{\w+\})/)) {
        if (!part) continue;
        if (/^\{\w+\}$/.test(part)) {
          pending += '[^\\n]{0,80}?';
          continue;
        }
        const take = part.slice(0, 24 - literal);
        source += pending + escapeRe(take);
        pending = '';
        literal += take.length;
        if (literal >= 14) break;
      }
      sources.add(`^\\s*${source}`);
    }
  }
  const list = [...sources].map((s) => new RegExp(s));
  openerCache.set(id, list);
  return list;
}

const refCache = new Map<string, RegExp[]>();

/**
 * Like openersOf, for prompts whose first line carries the card ref ("... da atividade {ref} ..."): each expression captures the ref in group 1.
 * Templates whose first line has no {ref} yield nothing.
 */
export function refOpenersOf(id: string): RegExp[] {
  const cached = refCache.get(id);
  if (cached) return cached;
  const sources = new Set<string>();
  for (const catalog of Object.values(CATALOGS)) {
    for (const [key, template] of Object.entries(catalog)) {
      const m = /^prompt\.[\w-]+\.(.+)$/.exec(key);
      if (!m || m[1] !== id) continue;
      const line = template.split('\n').find((l) => l.replace(/\{\w+\}/g, '').trim().length >= 8);
      const at = line ? line.indexOf('{ref}') : -1;
      if (!line || at < 0) continue;
      const before = line
        .slice(0, at)
        .split(/(\{\w+\})/)
        .map((part) => (/^\{\w+\}$/.test(part) ? '[^\\n]{0,80}?' : escapeRe(part)))
        .join('');
      sources.add(`^\\s*${before}(\\S+?)[ .,:;]`);
    }
  }
  const list = [...sources].map((s) => new RegExp(s));
  refCache.set(id, list);
  return list;
}

/**
 * The template of a prompt: the cycle's override for the language, else the text of the role's family, else the base family's.
 * Undefined when no text exists anywhere (a typo in an id).
 */
export function promptTemplate(cycle: Pick<DevCycleConfig, 'prompts' | 'promptOverrides'>, id: string, language: Language, voice: boolean = voiceEnabled()): string | undefined {
  const override = cycle.promptOverrides[id]?.[language];
  if (override !== undefined) return override;
  // With voice off a text may have its own wording (the key plus ".novoice"): the one that says nothing about speaking or listening.
  // For a host it may have one more (the key plus ".github"), which comes before the plain text.
  const find = (key: string): string | undefined => keyCandidates(key, voice).reduce<string | undefined>((found, candidate) => found ?? catalogText(candidate, language), undefined);
  return find(catalogKey(familyOf(cycle, id), id)) ?? find(catalogKey(BASE_FAMILY, id));
}

// The suffixes a catalog key carries for another wording of the same text (voice off, a host, a cycle variant): they are not ids of their own, and an
// override of the id replaces every one of them.
const VARIANT_SUFFIX = new RegExp(`(${escapeRe(NOVOICE_SUFFIX)}|${escapeRe(kindSuffix(''))}[\\w-]+|${CYCLE_VARIANTS.map((v) => escapeRe(`.${v}`)).join('|')})$`);

/** The id a prompt catalog key stands for: the key without its family and without the suffixes of its variants. Null for a key that is not a prompt. */
export function promptIdOf(key: string): string | null {
  const m = /^prompt\.[\w-]+\.(.+)$/.exec(key);
  if (!m) return null;
  let id = m[1];
  for (let next = id.replace(VARIANT_SUFFIX, ''); next !== id; next = id.replace(VARIANT_SUFFIX, '')) id = next;
  return id;
}

/** Every prompt id the catalogs have, in any family and any language, sorted. Read from the catalogs each time: a text added later is listed without a list to keep. */
export function promptIds(): string[] {
  const ids = new Set<string>();
  for (const catalog of Object.values(CATALOGS)) {
    for (const key of Object.keys(catalog)) {
      const id = promptIdOf(key);
      if (id) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** One prompt as the prompt editor shows it: the family it is read from in this cycle, the text the app uses without an override, and the override. */
export interface PromptEntry {
  id: string;
  family: string;
  defaults: Partial<Record<Language, string>>;
  override: PromptOverride;
}

/** The prompts of the catalogs with what this cycle makes of them, for the given voice mode (the default text is the one the app sends now). */
export function promptEntries(cycle: Pick<DevCycleConfig, 'prompts' | 'promptOverrides'>, voice: boolean = voiceEnabled()): PromptEntry[] {
  const plain = { prompts: cycle.prompts, promptOverrides: {} };
  return promptIds().map((id) => {
    const defaults: Partial<Record<Language, string>> = {};
    for (const language of LANGUAGES) {
      const text = promptTemplate(plain, id, language, voice);
      if (text !== undefined) defaults[language] = text;
    }
    return { id, family: familyOf(cycle, id), defaults, override: { ...cycle.promptOverrides[id] } };
  });
}

/**
 * The cycle's overrides with one text changed: a string replaces the prompt in that language (an empty one included), null goes back to the catalog's text.
 * An id left with no language is dropped. Throws for an id the catalogs do not have: an override of it would never be read.
 */
export function withPromptOverride(overrides: Record<string, PromptOverride>, id: string, language: Language, text: string | null): Record<string, PromptOverride> {
  // i18n-ignore: developer error
  if (!promptIds().includes(id)) throw new Error(`unknown prompt: ${id}`);
  const entry: PromptOverride = { ...overrides[id] };
  if (text === null) delete entry[language];
  else entry[language] = text;
  const next = { ...overrides };
  if (Object.keys(entry).length) next[id] = entry;
  else delete next[id];
  return next;
}

/** The template filled with the params. A missing id throws: it is a bug in the code, and a silent empty prompt would hide it. */
export function renderPrompt(cycle: Pick<DevCycleConfig, 'prompts' | 'promptOverrides'>, id: string, language: Language, params: Params = {}, options?: RenderOptions): string {
  const template = promptTemplate(cycle, id, language);
  // i18n-ignore: developer error
  if (template === undefined) throw new Error(`unknown prompt: ${id}`);
  return renderLines(template, params, options);
}
