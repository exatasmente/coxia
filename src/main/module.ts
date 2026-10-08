import type { AppEvent } from '../shared/types';
import type { Notice } from './scheduler';

export interface Job {
  name: string;
  everyMin: number;
  // Only on the configured days and inside the configured hours (Settings → Agenda).
  workHoursOnly: boolean;
  // The integration the job needs is configured in this workspace; a job that is not enabled is not run (no error noise on a fresh install).
  enabled?: () => boolean;
  run(): Promise<void>;
}

export interface ModuleContext {
  // The rpc registry: IPC for the window and the HTTP RPC for the browser; the renderer calls api.invoke(channel, ...args).
  handle(channel: string, fn: (...args: never[]) => unknown): void;
  notify(n: Notice): void;
  emit(ev: AppEvent): void;
  job(job: Job): void;
  // The integration the day's cards read, handed to a module that must decide whether the workspace has a usable host (the board).
  deps?(d: { boardReady(): boolean }): void;
}

export type Module = (ctx: ModuleContext) => void;
