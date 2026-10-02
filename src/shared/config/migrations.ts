// i18n-lint: allow-file English diagnostics of the config migration, written to the log
import { mergeDeep, neutralConfig, withConfigDefaults } from './defaults';
import { LEGACY_DEFAULT_MODEL, LEGACY_PROVIDER_ID, legacyProfile } from './legacy';
import { validateConfig, type ConfigIssue } from './validate';
import { CONFIG_SCHEMA_VERSION, LLM_ROLES, type DeepPartial, type LlmRole, type WorkspaceConfig } from './types';

// config.json history:
//   v1  no schemaVersion; the flat "Settings" of the app before configuration existed (models, tools, schedule, voice, ...; web lived in it too).
//   v2  WorkspaceConfig (types.ts).
// A migration takes the document of version N and returns the document of version N+1, never reading the disk or the machine:
// everything it needs comes in the context, so it is testable with plain objects.

export interface MigrationContext {
  /**
   * The workspace belongs to an install that existed before configuration did, and has no config file to read.
   * Such a workspace gets the author's profile (legacy.ts) so it keeps behaving as before; without it, the neutral defaults apply.
   */
  legacyInstall: boolean;
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

function v1ToV2(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const models = pick(old.models);
  const tools = pick(old.tools);
  const model = (role: LlmRole): string => {
    const m = models[role === 'fix' ? 'reply' : role];
    return typeof m === 'string' && m.trim() ? m.trim() : LEGACY_DEFAULT_MODEL;
  };
  const patch: DeepPartial<WorkspaceConfig> & Doc = {
    llm: { roles: Object.fromEntries(LLM_ROLES.map((r) => [r, { provider: LEGACY_PROVIDER_ID, model: model(r) }])) as Record<LlmRole, { provider: string; model: string }> },
    agents: { tools: { files: tools.files as boolean, skills: tools.skills as boolean, trackerMcp: tools.gitlabMcp as boolean, vcsCli: tools.glab as boolean, subagents: tools.subagents as boolean } },
    schedule: pick(old.schedule),
    voice: pick(old.voice),
    notifications: old.notifications as boolean,
    closeToTray: old.closeToTray as boolean,
    retention: pick(old.retention),
    appearance: pick(old.appearance),
  };
  if (isObject(old.web)) notes.push('web settings are not part of the workspace config (they stay in the shared web.json)');
  notes.push('built from the v1 settings and the constants the app used to hardcode');
  return { ...(mergeDeep(mergeDeep(neutralConfig(), legacyProfile()), dropUndefined(patch)) as unknown as Doc), schemaVersion: 2 };
}

function dropUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v as T;
  if (!isObject(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, dropUndefined(x)])) as T;
}

// Index N migrates a version N document to N+1.
const STEPS: Record<number, Step> = { 1: v1ToV2 };

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
    notes.push('no config file on an existing install: profile of the previous app');
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
  let result = validateConfig(doc);
  if (!result.ok) {
    doc = repair(doc, ctx.legacyInstall || fromVersion < CONFIG_SCHEMA_VERSION ? (mergeDeep(neutralConfig(), legacyProfile()) as WorkspaceConfig) : neutralConfig(), result.errors, notes);
    result = validateConfig(doc);
    changed = true;
  }
  if (!result.ok || !result.config) {
    notes.push('config unusable after repair: neutral defaults');
    return { config: withConfigDefaults({}), fromVersion, changed: true, notes };
  }
  return { config: result.config, fromVersion, changed, notes };
}
