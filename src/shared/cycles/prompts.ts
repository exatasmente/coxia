import type { DevCycleConfig, Language, PromptRole } from '../config/types';
import { CATALOGS, type Params } from '../i18n';
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
export function promptTemplate(cycle: Pick<DevCycleConfig, 'prompts' | 'promptOverrides'>, id: string, language: Language): string | undefined {
  const override = cycle.promptOverrides[id]?.[language];
  if (override !== undefined) return override;
  return catalogText(catalogKey(familyOf(cycle, id), id), language) ?? catalogText(catalogKey(BASE_FAMILY, id), language);
}

/** The template filled with the params. A missing id throws: it is a bug in the code, and a silent empty prompt would hide it. */
export function renderPrompt(cycle: Pick<DevCycleConfig, 'prompts' | 'promptOverrides'>, id: string, language: Language, params: Params = {}, options?: RenderOptions): string {
  const template = promptTemplate(cycle, id, language);
  if (template === undefined) throw new Error(`prompt desconhecido: ${id}`);
  return renderLines(template, params, options);
}
