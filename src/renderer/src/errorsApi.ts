import type { ErrorsSummary, ErrorsView } from '../../shared/errorlog';
import { api, moduleEvents } from './api';

export const errorsApi = {
  get: () => api.invoke<ErrorsView>('errors:get'),
  summary: () => api.invoke<ErrorsSummary>('errors:summary'),
  seen: () => api.invoke<ErrorsSummary>('errors:seen'),
  clear: () => api.invoke<ErrorsView>('errors:clear'),
  onChanged(cb: (s: ErrorsSummary) => void): () => void {
    const h = (e: Event) => cb((e as CustomEvent<ErrorsSummary>).detail);
    moduleEvents.addEventListener('errors:changed', h);
    return () => moduleEvents.removeEventListener('errors:changed', h);
  },
};
