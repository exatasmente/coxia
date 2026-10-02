import type { AppEvent } from '../shared/types';
import type { Notice } from './scheduler';

export interface Job {
  name: string;
  everyMin: number;
  // Only on the configured days and inside the configured hours (Settings → Agenda).
  workHoursOnly: boolean;
  run(): Promise<void>;
}

export interface ModuleContext {
  // The rpc registry: IPC for the window and the HTTP RPC for the browser; the renderer calls api.invoke(channel, ...args).
  handle(channel: string, fn: (...args: never[]) => unknown): void;
  notify(n: Notice): void;
  emit(ev: AppEvent): void;
  job(job: Job): void;
}

export type Module = (ctx: ModuleContext) => void;
