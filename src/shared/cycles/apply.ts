import { mergeDeep, neutralConfig } from '../config/defaults';
import type { DeepPartial, DevCycleConfig, WorkspaceConfig } from '../config/types';
import { validateConfig, type ConfigIssue } from '../config/validate';
import { neutralDevCycle } from './neutral';
import { TEMPLATE_FORMAT, TEMPLATE_FORMAT_VERSION, type CycleTemplate, type TemplateFile, type TemplateNeed } from './types';

// Applying a template, turning a workspace's cycle back into a template, and the file a template travels in.

export interface ApplyOptions {
  /** Keep the QA account the workspace already has (default). The account is the team's, not the template's. */
  keepQaUser?: boolean;
  /** Keep the label pattern that marks a shipped issue (default: take the template's). */
  keepReleaseLabelPattern?: boolean;
}

/** The cycle section a template stands for: the neutral cycle with the template's fields over it. Arrays are replaced, never merged. */
export function cycleOf(template: CycleTemplate): DevCycleConfig {
  const merged = mergeDeep(neutralDevCycle(), template.devCycle as unknown as Record<string, unknown>) as DevCycleConfig;
  return { ...merged, templateId: template.id, stageMapping: merged.stageMapping.map((r) => ({ ...r, name: r.name ?? '' })) };
}

/** The config with its development cycle replaced by the template's. Nothing outside `devCycle` changes; validation is the caller's (saveConfig). */
export function applyTemplate(config: WorkspaceConfig, template: CycleTemplate, options: ApplyOptions = {}): WorkspaceConfig {
  const next = cycleOf(template);
  if (options.keepQaUser !== false && config.devCycle.qa.user && !next.qa.user) next.qa = { ...next.qa, user: config.devCycle.qa.user };
  if (options.keepReleaseLabelPattern) next.releaseLabelPattern = config.devCycle.releaseLabelPattern;
  return { ...structuredClone(config), devCycle: next };
}

/** What the template still needs from the workspace: derived from what it switches on and the fields that are empty. */
export function needsOf(cycle: DevCycleConfig): TemplateNeed[] {
  const needs: TemplateNeed[] = [];
  if (cycle.specLayout.phaseFiles.length || cycle.specLayout.gateFiles.length) needs.push('specsDir');
  if (cycle.ceremonies.qaHandoff) needs.push('qaUser');
  if (cycle.ceremonies.releaseConflicts) needs.push('releaseSync');
  return needs;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
}

/**
 * The workspace's cycle as a template to share. The QA account is left out (it belongs to the team), and so is anything the neutral cycle
 * already says, so the file stays readable.
 */
export function templateFromConfig(config: WorkspaceConfig, meta: TemplateMeta): CycleTemplate {
  const cycle = structuredClone(config.devCycle);
  cycle.qa = { user: null };
  return { id: meta.id, name: meta.name, description: meta.description, needs: needsOf(cycle), devCycle: withoutNeutral(cycle) };
}

function withoutNeutral(cycle: DevCycleConfig): DeepPartial<DevCycleConfig> {
  const base = neutralDevCycle() as unknown as Record<string, unknown>;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return Object.fromEntries(Object.entries(cycle).filter(([key, value]) => key === 'templateId' || !same(value, base[key]))) as DeepPartial<DevCycleConfig>;
}

export function exportTemplateText(template: CycleTemplate, now: Date): string {
  const file: TemplateFile = { format: TEMPLATE_FORMAT, formatVersion: TEMPLATE_FORMAT_VERSION, exportedAt: now.toISOString(), template };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export interface TemplateCheck {
  ok: boolean;
  template: CycleTemplate | null;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads a template file (or a bare template object) and validates the cycle it describes the way a workspace config would be: it is applied
 * to the neutral config and the result is validated, so a bad stage pattern or a mapping to a stage that does not exist is reported with its path.
 */
export function parseTemplate(raw: unknown): TemplateCheck {
  const fail = (path: string, message: string): TemplateCheck => ({ ok: false, template: null, errors: [{ path, message }], warnings: [] });
  if (!isObject(raw)) return fail('', 'expected an object');
  let candidate: unknown = raw;
  if (raw.format !== undefined) {
    if (raw.format !== TEMPLATE_FORMAT) return fail('format', `expected "${TEMPLATE_FORMAT}"`);
    if (typeof raw.formatVersion === 'number' && raw.formatVersion > TEMPLATE_FORMAT_VERSION) return fail('formatVersion', 'written by a newer app');
    candidate = raw.template;
  }
  if (!isObject(candidate)) return fail('template', 'expected an object');
  const t = candidate as Record<string, unknown>;
  const errors: ConfigIssue[] = [];
  if (typeof t.id !== 'string' || !ID.test(t.id)) errors.push({ path: 'template.id', message: 'must be lowercase letters, digits, "-" and "_"' });
  if (typeof t.name !== 'string' || !t.name.trim()) errors.push({ path: 'template.name', message: 'is required' });
  if (t.description !== undefined && typeof t.description !== 'string') errors.push({ path: 'template.description', message: 'must be text' });
  if (!isObject(t.devCycle)) errors.push({ path: 'template.devCycle', message: 'expected an object' });
  if (errors.length) return { ok: false, template: null, errors, warnings: [] };

  const template: CycleTemplate = {
    id: t.id as string,
    name: (t.name as string).trim(),
    description: typeof t.description === 'string' ? t.description : '',
    needs: Array.isArray(t.needs) ? (t.needs.filter((n) => typeof n === 'string') as TemplateNeed[]) : [],
    devCycle: t.devCycle as DeepPartial<DevCycleConfig>,
  };
  const checked = validateConfig({ ...neutralConfig(), devCycle: cycleOf(template) });
  const prefix = (list: ConfigIssue[]) => list.map((i) => ({ ...i, path: i.path.replace(/^devCycle/, 'template.devCycle') }));
  const issues = prefix(checked.errors);
  return { ok: issues.length === 0, template: issues.length ? null : template, errors: issues, warnings: prefix(checked.warnings) };
}
