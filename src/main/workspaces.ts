import { app } from 'electron';
import type { WorkspacesView } from '../shared/workspaces';
import { WORKSPACE_EVENT } from '../shared/workspaces';
import { DATA_ROOT, WORKSPACE_ID } from './env';
import type { Module } from './module';
import { stopWebAccess } from './webAccess';
import { createWorkspace, deleteWorkspace, readRegistry, renameWorkspace, setTestFlag, switchWorkspace } from './workspaces-core';
import { t } from '../shared/i18n';

const RESTART_DELAY_MS = 700;

function view(): WorkspacesView {
  const reg = readRegistry(DATA_ROOT);
  if (!reg) throw new Error(t('main.workspaces.registryUnreadable'));
  return { ...reg, running: WORKSPACE_ID };
}

// Every module reads its paths at import time, so the only way to change workspace is a fresh process.
async function restart(): Promise<void> {
  try {
    await stopWebAccess();
  } catch {}
  app.relaunch();
  app.quit();
  setTimeout(() => app.exit(0), 5000).unref();
}

export const workspaces: Module = (ctx) => {
  const announce = (): WorkspacesView => {
    const v = view();
    ctx.emit({ type: 'module', name: WORKSPACE_EVENT, payload: v });
    return v;
  };
  ctx.handle('workspace:list', () => view());
  ctx.handle('workspace:create', (name: string, copySettings: boolean) => {
    createWorkspace(DATA_ROOT, { name, copySettings: copySettings !== false });
    return announce();
  });
  ctx.handle('workspace:rename', (id: string, name: string) => {
    renameWorkspace(DATA_ROOT, id, name);
    return announce();
  });
  ctx.handle('workspace:test', (id: string, test: boolean) => {
    setTestFlag(DATA_ROOT, id, test === true);
    return announce();
  });
  ctx.handle('workspace:switch', (id: string) => {
    if (id === WORKSPACE_ID && readRegistry(DATA_ROOT)?.current === id) return { restarting: false };
    switchWorkspace(DATA_ROOT, id);
    setTimeout(() => void restart(), RESTART_DELAY_MS);
    return { restarting: true };
  });
  ctx.handle('workspace:delete', (id: string, typedName: string) => {
    if (id === WORKSPACE_ID) throw new Error(t('main.workspaces.deleteCurrent'));
    deleteWorkspace(DATA_ROOT, id, typedName);
    return announce();
  });
};
