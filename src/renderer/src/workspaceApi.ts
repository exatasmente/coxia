import { useSyncExternalStore } from 'react';
import { WORKSPACE_EVENT, type WorkspaceInfo, type WorkspacesView } from '../../shared/workspaces';
import { api, moduleEvents } from './api';
import { subscribeLanguage, t } from '../../shared/i18n';
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

// Heroes of the ceremony screens show the test workspace tag from this attribute; its text is a CSS variable so it follows the language.
function markTestWorkspace(): void {
  const root = document.documentElement;
  if (state && runningWorkspace(state)?.test) {
    root.dataset.workspaceTest = '1';
    root.style.setProperty('--workspace-test-label', JSON.stringify(t('ui.today.testWorkspace')));
  } else {
    delete root.dataset.workspaceTest;
    root.style.removeProperty('--workspace-test-label');
  }
}

subscribeLanguage(markTestWorkspace);

function set(next: WorkspacesView): void {
  state = next;
  markTestWorkspace();
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
