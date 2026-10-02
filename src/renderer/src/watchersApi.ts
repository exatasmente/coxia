import type { WatcherAlert } from '../../shared/watchers';
import { api, moduleEvents } from './api';

export const watchersApi = {
  list: () => api.invoke<WatcherAlert[]>('watchers:list'),
  check: () => api.invoke<WatcherAlert[]>('watchers:check'),
  dismiss: (id: string) => api.invoke<WatcherAlert[]>('watchers:dismiss', id),
  onChanged(cb: (alerts: WatcherAlert[]) => void): () => void {
    const h = (e: Event) => cb((e as CustomEvent<WatcherAlert[]>).detail);
    moduleEvents.addEventListener('watchers:changed', h);
    return () => moduleEvents.removeEventListener('watchers:changed', h);
  },
};
