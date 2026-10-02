import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LegacyProfile } from '../shared/config/legacy';
import { migrateConfig } from '../shared/config/migrations';
import { CONFIG_SCHEMA_VERSION, type WorkspaceConfig } from '../shared/config/types';
import { ATA_FILE, REGISTRY_FILE, WEB_FILE, WORKSPACE_DIRS, WORKSPACE_FILES, readRegistry, workspaceDir, workspacesDir } from './workspaces-core';

// Runs once per start, before anything reads a config: decides which workspaces belong to an install that existed before the
// configuration did (they get the legacy profile when the person has one, else the neutral defaults) and writes every workspace's config.json as v2.

export const CONFIG_FILE = 'config.json';
export const V1_BACKUP_FILE = 'config.v1.json';
export const MARKER_FILE = 'config-migration.json';

interface Marker {
  version: 1;
  at: string;
  /** The data root already held an install (a registry or workspace data) when this version first ran. */
  existingInstall: boolean;
  /** Workspaces that existed then; a config file missing in one of them is rebuilt from the legacy profile, or the neutral defaults without one. */
  legacyWorkspaces: string[];
}

export interface BootstrapDeps {
  root: string;
  /** Computed before the workspaces registry was created: see detectExistingInstall. */
  existingInstall: boolean;
  now: () => Date;
  log: (message: string) => void;
  /** The person's legacy profile file, if any (legacy-profile.ts). */
  profile?: LegacyProfile | null;
}

/** Call before ensureWorkspaces: after it, a fresh root and a migrated one look alike. */
export function detectExistingInstall(root: string): boolean {
  if (existsSync(join(root, MARKER_FILE))) return false;
  if (existsSync(join(root, REGISTRY_FILE))) return true;
  try {
    if (readdirSync(workspacesDir(root), { withFileTypes: true }).some((e) => e.isDirectory() && !e.name.startsWith('.'))) return true;
  } catch {}
  try {
    return readdirSync(root).some((n) => WORKSPACE_FILES.includes(n) || WORKSPACE_DIRS.includes(n) || ATA_FILE.test(n));
  } catch {
    return false;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeConfigFile(dir: string, config: WorkspaceConfig): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, CONFIG_FILE);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmp, file);
}

export function readConfigFile(dir: string): unknown {
  return readJson(join(dir, CONFIG_FILE));
}

function readMarker(root: string): Marker | null {
  const m = readJson(join(root, MARKER_FILE)) as Partial<Marker> | undefined;
  return m && Array.isArray(m.legacyWorkspaces) ? (m as Marker) : null;
}

const isCurrent = (doc: unknown): boolean => typeof doc === 'object' && doc !== null && (doc as { schemaVersion?: unknown }).schemaVersion === CONFIG_SCHEMA_VERSION;

export function bootstrapConfigs(deps: BootstrapDeps): { migrated: string[]; marker: Marker } {
  const registry = readRegistry(deps.root);
  const ids = registry?.list.map((w) => w.id) ?? [];
  let marker = readMarker(deps.root);
  if (!marker) {
    marker = { version: 1, at: deps.now().toISOString(), existingInstall: deps.existingInstall, legacyWorkspaces: deps.existingInstall ? ids : [] };
    if (deps.existingInstall && deps.profile?.web && !existsSync(join(deps.root, WEB_FILE))) {
      writeFileSync(join(deps.root, WEB_FILE), JSON.stringify(deps.profile.web, null, 2), { mode: 0o600 });
      deps.log(`${WEB_FILE} created from the legacy profile`);
    }
    writeFileSync(join(deps.root, MARKER_FILE), JSON.stringify(marker, null, 2));
    deps.log(`config migration marker written (existing install: ${marker.existingInstall})`);
  }
  const migrated: string[] = [];
  for (const id of ids) {
    const dir = workspaceDir(deps.root, id);
    mkdirSync(dir, { recursive: true });
    const stored = readConfigFile(dir);
    if (isCurrent(stored)) continue;
    const result = migrateConfig(stored, { legacyInstall: marker.legacyWorkspaces.includes(id), profile: deps.profile ?? null });
    if (stored !== undefined && !existsSync(join(dir, V1_BACKUP_FILE))) copyFileSync(join(dir, CONFIG_FILE), join(dir, V1_BACKUP_FILE));
    writeConfigFile(dir, result.config);
    migrated.push(id);
    deps.log(`workspace ${id}: config v${result.fromVersion} -> v${CONFIG_SCHEMA_VERSION} (${result.notes.join('; ')})`);
  }
  return { migrated, marker };
}
