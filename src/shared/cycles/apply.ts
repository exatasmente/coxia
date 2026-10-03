// i18n-lint: allow-file English diagnostics that name a path inside a cycle template file
import { mergeDeep, neutralConfig } from '../config/defaults';
import type { AgentDef, AgentShell, AgentTracker, DeepPartial, DevCycleConfig, WorkspaceConfig } from '../config/types';
import { validateConfig, type ConfigIssue } from '../config/validate';
import { RELEASE_FLOW_KEY } from '../config/squads';
import { newAgent, pruneAgentStages, withoutSandbox } from '../config/team';
import { neutralDevCycle } from './neutral';
import { TEMPLATE_FORMAT, TEMPLATE_FORMAT_VERSION, type CycleTemplate, type TemplateFile, type TemplateNeed } from './types';

// Applying a template, turning a workspace's cycle back into a template, and the file a template travels in.

export interface ApplyOptions {
  /** A sandbox works on this machine: the agents a template brings keep `shell: sandbox`. Without it they get what they could do before sandboxes (default: no). */
  sandbox?: boolean;
  /** Keep the QA account the workspace already has (default). The account is the team's, not the template's. */
  keepQaUser?: boolean;
  /** Keep the label pattern that marks a shipped issue (default: take the template's). */
  keepReleaseLabelPattern?: boolean;
}

/** The cycle section a template stands for: the neutral cycle with the template's fields over it. Arrays are replaced, never merged. */
export function cycleOf(template: CycleTemplate): DevCycleConfig {
  // Cloned: the template's own stages and texts must never be the objects of a workspace's config.
  const merged = mergeDeep(neutralDevCycle(), structuredClone(template.devCycle) as unknown as Record<string, unknown>) as DevCycleConfig;
  return { ...merged, templateId: template.id, stageMapping: merged.stageMapping.map((r) => ({ ...r, name: r.name ?? '' })) };
}

/**
 * A template for a kind of run that is not an issue's (`runKind`): its stages become the flow of that kind, next to the workspace's own flow, which stays as it is. The
 * comments it brings are added where the workspace has none of that key (a text the person edited is theirs), and so are its agents (by id, as ever).
 */
function applyRunKind(config: WorkspaceConfig, template: CycleTemplate, options: ApplyOptions): WorkspaceConfig {
  const brought = cycleOf(template);
  const out = structuredClone(config);
  out.devCycle.flows = { ...(out.devCycle.flows ?? {}), [RELEASE_FLOW_KEY]: structuredClone(brought.stages) };
  out.devCycle.comments = { ...structuredClone(brought.comments), ...out.devCycle.comments };
  out.agents.team = mergeTemplateTeam(out.agents.team, template.team ?? [], out.devCycle, { sandbox: options.sandbox === true });
  return out;
}

/** The config with its development cycle replaced by the template's. Nothing outside `devCycle` changes; validation is the caller's (saveConfig). */
export function applyTemplate(config: WorkspaceConfig, template: CycleTemplate, options: ApplyOptions = {}): WorkspaceConfig {
  if (template.runKind === 'release') return applyRunKind(config, template, options);
  const next = cycleOf(template);
  if (options.keepQaUser !== false && config.devCycle.qa.user && !next.qa.user) next.qa = { ...next.qa, user: config.devCycle.qa.user };
  // The priority labels are the team's tracker conventions, like the QA account: a template that names none leaves the workspace's alone.
  if (!next.priority.labels.length) next.priority = structuredClone(config.devCycle.priority);
  if (options.keepReleaseLabelPattern) next.releaseLabelPattern = config.devCycle.releaseLabelPattern;
  // The flows of the squads are the workspace's own (squads are not part of a template): a new cycle for the workspace leaves them as they are.
  if (config.devCycle.flows && Object.keys(config.devCycle.flows).length) next.flows = structuredClone(config.devCycle.flows);
  const out = { ...structuredClone(config), devCycle: next };
  out.agents.team = mergeTemplateTeam(out.agents.team, template.team ?? [], next, { sandbox: options.sandbox === true });
  return out;
}

// The agents the person already has stay exactly as they are; the template adds the ones that are missing. A stage the new cycle does not have
// is dropped from every agent, so the swap leaves no dangling reference.
export function mergeTemplateTeam(current: WorkspaceConfig['agents']['team'], brought: NonNullable<CycleTemplate['team']>, cycle: Pick<DevCycleConfig, 'stages' | 'flows'>, options: { sandbox?: boolean } = {}): WorkspaceConfig['agents']['team'] {
  const have = new Set(current.map((a) => a.id));
  // A template has no squads: an agent it brings is shared until the person puts it in one. A sandbox it asks for is only given where one works.
  const added = brought
    .filter((a) => !have.has(a.id))
    .map((a) => {
      const agent = newAgent({ ...structuredClone(a), system: false, squad: undefined });
      return options.sandbox === true ? agent : { ...agent, shell: withoutSandbox(agent.shell, agent.permission) };
    });
  return pruneAgentStages([...current, ...added], cycle);
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
 * The workspace's cycle as a template to share. The QA account and the priority labels are left out (they belong to the team), and so is anything the neutral cycle
 * already says, so the file stays readable.
 */
export function templateFromConfig(config: WorkspaceConfig, meta: TemplateMeta): CycleTemplate {
  const cycle = structuredClone(config.devCycle);
  delete cycle.flows;
  cycle.qa = { user: null };
  cycle.priority = { labels: [] };
  const team = config.agents.team.filter((a) => !a.system).map((a) => {
    const { squad: _squad, ...rest } = structuredClone(a);
    return rest;
  });
  return { id: meta.id, name: meta.name, description: meta.description, needs: needsOf(cycle), devCycle: withoutNeutral(cycle), ...(team.length ? { team } : {}) };
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
  /** What each agent the file brings may run and read: shown before the template is saved or applied, like the programs of a configuration import. */
  powers: { agent: string; shell: AgentShell; tracker: AgentTracker }[];
}

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

// A template file written before the stages were a flow says `human` for a gate and `artifacts` for what a stage produces.
function withFlowFields(devCycle: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(devCycle.stages)) return devCycle;
  const stages = devCycle.stages.map((s) => {
    if (!isObject(s) || (s.human === undefined && s.artifacts === undefined)) return s;
    const { human, artifacts, ...rest } = s;
    return { ...rest, ...(s.type === undefined ? { type: human === true ? 'gate' : 'work' } : {}), ...(artifacts !== undefined && rest.produces === undefined ? { produces: artifacts } : {}) };
  });
  return { ...devCycle, stages };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads a template file (or a bare template object) and validates the cycle it describes the way a workspace config would be: it is applied
 * to the neutral config and the result is validated, so a bad stage pattern or a mapping to a stage that does not exist is reported with its path.
 */
export function parseTemplate(raw: unknown): TemplateCheck {
  const fail = (path: string, message: string): TemplateCheck => ({ ok: false, template: null, errors: [{ path, message }], warnings: [], powers: [] });
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
  if (errors.length) return { ok: false, template: null, errors, warnings: [], powers: [] };

  const template: CycleTemplate = {
    id: t.id as string,
    name: (t.name as string).trim(),
    description: typeof t.description === 'string' ? t.description : '',
    needs: Array.isArray(t.needs) ? (t.needs.filter((n) => typeof n === 'string') as TemplateNeed[]) : [],
    devCycle: withFlowFields(t.devCycle as Record<string, unknown>) as DeepPartial<DevCycleConfig>,
    ...(t.runKind === 'release' ? { runKind: 'release' as const } : {}),
  };
  if (t.team !== undefined) {
    if (!Array.isArray(t.team) || !t.team.every(isObject)) return fail('template.team', 'expected a list of agents');
    if (t.team.some((a) => (a as Record<string, unknown>).system === true)) return fail('template.team', 'a template cannot define built-in agents');
    template.team = t.team as unknown as AgentDef[];
  }
  // Checked as it would be applied: over a neutral workspace, the template's own agents (as written) next to the built-in ones.
  const base = neutralConfig();
  const checked = validateConfig({ ...base, devCycle: cycleOf(template), agents: { ...base.agents, team: [...base.agents.team, ...(template.team ?? [])] } });
  const prefix = (list: ConfigIssue[]) => list.map((i) => ({ ...i, path: i.path.replace(/^devCycle/, 'template.devCycle').replace(/^agents\.team/, 'template.team') }));
  const issues = prefix(checked.errors);
  // The agents the file brings that can run commands or read the code host, said before anything is applied: a template file is a way to hand someone a sandbox.
  const brought = (template.team ?? []).map((a) => newAgent({ ...structuredClone(a), system: false }));
  const powers = brought.filter((a) => a.shell !== 'none' || a.tracker !== 'none').map((a) => ({ agent: a.id, shell: a.shell, tracker: a.tracker }));
  const notes: ConfigIssue[] = powers.flatMap((p) => [
    ...(p.shell === 'sandbox' ? [{ path: `template.team[${p.agent}].shell`, message: 'the agent may run any command, inside a sandbox (only where this computer can make one)' }] : p.shell === 'allowlist' ? [{ path: `template.team[${p.agent}].shell`, message: 'the agent may run the commands of runner.commands in its worktree, outside any sandbox' }] : []),
    ...(p.tracker === 'read' ? [{ path: `template.team[${p.agent}].tracker`, message: 'the agent may read the code host (never write)' }] : []),
  ]);
  return { ok: issues.length === 0, template: issues.length ? null : template, errors: issues, warnings: [...prefix(checked.warnings), ...notes], powers };
}
