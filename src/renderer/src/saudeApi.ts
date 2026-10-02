import type { SaudeSnapshot } from '../../shared/saude';
import { api, moduleEvents } from './api';

export const saudeApi = {
  get: () => api.invoke<SaudeSnapshot>('saude:get'),
  check: () => api.invoke<SaudeSnapshot>('saude:check'),
  onChanged(cb: (s: SaudeSnapshot) => void): () => void {
    const h = (e: Event) => cb((e as CustomEvent<SaudeSnapshot>).detail);
    moduleEvents.addEventListener('saude:changed', h);
    return () => moduleEvents.removeEventListener('saude:changed', h);
  },
};
