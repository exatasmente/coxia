import { useEffect, useState } from 'react';
import type { EfeitosView } from '../../shared/efeitos';
import type { Effect } from '../../shared/types';
import { api, moduleEvents } from './api';

export const efeitosApi = {
  status: () => api.invoke<EfeitosView>('efeitos:status'),
  mark: (effect: Effect, ceremonyId: string | null, done: boolean) => api.invoke<EfeitosView>('efeitos:mark', effect, ceremonyId, done),
  check: () => api.invoke<EfeitosView>('efeitos:check'),
};

// Status of every effect of the last 7 days; refreshed when the 30-minute job finishes.
export function useEfeitos(): { view: EfeitosView | null; set: (v: EfeitosView) => void } {
  const [view, set] = useState<EfeitosView | null>(null);
  useEffect(() => {
    let alive = true;
    void efeitosApi.status().then((v) => alive && set(v)).catch(() => undefined);
    const on = (e: Event) => set((e as CustomEvent<EfeitosView>).detail);
    moduleEvents.addEventListener('efeitos:changed', on);
    return () => {
      alive = false;
      moduleEvents.removeEventListener('efeitos:changed', on);
    };
  }, []);
  return { view, set };
}
