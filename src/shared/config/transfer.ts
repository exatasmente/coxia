// i18n-lint: allow-file English diagnostics of the import file, shown next to the JSON path they are about
import { migrateConfig } from './migrations';
import { CONFIG_SCHEMA_VERSION, type SecretRequirement, type WorkspaceConfig } from './types';
import { collectSecretRequirements, validateConfig, type ConfigIssue } from './validate';

// Export and import of a workspace's configuration: the config only, never history, never secret values.

export const EXPORT_FORMAT = 'coxia-workspace-config';
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  app: { name: string; version: string };
  /** Name of the workspace it came from; the importer may use it as the default name of a new workspace. */
  workspace: { name: string };
  /** The secrets the importer has to provide (references only, never values). */
  requiredSecrets: SecretRequirement[];
  config: WorkspaceConfig;
}

export function buildExport(config: WorkspaceConfig, meta: { workspaceName: string; appVersion: string; now: Date }): ExportFile {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: meta.now.toISOString(),
    app: { name: 'coxia', version: meta.appVersion },
    workspace: { name: meta.workspaceName },
    requiredSecrets: collectSecretRequirements(config),
    config,
  };
}

export interface ParsedImport {
  ok: boolean;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
  config: WorkspaceConfig | null;
  workspaceName: string | null;
  requiredSecrets: SecretRequirement[];
  /** Notes of the migration when the file was written by an older schema. */
  migrated: string[];
}

const fail = (message: string, path = ''): ParsedImport => ({ ok: false, errors: [{ path, message }], warnings: [], config: null, workspaceName: null, requiredSecrets: [], migrated: [] });

/**
 * Reads an export file (or a bare config document), migrates an older schema and validates the result.
 * A key that holds a secret value is refused outright: an export never contains one, so a file that does was not made by this app.
 */
export function parseImport(text: string): ParsedImport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fail('not a JSON file');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return fail('expected a JSON object');
  const envelope = (doc as { format?: unknown }).format === EXPORT_FORMAT;
  let workspaceName: string | null = null;
  let raw: unknown = doc;
  if (envelope) {
    const file = doc as Partial<ExportFile>;
    if (typeof file.formatVersion === 'number' && file.formatVersion > EXPORT_FORMAT_VERSION) return fail(`export format ${file.formatVersion} is newer than this app understands (${EXPORT_FORMAT_VERSION})`, 'formatVersion');
    raw = file.config;
    workspaceName = typeof file.workspace?.name === 'string' ? file.workspace.name.slice(0, 60) : null;
  }
  const leaked = findSecretValues(raw);
  if (leaked.length) return fail(`secret values are not accepted in a config file (${leaked.join(', ')}); use a secretRef`, leaked[0]);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('the file has no configuration object', envelope ? 'config' : '');
  const current = (raw as { schemaVersion?: unknown }).schemaVersion === CONFIG_SCHEMA_VERSION;
  let notes: string[] = [];
  let result;
  if (current) result = validateConfig(raw);
  else {
    try {
      const migrated = migrateConfig(raw, { legacyInstall: false });
      notes = migrated.notes;
      result = validateConfig(migrated.config);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
  if (!result.ok || !result.config) return { ok: false, errors: result.errors, warnings: result.warnings, config: null, workspaceName, requiredSecrets: [], migrated: notes };
  return { ok: true, errors: [], warnings: result.warnings, config: result.config, workspaceName, requiredSecrets: collectSecretRequirements(result.config), migrated: notes };
}

// Field names that would carry a credential if someone pasted one into the wrong place.
const SECRETISH = /^(apiKey|api_key|token|password|secret|authToken|accessToken|privateKey)$/i;

function findSecretValues(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => findSecretValues(x, `${path}[${i}]`));
  if (typeof v !== 'object' || v === null) return [];
  return Object.entries(v).flatMap(([k, x]) => {
    const here = path ? `${path}.${k}` : k;
    return SECRETISH.test(k) && typeof x === 'string' && x ? [here] : findSecretValues(x, here);
  });
}

export interface ConfigChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasIds = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.length > 0 && v.every((x) => isRecord(x) && typeof x.id === 'string');

function flatten(v: unknown, path: string, out: Map<string, unknown>): void {
  if (isRecord(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, path ? `${path}.${k}` : k, out);
    if (!Object.keys(v).length) out.set(path, v);
  } else if (hasIds(v)) {
    for (const item of v) flatten(item, `${path}[${item.id}]`, out);
  } else out.set(path, v);
}

/** Leaf-by-leaf difference, with arrays of {id} objects keyed by id so a reordered list is not a change. Used for the import preview. */
export function diffConfig(before: WorkspaceConfig, after: WorkspaceConfig): ConfigChange[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, '', a);
  flatten(after, '', b);
  const changes: ConfigChange[] = [];
  for (const [path, value] of b) {
    if (!a.has(path)) changes.push({ path, kind: 'added', before: undefined, after: value });
    else if (JSON.stringify(a.get(path)) !== JSON.stringify(value)) changes.push({ path, kind: 'changed', before: a.get(path), after: value });
  }
  for (const [path, value] of a) if (!b.has(path)) changes.push({ path, kind: 'removed', before: value, after: undefined });
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

/** Every executable the config would run. An import preview shows them: a config file can make the app run programs. */
export function collectCommands(c: WorkspaceConfig): { field: string; command: string }[] {
  const t = c.externalTools;
  const found: { field: string; command: string }[] = [];
  const add = (field: string, command: string | null, on = true) => {
    if (on && command?.trim()) found.push({ field, command });
  };
  add('externalTools.cardSource.command', t.cardSource.command, t.cardSource.enabled);
  add('externalTools.releaseSync.command', t.releaseSync.command, t.releaseSync.enabled);
  add('externalTools.timeExport.command', t.timeExport.command, t.timeExport.enabled);
  add('externalTools.terminal.command', t.terminal.command);
  add('externalTools.claudeCli.command', t.claudeCli.command);
  for (const v of c.vcs) add(`vcs.${v.id}.cliCommand`, v.cliCommand);
  (c.runner.commands ?? []).forEach((cmd, i) => add(`runner.commands[${i}]`, cmd));
  return found;
}

/** Every local path the config points at, so the importer can tell which ones do not exist on this machine. */
export function collectPaths(c: WorkspaceConfig): { field: string; path: string }[] {
  const found: { field: string; path: string }[] = [];
  const add = (field: string, path: string | null) => {
    if (path?.trim()) found.push({ field, path });
  };
  c.projects.roots.forEach((p, i) => add(`projects.roots[${i}]`, p));
  c.projects.repos.forEach((r) => add(`projects.repos[${r.id}].path`, r.path));
  for (const key of ['claudeMdRoots', 'skillsDirs', 'rulesDirs', 'agentsDirs', 'knowledgeDirs', 'mcpConfigFiles'] as const) c.docs[key].forEach((p, i) => add(`docs.${key}[${i}]`, p));
  add('docs.specsDir', c.docs.specsDir);
  add('externalTools.releaseSync.cwd', c.externalTools.releaseSync.cwd);
  add('externalTools.releaseSync.mirrorsDir', c.externalTools.releaseSync.mirrorsDir);
  add('externalTools.cardSource.stateFile', c.externalTools.cardSource.stateFile);
  add('externalTools.claudeCli.cwd', c.externalTools.claudeCli.cwd);
  add('runner.worktreesDir', c.runner.worktreesDir);
  c.llm.providers.forEach((p) => add(`llm.providers.${p.id}.envFile`, p.envFile));
  return found;
}
