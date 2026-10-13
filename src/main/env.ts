import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectExistingInstall } from './config-bootstrap';
import { ensureWorkspaces, workspaceDir } from './workspaces-core';

// Where things live on disk. Nothing here depends on a company or a project: what a workspace decides (repos, hosts, tools, models)
// is in its WorkspaceConfig, read through workspaceConfig.ts.
// Nothing happens on import: the host gives the data folder at boot (bootEnv), and every module reads the folders through the functions
// below at the time of use. One process runs one workspace; several workspaces on a machine are several processes.
export const HOME = homedir();

/** The data folder an install uses when nothing names another. */
export const STANDARD_DATA_DIR = join(HOME, '.local/share/cerimonias');
/** The default data folder: CERIMONIAS_DATA_DIR, or the standard one. */
export const defaultDataDir = (): string => process.env.CERIMONIAS_DATA_DIR ?? STANDARD_DATA_DIR;

interface Env {
  root: string;
  existingInstall: boolean;
  workspaceId: string;
  workspaceDir: string;
}

let env: Env | null = null;

/** Fixes the data folder of this process, creating or migrating the workspace registry in it. Once per process: a second boot with another folder is refused. */
export function bootEnv(options: { dataDir?: string } = {}): void {
  const root = options.dataDir ?? defaultDataDir();
  if (env) {
    // i18n-ignore: developer error: the data folder is fixed once per process
    if (env.root !== root) throw new Error(`the data folder is already ${env.root}`);
    return;
  }
  // Must be decided before the registry is created: afterwards a fresh root and an existing install look alike.
  const existingInstall = detectExistingInstall(root);
  const resolved = ensureWorkspaces(root);
  env = { root, existingInstall, workspaceId: resolved.registry.current, workspaceDir: workspaceDir(root, resolved.registry.current) };
}

// A process that never called bootEnv (a test, a script) gets the default folder at the first read, never at import.
const current = (): Env => {
  if (!env) bootEnv();
  return env as Env;
};

/** The data root: what every workspace shares (web access, paired devices, glossary, secrets, userData) and the workspaces themselves. */
export const dataRoot = (): string => current().root;
/** Whether the data root held an install made before the workspace registry existed. */
export const existingInstall = (): boolean => current().existingInstall;
/** The running workspace. Fixed for the life of the process: switching workspace starts a fresh one. */
export const workspaceId = (): string => current().workspaceId;
/** The running workspace's folder (history, config, actions...). */
export const atasDir = (): string => current().workspaceDir;
