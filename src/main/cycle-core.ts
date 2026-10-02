import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CeremonyId, DevCycleConfig, Language } from '../shared/config/types';
import { BUILT_IN_TEMPLATES, applyTemplate, builtInTemplate, cycleOf, cycleText, exportTemplateText, parseTemplate, templateFromConfig, buildCycleView, ceremonyAvailable, type ApplyOptions, type CycleTemplate, type CycleView, type TemplateCheck, type TemplateSummary, type ViewContext } from '../shared/cycles';
import { DATA_ROOT } from './env';
import { getConfig, rc, saveConfig } from './workspaceConfig';

// The development-cycle templates of this machine: the ones that ship with the app, and the ones a person imported (one JSON file each in
// <data>/cycle-templates). Applying one rewrites the `devCycle` section of the running workspace's config and nothing else.

export const TEMPLATES_DIR = join(DATA_ROOT, 'cycle-templates');

/** What the cycle depends on in this workspace: whether there is a specs folder, which tool stores card notes. */
export function viewContext(): ViewContext {
  const tool = rc().cardSource?.command;
  return { specs: !!rc().specsDir, noteTool: tool ? basename(tool) : null };
}

export function cycleView(): CycleView {
  return buildCycleView(getConfig(), viewContext());
}

/** Whether a ceremony is offered right now: on in the cycle and with what it needs in place. */
export function cycleOn(id: CeremonyId): boolean {
  return ceremonyAvailable(getConfig().devCycle, id, viewContext());
}

function readUserTemplates(): CycleTemplate[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        const check = parseTemplate(JSON.parse(readFileSync(join(TEMPLATES_DIR, f), 'utf8')));
        return check.template ? [check.template] : [];
      } catch {
        return [];
      }
    });
}

export function findTemplate(id: string): CycleTemplate | undefined {
  return builtInTemplate(id) ?? readUserTemplates().find((t) => t.id === id);
}

function summarize(t: CycleTemplate, builtIn: boolean, language: Language): TemplateSummary {
  const cycle: DevCycleConfig = cycleOf(t);
  return {
    id: t.id,
    name: cycleText(t.name, language),
    description: cycleText(t.description, language),
    builtIn,
    needs: t.needs,
    ceremonies: (Object.keys(cycle.ceremonies) as CeremonyId[]).filter((c) => cycle.ceremonies[c]),
    stages: cycle.stages.map((s) => s.label),
  };
}

/** Every template this machine offers, built-in first, in the language of the workspace. */
export function listTemplates(language: Language = getConfig().language): TemplateSummary[] {
  return [...BUILT_IN_TEMPLATES.map((t) => summarize(t, true, language)), ...readUserTemplates().filter((t) => !builtInTemplate(t.id)).map((t) => summarize(t, false, language))];
}

/** Applies a template to the running workspace: validates, saves and returns the new view. Throws with the problems named. */
export function applyCycleTemplate(id: string, options?: ApplyOptions): CycleView {
  const template = findTemplate(id);
  if (!template) throw new Error(`modelo de ciclo desconhecido: ${id}`);
  saveConfig(applyTemplate(getConfig(), template, options));
  return cycleView();
}

/** The workspace's current cycle as the text of a template file. */
export function exportCurrentCycle(meta: { id: string; name: string; description?: string }, now = new Date()): { text: string; filename: string } {
  const template = templateFromConfig(getConfig(), { id: meta.id, name: meta.name, description: meta.description ?? '' });
  return { text: exportTemplateText(template, now), filename: `coxia-cycle-${meta.id}.json` };
}

/** Checks the text of a template file without saving anything. */
export function checkTemplateText(text: string): TemplateCheck {
  try {
    return parseTemplate(JSON.parse(text));
  } catch (e) {
    return { ok: false, template: null, errors: [{ path: '', message: `not valid JSON: ${(e as Error).message}` }], warnings: [] };
  }
}

/** Stores an imported template so it shows in the list. A template cannot take the id of a built-in one. */
export function saveTemplateText(text: string): TemplateSummary {
  const check = checkTemplateText(text);
  if (!check.template) throw new Error(`modelo inválido: ${check.errors.map((e) => `${e.path || '(raiz)'}: ${e.message}`).join('; ')}`);
  if (builtInTemplate(check.template.id)) throw new Error(`o id "${check.template.id}" é de um modelo que já vem com o app; escolha outro`);
  mkdirSync(TEMPLATES_DIR, { recursive: true });
  const file = join(TEMPLATES_DIR, `${check.template.id}.json`);
  writeFileSync(`${file}.tmp`, exportTemplateText(check.template, new Date()));
  renameSync(`${file}.tmp`, file);
  return summarize(check.template, false, getConfig().language);
}

export function removeTemplate(id: string): void {
  if (builtInTemplate(id)) throw new Error('os modelos que vêm com o app não podem ser removidos');
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) throw new Error('id inválido');
  rmSync(join(TEMPLATES_DIR, `${id}.json`), { force: true });
}
