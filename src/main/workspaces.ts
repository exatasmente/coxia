import type { WorkspacesView } from '../shared/workspaces';
import { WORKSPACE_EVENT } from '../shared/workspaces';
import { dataRoot, workspaceId } from './env';
import { requireHost, restartProcess } from './host';
import type { Module } from './module';
import { stopWebAccess } from './webAccess';
import { createWorkspace, deleteWorkspace, readRegistry, renameWorkspace, setTestFlag, switchWorkspace } from './workspaces-core';
import { t } from '../shared/i18n';

const RESTART_DELAY_MS = 700;

function view(): WorkspacesView {
  const reg = readRegistry(dataRoot());
  if (!reg) throw new Error(t('main.workspaces.registryUnreadable'));
  return { ...reg, running: workspaceId() };
}

// The workspace is fixed for the life of the process (env.ts), so the only way to change it is a fresh process.
async function restart(): Promise<void> {
  try {
    await stopWebAccess();
  } catch {}
  restartProcess();
}

export const workspaces: Module = (ctx) => {
  const announce = (): WorkspacesView => {
    const v = view();
    ctx.emit({ type: 'module', name: WORKSPACE_EVENT, payload: v });
    return v;
  };
  ctx.handle('workspace:list', () => view());
  ctx.handle('workspace:create', (name: string, copySettings: boolean) => {
    createWorkspace(dataRoot(), { name, copySettings: copySettings !== false });
    return announce();
  });
  ctx.handle('workspace:rename', (id: string, name: string) => {
    renameWorkspace(dataRoot(), id, name);
    return announce();
  });
  ctx.handle('workspace:test', (id: string, test: boolean) => {
    setTestFlag(dataRoot(), id, test === true);
    return announce();
  });
  ctx.handle('workspace:switch', (id: string) => {
    if (id === workspaceId() && readRegistry(dataRoot())?.current === id) return { restarting: false };
    // Switching takes a fresh process: a host that cannot start one refuses before the registry moves.
    requireHost('restart');
    switchWorkspace(dataRoot(), id);
    setTimeout(() => void restart(), RESTART_DELAY_MS);
    return { restarting: true };
  });
  ctx.handle('workspace:delete', (id: string, typedName: string) => {
    if (id === workspaceId()) throw new Error(t('main.workspaces.deleteCurrent'));
    deleteWorkspace(dataRoot(), id, typedName);
    return announce();
  });
};
