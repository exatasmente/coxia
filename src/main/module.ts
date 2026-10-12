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
  // To the desktop window and to every paired browser.
  emit(ev: AppEvent): void;
  // To the desktop window only, never through broadcast: for a feature a paired browser must not see. Absent outside the desktop app, where nothing is sent.
  emitWindow?(ev: AppEvent): void;
  job(job: Job): void;
}

export type Module = (ctx: ModuleContext) => void;
