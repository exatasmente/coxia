import { tagArgs } from '../../shared/activity';
import { buildApi } from '../../shared/apiChannels';
import { CONTRACT_VERSION, ContractError, HELLO_CHANNEL, type Hello, type Settled } from '../../shared/contract';
import type { Api } from '../../shared/types';
import { currentJob } from './jobs';

// The preload also hands over `call`, which keeps the error code that a thrown error would lose crossing the bridge.
const bridge = (window as unknown as { api: Api & { call?: (channel: string, ...args: unknown[]) => Promise<Settled> } }).api;

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (!bridge.call) return bridge.invoke(channel, ...args);
  const settled = await bridge.call(channel, ...args);
  if (!settled.ok) throw new ContractError(settled.error.code, settled.error.message);
  return settled.value;
}

// A call made for a job carries its id, so the main process can say which job an agent run belongs to.
export const api: Api = buildApi((channel, ...args) => invoke(channel, ...tagArgs(args, currentJob())), bridge.onEvent, { copy: bridge.copy });

/** Tells the instance which contract this window was built with; rejects with the refusal (both versions in its message) when they differ. */
export const contractHello = (): Promise<Hello> => invoke(HELLO_CHANNEL, CONTRACT_VERSION) as Promise<Hello>;

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

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Main-process modules emit { type: 'module', name, payload }; screens listen with moduleEvents.addEventListener(name, …).
export const moduleEvents = new EventTarget();
