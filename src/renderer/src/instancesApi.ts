import { useSyncExternalStore } from 'react';
import { EVENTS_RECONNECTED } from '../../shared/activity';
import { INSTANCE_EVENT, type InstanceInput, type InstanceStatus, type InstanceTest, type InstancesView } from '../../shared/instances';
import type { SecretsStorageStatus } from '../../shared/secrets';
import { api, moduleEvents } from './api';

// The instances this computer can connect to: the channels are the window's own, so they answer here even when the window is the client of a server.
export const instancesApi = {
  list: () => api.invoke<InstancesView>('instances:list'),
  add: (input: InstanceInput) => api.invoke<InstancesView>('instances:add', input),
  remove: (id: string) => api.invoke<InstancesView>('instances:remove', id),
  select: (id: string) => api.invoke<{ restarting: boolean }>('instances:select', id),
  test: (id: string) => api.invoke<InstanceTest>('instances:test', id),
  trust: (id: string, fingerprint: string) => api.invoke<InstanceTest>('instances:trust', id, fingerprint),
  acceptInsecure: () => api.invoke<SecretsStorageStatus>('instances:accept-insecure'),
};

let state: InstanceStatus | null = null;
let started = false;
const subscribers = new Set<() => void>();

function set(next: InstanceStatus): void {
  const back = state !== null && state.link !== 'connected' && next.link === 'connected';
  state = next;
  for (const fn of subscribers) fn();
  // The events missed while the link was down are not replayed: the screens read again, as they do after a paired browser's stream comes back.
  if (back) window.dispatchEvent(new Event(EVENTS_RECONNECTED));
}

function start(): void {
  if (started) return;
  started = true;
  moduleEvents.addEventListener(INSTANCE_EVENT, (e) => set((e as CustomEvent<InstanceStatus>).detail));
  void instancesApi.list().then((v) => set(v.status), () => {
    started = false;
  });
}

/** The connection to the instance the window is a client of; null while the core runs here or before it is known. */
export function useInstanceStatus(): InstanceStatus | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
  );
}

// Literal keys, so the catalog check sees each one used.
export const LINK_LABEL = { connecting: 'ui.settings.instances.link.connecting', connected: 'ui.settings.instances.link.connected', reconnecting: 'ui.settings.instances.link.reconnecting', lost: 'ui.settings.instances.link.lost' } as const;
export const ROLE_LABEL = { owner: 'ui.settings.instances.role.owner', client: 'ui.settings.instances.role.client' } as const;
