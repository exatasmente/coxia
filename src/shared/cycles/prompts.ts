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
