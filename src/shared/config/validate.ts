// i18n-lint: allow-file English diagnostics that name a path inside a JSON document
import { promptFamilies } from '../cycles/prompts';
import { catalogText } from '../cycles/text';
import { withConfigDefaults } from './defaults';
import { validateSchema } from './jsonSchema';
import { CONFIG_SCHEMA } from './schema';
import { isSystemId } from './team';
import { COMMENT_EVENT_KEYS, CONFIG_SCHEMA_VERSION, LLM_ROLES, type LlmProvider, type SecretRequirement, type WorkspaceConfig } from './types';

export interface ConfigIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
  /** The config with defaults filled in; null when there are errors. */
  config: WorkspaceConfig | null;
}

function duplicates(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

const ANTHROPIC_HOST = /^https:\/\/api\.anthropic\.com\/?$/;

function providerRules(p: LlmProvider, errors: ConfigIssue[], warnings: ConfigIssue[]): void {
  const at = (field: string) => `llm.providers.${p.id}.${field}`;
  if (p.engine === 'claude-sdk' && p.kind === 'openai-compatible') errors.push({ path: at('engine'), message: 'the Claude Agent SDK cannot serve an openai-compatible provider; use the open engine' });
  if ((p.kind === 'anthropic' || p.kind === 'openai-compatible') && !p.baseUrl.trim()) errors.push({ path: at('baseUrl'), message: 'is required for this kind' });
  if (p.baseUrl.trim() && !/^https?:\/\//.test(p.baseUrl)) errors.push({ path: at('baseUrl'), message: 'must start with http:// or https://' });
  if (p.kind === 'anthropic' && p.engine === 'claude-sdk' && p.baseUrl.trim() && !ANTHROPIC_HOST.test(p.baseUrl) && !p.legacyCustomEndpoint) {
    warnings.push({ path: at('baseUrl'), message: 'the Claude Agent SDK is pointed at a non-Anthropic endpoint; only Claude models are supported there' });
  }
  if (p.legacyCustomEndpoint && p.kind !== 'anthropic') errors.push({ path: at('legacyCustomEndpoint'), message: 'only applies to the anthropic kind' });
  if (p.kind === 'anthropic' && !p.secretRef) warnings.push({ path: at('secretRef'), message: 'no API key configured for the anthropic provider' });
  if (p.kind === 'bedrock' && !p.options.region) warnings.push({ path: at('options.region'), message: 'no AWS region set' });
  if (p.kind === 'vertex' && !(p.options.project && p.options.region)) warnings.push({ path: at('options'), message: 'vertex needs project and region' });
  if (p.kind === 'foundry' && !(p.options.resource || p.baseUrl.trim())) warnings.push({ path: at('options.resource'), message: 'foundry needs a resource name or a base URL' });
}

function teamRules(c: WorkspaceConfig, errors: ConfigIssue[], warnings: ConfigIssue[]): void {
  const team = c.agents.team;
  const providers = new Set(c.llm.providers.map((p) => p.id));
  const stageIds = new Set(c.devCycle.stages.map((s) => s.id));
  for (const id of duplicates(team.map((a) => a.id))) errors.push({ path: 'agents.team', message: `duplicate agent id "${id}"` });
  for (const role of LLM_ROLES) if (!team.some((a) => a.id === role && a.system)) errors.push({ path: 'agents.team', message: `the built-in agent "${role}" is missing` });
  team.forEach((a, i) => {
    const at = (field: string) => `agents.team[${i}].${field}`;
    if (isSystemId(a.id) && !a.system) errors.push({ path: at('system'), message: `the id "${a.id}" belongs to a built-in agent` });
    if (a.system && !isSystemId(a.id)) errors.push({ path: at('system'), message: 'only the built-in agents are system agents' });
    a.stages.forEach((s, j) => {
      if (!stageIds.has(s)) errors.push({ path: at(`stages[${j}]`), message: `unknown stage "${s}"` });
    });
    if (a.model.role === null) {
      if (!providers.has(a.model.provider)) errors.push({ path: at('model.provider'), message: `unknown provider "${a.model.provider}"` });
      if (!a.model.model.trim()) errors.push({ path: at('model.model'), message: 'is required when the agent names no role' });
    } else if (a.model.provider || a.model.model) {
      warnings.push({ path: at('model'), message: 'provider and model are ignored while a role is set' });
    }
  });
  const named = new Set(c.devCycle.stages.flatMap((s) => (s.agentId ? [s.agentId] : [])));
  team.forEach((a, i) => {
    if (a.autonomous && !a.stages.length && !named.has(a.id)) warnings.push({ path: `agents.team[${i}].autonomous`, message: 'the agent works no stage, so there is nothing for it to run by itself' });
  });
  const agentIds = new Set(team.map((a) => a.id));
  c.devCycle.stages.forEach((s, i) => {
    if (!s.agentId) return;
    if (s.human) errors.push({ path: `devCycle.stages[${i}].agentId`, message: 'a gate waits for the person and has no agent' });
    else if (!agentIds.has(s.agentId)) errors.push({ path: `devCycle.stages[${i}].agentId`, message: `unknown agent "${s.agentId}"` });
    else if (!team.find((a) => a.id === s.agentId)?.stages.includes(s.id)) warnings.push({ path: `devCycle.stages[${i}].agentId`, message: `agent "${s.agentId}" does not list the stage "${s.id}"` });
  });
}

const COMMAND_OPERATORS = /[;&|<>`$\\\n\r]/;

function runnerRules(c: WorkspaceConfig, errors: ConfigIssue[], warnings: ConfigIssue[]): void {
  const r = c.runner;
  if (r.enabled && !r.triggerLabel.trim()) errors.push({ path: 'runner.triggerLabel', message: 'is empty but the runner is enabled' });
  (r.commands ?? []).forEach((cmd, i) => {
    if (!cmd.trim() || cmd !== cmd.trim()) errors.push({ path: `runner.commands[${i}]`, message: 'must not be empty or start or end with a space' });
    else if (COMMAND_OPERATORS.test(cmd)) errors.push({ path: `runner.commands[${i}]`, message: 'must be one plain command: no pipe, ;, && or redirect' });
  });
  for (const id of duplicates(r.commands ?? [])) warnings.push({ path: 'runner.commands', message: `"${id}" is listed twice` });
  if (!r.commitMessage.includes('{summary}')) errors.push({ path: 'runner.commitMessage', message: 'must contain {summary}' });
  if (/[\n\r]/.test(r.commitMessage)) errors.push({ path: 'runner.commitMessage', message: 'must be one line' });
  const { name, email } = r.identity;
  if (!!name.trim() !== !!email.trim()) errors.push({ path: 'runner.identity', message: 'needs both a name and an email, or neither' });
  else if (email.trim() && !/^[^\s@<>]+@[^\s@<>]+$/.test(email.trim())) errors.push({ path: 'runner.identity.email', message: 'is not an email address' });
  if (r.enabled && c.devCycle.templateId !== 'agent-flow') warnings.push({ path: 'runner.enabled', message: 'the runner only works with the agent cycle (devCycle.templateId "agent-flow")' });
}

const COMMENT_PLACEHOLDERS = new Set(['stage', 'round', 'result', 'decision', 'ref']);
const COMMENT_KEY = /^[a-z0-9][a-z0-9_-]{0,47}$/;

// The templates of the comments the runner leaves on the tracker. A key names a stage or an event; a template for anything else is kept (a template file may
// travel between cycles) but said so, because nothing will ever use it.
function commentRules(c: WorkspaceConfig, errors: ConfigIssue[], warnings: ConfigIssue[]): void {
  const stages = new Map(c.devCycle.stages.map((s) => [s.id, s]));
  const events = new Set<string>(COMMENT_EVENT_KEYS);
  for (const [key, tpl] of Object.entries(c.devCycle.comments)) {
    const at = (field: string) => `devCycle.comments.${key}.${field}`;
    if (!COMMENT_KEY.test(key)) {
      errors.push({ path: `devCycle.comments.${key}`, message: 'the key must be a stage id or one of gate, question, pr' });
      continue;
    }
    const stage = stages.get(key);
    if (!stage && !events.has(key)) warnings.push({ path: `devCycle.comments.${key}`, message: `no stage "${key}" and not one of ${COMMENT_EVENT_KEYS.join(', ')}: this template is never used` });
    if (stage && events.has(key) && key !== 'pr') warnings.push({ path: `devCycle.comments.${key}`, message: `"${key}" is both a stage and an event: the template serves the event, pick another id for the stage` });
    if (stage?.human) warnings.push({ path: `devCycle.comments.${key}`, message: `"${key}" is a gate: its decision is posted from the "gate" template` });
    const status = catalogText(tpl.status, 'pt-BR') ?? tpl.status;
    for (const m of status.matchAll(/\{(\w+)\}/g)) if (!COMMENT_PLACEHOLDERS.has(m[1])) warnings.push({ path: at('status'), message: `{${m[1]}} is not a placeholder of a status: use ${[...COMMENT_PLACEHOLDERS].map((p) => `{${p}}`).join(', ')}` });
    for (const h of duplicates(tpl.sections.map((x) => (catalogText(x.heading, 'pt-BR') ?? x.heading).trim().toLowerCase()))) warnings.push({ path: at('sections'), message: `two sections are headed "${h}"` });
  }
}

function semantic(c: WorkspaceConfig, errors: ConfigIssue[], warnings: ConfigIssue[]): void {
  const providers = new Set(c.llm.providers.map((p) => p.id));
  for (const id of duplicates(c.llm.providers.map((p) => p.id))) errors.push({ path: 'llm.providers', message: `duplicate provider id "${id}"` });
  for (const [role, rm] of Object.entries(c.llm.roles)) {
    if (!providers.has(rm.provider)) errors.push({ path: `llm.roles.${role}.provider`, message: `unknown provider "${rm.provider}"` });
  }
  for (const p of c.llm.providers) providerRules(p, errors, warnings);
  teamRules(c, errors, warnings);
  runnerRules(c, errors, warnings);
  commentRules(c, errors, warnings);
  const vcsIds = new Set(c.vcs.map((v) => v.id));
  for (const id of duplicates(c.vcs.map((v) => v.id))) errors.push({ path: 'vcs', message: `duplicate integration id "${id}"` });
  for (const id of duplicates(c.projects.repos.map((r) => r.id))) errors.push({ path: 'projects.repos', message: `duplicate repo id "${id}"` });
  c.projects.repos.forEach((r, i) => {
    if (r.vcsId && !vcsIds.has(r.vcsId)) errors.push({ path: `projects.repos[${i}].vcsId`, message: `unknown integration "${r.vcsId}"` });
  });
  if (c.projects.issues.vcsId && !vcsIds.has(c.projects.issues.vcsId)) errors.push({ path: 'projects.issues.vcsId', message: `unknown integration "${c.projects.issues.vcsId}"` });
  for (const id of duplicates(c.devCycle.stages.map((s) => s.id))) errors.push({ path: 'devCycle.stages', message: `duplicate stage id "${id}"` });
  c.devCycle.stages.forEach((s, i) =>
    s.match.forEach((m, j) => {
      try {
        new RegExp(m, 'i');
      } catch {
        errors.push({ path: `devCycle.stages[${i}].match[${j}]`, message: 'not a valid regular expression' });
      }
    }),
  );
  const stageIds = new Set(c.devCycle.stages.map((s) => s.id));
  if (stageIds.has('pr')) warnings.push({ path: 'devCycle.stages', message: 'the stage id "pr" is where a run keeps the comment of the pull request: pick another id for the stage' });
  c.devCycle.stageMapping.forEach((r, i) => {
    if (!stageIds.has(r.stage)) errors.push({ path: `devCycle.stageMapping[${i}].stage`, message: `unknown stage "${r.stage}"` });
    try {
      new RegExp(r.pattern, 'i');
    } catch {
      errors.push({ path: `devCycle.stageMapping[${i}].pattern`, message: 'not a valid regular expression' });
    }
    if (r.source === 'field' && !r.name.trim()) warnings.push({ path: `devCycle.stageMapping[${i}].name`, message: 'a board field rule needs the field name' });
  });
  c.devCycle.priority.labels.forEach((l, i) => {
    try {
      new RegExp(l, 'i');
    } catch {
      errors.push({ path: `devCycle.priority.labels[${i}]`, message: 'not a valid regular expression' });
    }
  });
  for (const l of duplicates(c.devCycle.priority.labels)) warnings.push({ path: 'devCycle.priority.labels', message: `"${l}" is listed twice: only its first position ranks` });
  const families = promptFamilies('pt-BR');
  for (const [role, family] of Object.entries(c.devCycle.prompts)) {
    if (!families[family]) warnings.push({ path: `devCycle.prompts.${role}`, message: `no prompt family "${family}": the "sdd" texts are used` });
  }
  try {
    new RegExp(c.devCycle.releaseLabelPattern);
  } catch {
    errors.push({ path: 'devCycle.releaseLabelPattern', message: 'not a valid regular expression' });
  }
  if (!c.devCycle.specLayout.folderPrefix.includes('{iid}')) warnings.push({ path: 'devCycle.specLayout.folderPrefix', message: 'has no {iid}: every issue would match the same folder' });
  if (c.schedule.from >= c.schedule.to) warnings.push({ path: 'schedule', message: 'the work day ends before it starts' });
  for (const [tool, cfg] of Object.entries({ cardSource: c.externalTools.cardSource, releaseSync: c.externalTools.releaseSync, timeExport: c.externalTools.timeExport })) {
    if (cfg.enabled && !cfg.command.trim()) errors.push({ path: `externalTools.${tool}.command`, message: 'is empty but the tool is enabled' });
  }
  if (c.externalTools.cardSource.enabled && !c.externalTools.cardSource.reportArgs.length) warnings.push({ path: 'externalTools.cardSource.reportArgs', message: 'is empty: the command runs with no arguments' });
}

/** Validates a current-schema document: schema first, then the cross references the schema cannot express. Does not migrate (see migrations.ts). */
export function validateConfig(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: [{ path: '', message: 'expected an object' }], warnings: [], config: null };
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version > CONFIG_SCHEMA_VERSION) {
    return { ok: false, errors: [{ path: 'schemaVersion', message: `written by a newer app (schema ${version}); this app understands up to ${CONFIG_SCHEMA_VERSION}` }], warnings: [], config: null };
  }
  const errors: ConfigIssue[] = validateSchema(raw, CONFIG_SCHEMA);
  const warnings: ConfigIssue[] = [];
  if (errors.length) return { ok: false, errors, warnings, config: null };
  const config = withConfigDefaults(raw as Record<string, unknown>);
  semantic(config, errors, warnings);
  return errors.length ? { ok: false, errors, warnings, config: null } : { ok: true, errors, warnings, config };
}

export function summarizeIssues(issues: ConfigIssue[], max = 6): string {
  const shown = issues.slice(0, max).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  return issues.length > max ? `${shown.join('; ')}; and ${issues.length - max} more` : shown.join('; ');
}

/** Every secretRef the config points at, with the fields that use it. This is what an exported file asks the importer to provide. */
export function collectSecretRequirements(c: WorkspaceConfig): SecretRequirement[] {
  const byRef = new Map<string, SecretRequirement>();
  const add = (ref: string | null, usedBy: string, label: string) => {
    if (!ref) return;
    const cur = byRef.get(ref);
    if (cur) cur.usedBy.push(usedBy);
    else byRef.set(ref, { ref, usedBy: [usedBy], label });
  };
  for (const p of c.llm.providers) add(p.secretRef, `llm.providers.${p.id}`, `API key of the model provider "${p.id}"`);
  for (const v of c.vcs) add(v.secretRef, `vcs.${v.id}`, `API token of the integration "${v.id}" (${v.host})`);
  return [...byRef.values()];
}
