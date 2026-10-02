import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectExistingInstall } from './config-bootstrap';
import { ensureWorkspaces, workspaceDir } from './workspaces-core';

// Where things live on disk. Nothing here depends on a company or a project: what a workspace decides (repos, hosts, tools, models)
// is in its WorkspaceConfig, read through workspaceConfig.ts.
export const HOME = homedir();
// The data root holds what every workspace shares (web access, paired devices, glossary, secrets, userData) and the workspaces themselves.
export const DATA_ROOT = process.env.CERIMONIAS_DATA_DIR ?? join(HOME, '.local/share/cerimonias');
// Must be decided before the registry is created: afterwards a fresh root and an existing install look alike.
export const EXISTING_INSTALL = detectExistingInstall(DATA_ROOT);
const resolved = ensureWorkspaces(DATA_ROOT);
// The current workspace's folder (history, config, actions...). Fixed at startup: switching workspace relaunches the app.
export const ATAS = workspaceDir(DATA_ROOT, resolved.registry.current);
export const WORKSPACE_ID = resolved.registry.current;
