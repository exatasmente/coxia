import { useSyncExternalStore } from 'react';
import { WORKSPACE_EVENT, type WorkspaceInfo, type WorkspacesView } from '../../shared/workspaces';
import { api, moduleEvents } from './api';
import './workspaces.css';

export const workspaceApi = {
  list: () => api.invoke<WorkspacesView>('workspace:list'),
  create: (name: string, copySettings: boolean) => api.invoke<WorkspacesView>('workspace:create', name, copySettings),
  rename: (id: string, name: string) => api.invoke<WorkspacesView>('workspace:rename', id, name),
  setTest: (id: string, test: boolean) => api.invoke<WorkspacesView>('workspace:test', id, test),
  switchTo: (id: string) => api.invoke<{ restarting: boolean }>('workspace:switch', id),
  remove: (id: string, typedName: string) => api.invoke<WorkspacesView>('workspace:delete', id, typedName),
};

let state: WorkspacesView | null = null;
let started = false;
const subscribers = new Set<() => void>();

export const runningWorkspace = (v: WorkspacesView | null): WorkspaceInfo | null => v?.list.find((w) => w.id === v.running) ?? null;

function set(next: WorkspacesView): void {
  state = next;
  // Heroes of the ceremony screens show the "Workspace de testes" tag from this attribute (styles.css).
  if (runningWorkspace(next)?.test) document.documentElement.dataset.workspaceTest = '1';
  else delete document.documentElement.dataset.workspaceTest;
  for (const fn of subscribers) fn();
}

function start(): void {
  if (started) return;
  started = true;
  moduleEvents.addEventListener(WORKSPACE_EVENT, (e) => set((e as CustomEvent<WorkspacesView>).detail));
  void workspaceApi.list().then(set, () => {
    started = false;
  });
}

export const publishWorkspaces = set;

/** The registry as the app last knew it: loaded once, kept current by the `workspace` module event. */
export function useWorkspaces(): WorkspacesView | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
  );
}
