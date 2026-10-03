import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandHome } from '../shared/config/paths';
import type { WorkspaceConfig } from '../shared/config/types';
import { summarizeIssues, validateConfig } from '../shared/config/validate';
import { VERIFY_COMMAND_MAX, ownVerifyProjects } from '../shared/verifyCommands';
import { readConfigFile, writeConfigFile } from './config-bootstrap';
import { mirroredProjects } from './verifyProjects';
import { readRegistry, workspaceDir, workspacesDir } from './workspaces-core';

// The conflict verification commands used to live in one file of the data root, shared by every workspace. They are part of each workspace's
// configuration now (projects.verifyCommands). This moves what the old file holds, once, at startup: a config migration cannot do it, because it
// never reads the disk and this needs the registry, every workspace's repos and the mirrors folders.

export const VERIFY_FILE = 'conflict-verify.json';
export const VERIFY_BACKUP_FILE = 'conflict-verify.json.migrated';
export const VERIFY_UNCLAIMED_FILE = 'conflict-verify.unclaimed.json';

export interface MoveDeps {
  root: string;
  home: string;
  log: (message: string) => void;
  now: () => Date;
  /** Projects of the bare mirrors in a folder; the real listing by default. */
  mirrors?: (dir: string) => string[];
}

export interface MoveResult {
  /** none: no old file. moved: done and the file renamed. deferred: a workspace could not be read, the file stays for the next start. unusable: the file was not a JSON object (kept aside). */
  status: 'none' | 'moved' | 'deferred' | 'unusable';
  /** Project keys copied into each workspace. */
  copied: Record<string, string[]>;
  /** Projects of the old file that no workspace lists. */
  unclaimed: string[];
  /** Workspaces whose config could not be read or written, so nothing was claimed for them. */
  deferred: string[];
  backup: string | null;
}

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

// A backup is never overwritten: a file put back by hand and migrated again gets a name of its own.
function backupName(root: string, now: Date): string {
  const first = join(root, VERIFY_BACKUP_FILE);
  return existsSync(first) ? `${first}-${now.toISOString().replace(/[:.]/g, '-')}` : first;
}

// An error reading the file is not the same as a file that is not a command list: the first waits for the next start, the second is kept aside.
function parseOld(file: string): { kind: 'io'; message: string } | { kind: 'unusable' } | { kind: 'ok'; entries: Record<string, string> } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { kind: 'io', message: e instanceof Error ? e.message : String(e) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'unusable' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'unusable' };
  return { kind: 'ok', entries: Object.fromEntries(Object.entries(raw).flatMap(([k, v]) => (typeof v === 'string' && v.trim() ? [[k, v.trim()]] : []))) };
}

// What the config schema accepts as a command: a value it refuses would make the stored config invalid and get the whole map reset on load.
const movable = (command: string): boolean => command.length <= VERIFY_COMMAND_MAX && !command.includes('\0');

/** The commands no workspace claimed at the move, for the settings note. Empty when there are none or the file cannot be read. */
export function readUnclaimed(root: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(join(root, VERIFY_UNCLAIMED_FILE), 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim()));
  } catch {
    return {};
  }
}

function mirrorsOf(config: WorkspaceConfig, deps: MoveDeps): string[] {
  const sync = config.externalTools.releaseSync;
  if (!sync.enabled || !sync.command.trim() || !sync.mirrorsDir?.trim()) return [];
  return (deps.mirrors ?? mirroredProjects)(expandHome(sync.mirrorsDir, deps.home));
}

function note(deps: MoveDeps, message: string): void {
  deps.log(message);
  try {
    mkdirSync(workspacesDir(deps.root), { recursive: true });
    appendFileSync(join(workspacesDir(deps.root), 'migration.log'), `${deps.now().toISOString()} ${message}\n`);
  } catch {}
}

/**
 * Copies each command of the old global file into the workspaces that own its project (a repository or a release mirror of that workspace),
 * never replacing a command the workspace already has, then renames the file to a backup. Safe to run twice and with an invalid workspace
 * config: that workspace is left untouched and the file stays until every workspace could be read. Never throws.
 */
export function moveVerifyCommands(deps: MoveDeps): MoveResult {
  const file = join(deps.root, VERIFY_FILE);
  const result: MoveResult = { status: 'none', copied: {}, unclaimed: [], deferred: [], backup: null };
  try {
    if (!existsSync(file)) return result;
    const parsed = parseOld(file);
    if (parsed.kind === 'io') {
      result.status = 'deferred';
      // i18n-ignore: migration log written for developers
      note(deps, `${VERIFY_FILE} not moved: it cannot be read (${parsed.message}), trying again at the next start`);
      return result;
    }
    if (parsed.kind === 'unusable') {
      result.backup = backupName(deps.root, deps.now());
      renameSync(file, result.backup);
      result.status = 'unusable';
      // i18n-ignore: migration log written for developers
      note(deps, `${VERIFY_FILE} is not a JSON object: kept as ${result.backup}, nothing moved`);
      return result;
    }
    const old = parsed.entries;
    const registry = readRegistry(deps.root);
    if (!registry) {
      result.status = 'deferred';
      // i18n-ignore: migration log written for developers
      note(deps, `${VERIFY_FILE} not moved: the workspaces registry cannot be read, trying again at the next start`);
      return result;
    }
    const claimed = new Set<string>();
    for (const w of registry.list) {
      const dir = workspaceDir(deps.root, w.id);
      const stored = readConfigFile(dir);
      // A workspace folder with no config yet has no repos: nothing to claim and nothing to wait for.
      if (stored === undefined && !existsSync(join(dir, 'config.json'))) continue;
      const checked = validateConfig(stored);
      if (!checked.ok || !checked.config) {
        result.deferred.push(w.id);
        // i18n-ignore: migration log written for developers
        note(deps, `workspace ${w.id}: config not usable, its verification commands wait (${summarizeIssues(checked.errors, 2)})`);
        continue;
      }
      const config = checked.config;
      const mine = new Set(ownVerifyProjects(config, mirrorsOf(config, deps)));
      const claims = Object.entries(old).filter(([project, command]) => mine.has(project) && movable(command));
      for (const [project] of claims) claimed.add(project);
      const added = claims.filter(([project]) => !(config.projects.verifyCommands[project] ?? '').trim());
      if (!added.length) continue;
      const merged = { ...config, projects: { ...config.projects, verifyCommands: { ...config.projects.verifyCommands, ...Object.fromEntries(added) } } };
      const mergedCheck = validateConfig(merged);
      if (!mergedCheck.ok) {
        result.deferred.push(w.id);
        // i18n-ignore: migration log written for developers
        note(deps, `workspace ${w.id}: the config would be invalid with the commands added, left as it is (${summarizeIssues(mergedCheck.errors, 2)})`);
        continue;
      }
      try {
        writeConfigFile(dir, merged);
        result.copied[w.id] = added.map(([project]) => project).sort();
        // i18n-ignore: migration log written for developers
        note(deps, `workspace ${w.id}: ${added.length} verification command(s) copied (${result.copied[w.id].join(', ')})`);
      } catch (e) {
        result.deferred.push(w.id);
        // i18n-ignore: migration log written for developers
        note(deps, `workspace ${w.id}: could not write the config (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (result.deferred.length) {
      result.status = 'deferred';
      // i18n-ignore: migration log written for developers
      note(deps, `${VERIFY_FILE} kept in place: ${result.deferred.join(', ')} could not be read, trying again at the next start`);
      return result;
    }
    const orphans = Object.entries(old).filter(([project]) => !claimed.has(project));
    result.unclaimed = orphans.map(([project]) => project).sort();
    if (orphans.length) {
      // An entry already in the sidecar is kept as it is: a command put aside earlier is never replaced by a later file.
      const earlier = readUnclaimed(deps.root);
      for (const [project, command] of orphans) {
        // i18n-ignore: migration log written for developers
        if (project in earlier && earlier[project] !== command) note(deps, `${VERIFY_UNCLAIMED_FILE} already has a command for ${project}: kept, the one in the old file stays in the backup only`);
      }
      atomicWrite(join(deps.root, VERIFY_UNCLAIMED_FILE), `${JSON.stringify({ ...Object.fromEntries(orphans), ...earlier }, null, 2)}\n`);
    }
    result.backup = backupName(deps.root, deps.now());
    renameSync(file, result.backup);
    result.status = 'moved';
    // i18n-ignore: migration log written for developers
    if (result.unclaimed.length) note(deps, `${result.unclaimed.length} verification command(s) belong to no workspace (${result.unclaimed.join(', ')}): kept in ${VERIFY_UNCLAIMED_FILE} and ${result.backup}`);
    // i18n-ignore: migration log written for developers
    note(deps, `${VERIFY_FILE} moved into the workspaces; the original is ${result.backup}`);
    return result;
  } catch (e) {
    result.status = 'deferred';
    // i18n-ignore: migration log written for developers
    note(deps, `${VERIFY_FILE} not moved (${e instanceof Error ? e.message : String(e)})`);
    return result;
  }
}
