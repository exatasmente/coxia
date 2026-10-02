import type { Api } from '../../shared/types';

export const api = (window as unknown as { api: Api }).api;

export const AGENT_COLORS = ['#0F766E', '#6D28D9', '#C2410C', '#1D4ED8', '#9D174D', '#4D7C0F', '#374151', '#0E7490'];

export function clock(start: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function shortRef(ref: string): string {
  return ref.split('#').pop()?.slice(-2) ?? ref;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
}
