// i18n-lint: allow-file English diagnostics of the config migration, written to the log
import { mergeDeep, neutralConfig, neutralRunner, withConfigDefaults } from './defaults';
import type { LegacyProfile } from './legacy';
import { validateConfig, type ConfigIssue } from './validate';
import { agentFlowComments } from '../cycles/templates/agentFlowComments';
import { systemAgents } from './team';
import { CONFIG_SCHEMA_VERSION, LLM_ROLES, type DeepPartial, type LlmRole, type WorkspaceConfig } from './types';

// config.json history:
//   v1  no schemaVersion; the flat "Settings" of the app before configuration existed (models, tools, schedule, voice, ...; web lived in it too).
//   v2  WorkspaceConfig (types.ts).
//   v3  devCycle.priority, and the card fields `priority` and `milestone` offered to the agents.
//   v4  agents.team (the five system agents, seeded from agents.roles) and, on a stage, `agentId`, `artifacts` and `human`.
//   v5  runner (the section that takes an issue through the agent cycle by itself), off by default.
//   v6  devCycle.comments (the templates of the comments the runner leaves on the tracker): the agent cycle's own, none for any other cycle.
//   v7  the stages of an agent cycle are a flow: `type` (work, gate, wait), `produces` (was `artifacts`), `returnsTo` and `roundLimit` (the review and QA rules the
//       runner used to have built in), and the order of the list is the order of the run (it used to be the rank).
// A migration takes the document of version N and returns the document of version N+1, never reading the disk or the machine:
// everything it needs comes in the context, so it is testable with plain objects.

export interface MigrationContext {
  /**
   * The workspace belongs to an install that existed before configuration did, and has no config file to read.
   * Such a workspace gets the optional profile (legacy.ts) so it keeps behaving as before; without one, the neutral defaults apply.
   */
  legacyInstall: boolean;
  /** The profile file of the person, when there is one. */
  profile?: LegacyProfile | null;
}

export interface MigrationResult {
  config: WorkspaceConfig;
  fromVersion: number;
  /** True when the stored document had to change (a v1 file, a missing file on a legacy install, or invalid fields reset). */
  changed: boolean;
  notes: string[];
}

type Doc = Record<string, unknown>;
type Step = (doc: Doc, ctx: MigrationContext, notes: string[]) => Doc;

const isObject = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = (v: unknown): Doc => (isObject(v) ? v : {});

// The base a migrated document starts from: the neutral defaults, plus the person's profile when there is one.
function baseOf(ctx: MigrationContext): WorkspaceConfig {
  return ctx.profile ? (mergeDeep(neutralConfig(), ctx.profile.config) as WorkspaceConfig) : neutralConfig();
}

function v1ToV2(old: Doc, ctx: MigrationContext, notes: string[]): Doc {
  const models = pick(old.models);
  const tools = pick(old.tools);
  const carried = ctx.profile?.migratedModels ?? null;
  const model = (role: LlmRole): string => {
    const m = models[role === 'fix' ? 'reply' : role];
    return typeof m === 'string' && m.trim() ? m.trim() : (carried?.defaultModel ?? '');
  };
  const patch: DeepPartial<WorkspaceConfig> & Doc = {
    llm: carried ? { roles: Object.fromEntries(LLM_ROLES.map((r) => [r, { provider: carried.provider, model: model(r) }])) as Record<LlmRole, { provider: string; model: string }> } : undefined,
    agents: { tools: { files: tools.files as boolean, skills: tools.skills as boolean, trackerMcp: tools.gitlabMcp as boolean, vcsCli: tools.glab as boolean, subagents: tools.subagents as boolean } },
    schedule: pick(old.schedule),
    voice: pick(old.voice),
    notifications: old.notifications as boolean,
    closeToTray: old.closeToTray as boolean,
    retention: pick(old.retention),
    appearance: pick(old.appearance),
  };
  if (isObject(old.web)) notes.push('web settings are not part of the workspace config (they stay in the shared web.json)');
  notes.push(ctx.profile ? 'built from the v1 settings and the legacy profile file' : 'built from the v1 settings over the neutral defaults (no legacy profile)');
  return { ...(mergeDeep(baseOf(ctx), dropUndefined(patch)) as unknown as Doc), schemaVersion: 2 };
}

function dropUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v as T;
  if (!isObject(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, dropUndefined(x)])) as T;
}

// A stored v2 file lists its card fields explicitly, so the two new ones are appended: without that an existing workspace would never show them to the agent.
function v2ToV3(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const cycle = pick(old.devCycle);
  if (!Object.keys(cycle).length) return { ...old, schemaVersion: 3 };
  const enrichment = pick(cycle.enrichment);
  const fields = Array.isArray(enrichment.cardFields) ? (enrichment.cardFields as unknown[]) : null;
  const added = fields ? ['priority', 'milestone'].filter((f) => !fields.includes(f)) : [];
  if (added.length) notes.push(`card fields ${added.join(', ')} added to what the agents see`);
  return {
    ...old,
    schemaVersion: 3,
    devCycle: {
      ...cycle,
      priority: isObject(cycle.priority) ? cycle.priority : { labels: [] },
      ...(fields && added.length ? { enrichment: { ...enrichment, cardFields: [...fields, ...added] } } : {}),
    },
  };
}

// The team starts as the five system agents, one per role, taking each role's model and extra instructions: nothing the ceremonies do changes.
// A file with no agents section is left to the defaults, which hold the same five.
function v3ToV4(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const agents = pick(old.agents);
  if (!Object.keys(agents).length || Array.isArray(agents.team)) return { ...old, schemaVersion: 4 };
  const roles = pick(agents.roles);
  const seeds = Object.fromEntries(LLM_ROLES.map((r) => [r, pick(roles[r])]));
  notes.push('agent team created with the five built-in agents, taken from agents.roles');
  return { ...old, schemaVersion: 4, agents: { ...agents, team: systemAgents(seeds) } };
}

// The runner starts switched off with its defaults, so a workspace that never heard of it behaves exactly as before.
function v4ToV5(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  if (isObject(old.runner)) return { ...old, schemaVersion: 5 };
  notes.push('runner section created with its defaults (off)');
  return { ...old, schemaVersion: 5, runner: neutralRunner() };
}

// A workspace on the agent cycle gets that cycle's comment templates (the runner then has something to post); any other cycle brings none, so nothing
// is ever posted for it. A file that already carries templates keeps them.
function v5ToV6(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const cycle = pick(old.devCycle);
  if (!Object.keys(cycle).length || isObject(cycle.comments)) return { ...old, schemaVersion: 6 };
  const own = cycle.templateId === 'agent-flow';
  if (own) notes.push('comment templates of the agent cycle added to devCycle');
  return { ...old, schemaVersion: 6, devCycle: { ...cycle, comments: own ? agentFlowComments() : {} } };
}

// What the runner did before the flow was data, written as the fields that say the same: a gate is `human`, the review sends the work back to the stage
// before it, a QA failure to the first stage whose agent changes files, both after two rounds, and the stage where the run ends (the last by rank) has no
// agent. A cycle with none of the agent fields is one of the ceremonies' and is left as it is.
function v6ToV7(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const cycle = pick(old.devCycle);
  const list = Array.isArray(cycle.stages) ? (cycle.stages as unknown[]).filter(isObject) : [];
  if (!list.some((s) => s.human !== undefined || s.agentId !== undefined || s.artifacts !== undefined)) return { ...old, schemaVersion: 7 };
  const team = Array.isArray(pick(old.agents).team) ? (pick(old.agents).team as unknown[]).filter(isObject) : [];
  const rank = (s: Doc): number => (typeof s.rank === 'number' ? s.rank : 0);
  // The flow's order used to be rank, then the list: now it is the list.
  const ordered = list.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => ({ ...x.s }));
  const agentOf = (s: Doc): Doc | undefined => team.find((a) => a.id === s.agentId) ?? team.find((a) => Array.isArray(a.stages) && (a.stages as unknown[]).includes(s.id));
  const writer = (s: Doc): boolean => s.human !== true && agentOf(s)?.permission === 'worktree';
  const stages = ordered.map((s, i) => {
    const { human, artifacts, ...rest } = s;
    const out: Doc = { ...rest, type: human === true ? 'gate' : 'work' };
    if (Array.isArray(artifacts) && artifacts.length) out.produces = artifacts;
    if (i === ordered.length - 1) delete out.agentId;
    if (human !== true && s.kind === 'review') {
      const before = ordered.slice(0, i).reverse().find((x) => x.human !== true);
      if (before) Object.assign(out, { returnsTo: before.id, roundLimit: 2 });
    }
    if (human !== true && s.kind === 'qa') {
      const builder = ordered.slice(0, i).find(writer);
      if (builder) Object.assign(out, { returnsTo: builder.id, roundLimit: 2 });
    }
    return out;
  });
  if (ordered.some((s, i) => s !== undefined && list[i] !== undefined && s.id !== list[i].id)) notes.push('the stages of the agent cycle are listed in the order a run goes through them (they were ordered by rank)');
  notes.push('the stages of the agent cycle became a flow (type, produces, returnsTo, roundLimit)');
  return { ...old, schemaVersion: 7, devCycle: { ...cycle, stages } };
}

// Index N migrates a version N document to N+1.
const STEPS: Record<number, Step> = { 1: v1ToV2, 2: v2ToV3, 3: v3ToV4, 4: v4ToV5, 5: v5ToV6, 6: v6ToV7 };

const tokens = (path: string): (string | number)[] => [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));

function get(root: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((cur, key) => (cur !== null && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[key] : undefined), root);
}

function set(root: Doc, path: (string | number)[], value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cur = cur[key] as Record<string | number, unknown>;
  cur[path[path.length - 1]] = value;
}

// A stored value that fails validation is replaced by the default it would have had, so one bad field never locks a workspace out.
function repair(doc: Doc, base: WorkspaceConfig, issues: ConfigIssue[], notes: string[]): Doc {
  const out = structuredClone(doc);
  for (const issue of issues) {
    let path = tokens(issue.path);
    while (path.length && typeof path[path.length - 1] === 'number') path = path.slice(0, -1);
    while (path.length > 1 && get(base, path) === undefined) path = path.slice(0, -1);
    if (!path.length || get(base, path) === undefined) continue;
    set(out, path, structuredClone(get(base, path)));
    notes.push(`reset ${path.join('.')}: ${issue.message}`);
  }
  return out;
}

/** Brings any stored document to the current version. Throws only for a document written by a newer app. */
export function migrateConfig(raw: unknown, ctx: MigrationContext): MigrationResult {
  const notes: string[] = [];
  let doc: Doc;
  let version: number;
  let changed = false;
  if (isObject(raw)) {
    doc = raw;
    version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  } else if (ctx.legacyInstall) {
    doc = {};
    version = 1;
    notes.push('no config file on an existing install: the legacy profile, or the neutral defaults without one');
  } else {
    return { config: neutralConfig(), fromVersion: CONFIG_SCHEMA_VERSION, changed: false, notes: ['fresh install: neutral defaults'] };
  }
  const fromVersion = version;
  if (version > CONFIG_SCHEMA_VERSION) throw new Error(`config written by a newer app (schema ${version}); this app understands up to ${CONFIG_SCHEMA_VERSION}`);
  while (version < CONFIG_SCHEMA_VERSION) {
    const step = STEPS[version];
    if (!step) throw new Error(`no migration from config schema ${version}`);
    doc = step(doc, ctx, notes);
    version++;
    changed = true;
  }
  let result = validateConfig(doc, { tolerateFlow: true });
  if (!result.ok) {
    doc = repair(doc, ctx.legacyInstall || fromVersion < CONFIG_SCHEMA_VERSION ? baseOf(ctx) : neutralConfig(), result.errors, notes);
    result = validateConfig(doc, { tolerateFlow: true });
    changed = true;
  }
  if (!result.ok || !result.config) {
    notes.push('config unusable after repair: neutral defaults');
    return { config: withConfigDefaults({}), fromVersion, changed: true, notes };
  }
  return { config: result.config, fromVersion, changed, notes };
}
