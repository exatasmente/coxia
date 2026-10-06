import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { neutralConfig } from '../shared/config/defaults';
import { expandHome } from '../shared/config/paths';
import { buildExport, collectCommands, collectPaths, diffConfig, parseImport } from '../shared/config/transfer';
import type { WorkspaceConfig } from '../shared/config/types';
import { collectSecretRequirements, summarizeIssues, validateConfig } from '../shared/config/validate';
import type { ImportApply, ImportPreview, ImportResult, ImportSource, ImportTarget } from '../shared/configTransfer';
import { CONFIG_FILE, readConfigFile, writeConfigFile } from './config-bootstrap';
import type { SecretsStore } from './secrets-core';
import { createWorkspace, readRegistry, workspaceDir } from './workspaces-core';
import { t } from '../shared/i18n';

// Export and import of a workspace configuration, on the disk only (no Electron): the config file moves, never history, never a secret value.

export const MAX_IMPORT_BYTES = 1024 * 1024;

export interface TransferDeps {
  root: string;
  home: string;
  secrets: SecretsStore;
  exists: (path: string) => boolean;
  now: () => Date;
}

export function readSource(source: ImportSource): string {
  if ('text' in source) {
    if (source.text.length > MAX_IMPORT_BYTES) throw new Error(t('main.config.tooBig'));
    return source.text;
  }
  if (statSync(source.path).size > MAX_IMPORT_BYTES) throw new Error(t('main.config.tooBig'));
  return readFileSync(source.path, 'utf8');
}

/** The JSON text of an export file for a config: no history, no secret values, the list of secrets the importer must provide. */
export function exportText(config: WorkspaceConfig, meta: { workspaceName: string; appVersion: string; now: Date }): string {
  return `${JSON.stringify(buildExport(config, meta), null, 2)}\n`;
}

function currentOf(deps: TransferDeps, target: ImportTarget): WorkspaceConfig {
  if (target.mode === 'new') return neutralConfig();
  const stored = validateConfig(readConfigFile(workspaceDir(deps.root, target.id)));
  return stored.config ?? neutralConfig();
}

function assertTarget(deps: TransferDeps, target: ImportTarget): void {
  if (target.mode === 'existing' && !readRegistry(deps.root)?.list.some((w) => w.id === target.id)) throw new Error(t('main.workspaces.missing', { id: target.id }));
}

/** Validates the file and shows what importing it would do. Writes nothing. */
export function previewImport(deps: TransferDeps, source: ImportSource, target: ImportTarget): ImportPreview {
  assertTarget(deps, target);
  const parsed = parseImport(readSource(source));
  const empty = { workspaceName: parsed.workspaceName, migrated: parsed.migrated, changes: [], secrets: [], commands: [], missingPaths: [] };
  if (!parsed.ok || !parsed.config) return { ok: false, errors: parsed.errors, warnings: parsed.warnings, ...empty };
  const config = parsed.config;
  return {
    ok: true,
    errors: [],
    warnings: parsed.warnings,
    workspaceName: parsed.workspaceName,
    migrated: parsed.migrated,
    changes: diffConfig(currentOf(deps, target), config),
    secrets: collectSecretRequirements(config).map((r) => ({ ...r, satisfied: deps.secrets.has(r.ref) })),
    commands: collectCommands(config),
    missingPaths: collectPaths(config).filter((p) => !deps.exists(expandHome(p.path, deps.home))),
  };
}

/** Applies the import: secrets first (so a failure leaves the config untouched), then the config file. The previous config is kept next to it. */
export function applyImport(deps: TransferDeps, req: ImportApply, running: string | null): ImportResult {
  assertTarget(deps, req.target);
  const parsed = parseImport(readSource(req.source));
  if (!parsed.ok || !parsed.config) throw new Error(t('main.config.invalid', { issues: summarizeIssues(parsed.errors) }));
  const config = parsed.config;
  const needed = new Set(collectSecretRequirements(config).map((r) => r.ref));
  for (const input of req.secrets) {
    if (!needed.has(input.ref)) throw new Error(t('main.config.unusedSecret', { ref: input.ref }));
  }
  for (const input of req.secrets) deps.secrets.set(input);

  let id: string;
  let created = false;
  if (req.target.mode === 'new') {
    const name = req.target.name.trim() || parsed.workspaceName || 'Importado';
    const reg = createWorkspace(deps.root, { name, copySettings: false }, { now: deps.now, log: () => undefined });
    id = reg.list[reg.list.length - 1].id;
    created = true;
  } else {
    id = req.target.id;
    const dir = workspaceDir(deps.root, id);
    if (existsSync(join(dir, CONFIG_FILE))) copyFileSync(join(dir, CONFIG_FILE), join(dir, 'config.pre-import.json'));
  }
  // What a workspace's plugins were allowed is the person's, on that workspace: a file never brings permissions in, and replacing a workspace keeps its own.
  writeConfigFile(workspaceDir(deps.root, id), { ...config, plugins: { ...config.plugins, list: created ? [] : pluginChoicesOf(workspaceDir(deps.root, id)) } });
  return { workspaceId: id, created, appliedToRunning: id === running, missingSecrets: [...needed].filter((ref) => !deps.secrets.has(ref)) };
}

/** The plugin list a workspace's configuration file holds now, or none when it cannot be read. */
function pluginChoicesOf(dir: string): WorkspaceConfig['plugins']['list'] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, CONFIG_FILE), 'utf8')) as { plugins?: { list?: unknown } };
    return Array.isArray(raw.plugins?.list) ? (raw.plugins.list as WorkspaceConfig['plugins']['list']) : [];
  } catch {
    return [];
  }
}
