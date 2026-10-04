import { useSyncExternalStore } from 'react';
import type { WorkspaceConfig } from '../../../../shared/config/types';
import { CONFIG_EVENT, type ConfigView } from '../../../../shared/configView';
import { FORUM_EVENT, type ForumEventPayload } from '../../../../shared/forum';
import type { CommandDecision, Run } from '../../../../shared/runs';
import { api, moduleEvents } from '../../api';

// The runs of the running workspace as the screens see them: the channels of the runner (`runs:*`), and one shared copy of the list that every screen
// follows. A run changes through moves that write to its thread, so a message in a run's thread is the cue to read the runs again; a slow timer and the
// window coming back cover a move that said nothing and an event stream that was cut.

export type GateAction = 'approve' | 'reject' | 'skip';

export interface UndoResult {
  proposed: boolean;
  reason?: 'refused' | 'nothing' | 'no-host';
}

export interface ArtifactText {
  text: string;
  clipped: boolean;
}

export const runsApi = {
  list: () => api.invoke<Run[]>('runs:list'),
  get: (id: string) => api.invoke<Run | null>('runs:get', id),
  start: (ref: string, repo?: string) => api.invoke<Run>('runs:start', ref, repo),
  startRelease: (version: string, from?: string, repo?: string) => api.invoke<Run>('runs:startRelease', version, from, repo),
  startStage: (id: string) => api.invoke<Run>('runs:startStage', id),
  accept: (id: string, note?: string) => api.invoke<Run>('runs:accept', id, note),
  returnStage: (id: string, note: string) => api.invoke<Run>('runs:return', id, note),
  gate: (id: string, action: GateAction, reason?: string) => api.invoke<Run>('runs:gate', id, action, reason),
  answer: (id: string, text: string) => api.invoke<Run>('runs:answer', id, text),
  retry: (id: string) => api.invoke<Run>('runs:retry', id),
  cancel: (id: string) => api.invoke<Run>('runs:cancel', id),
  command: (id: string, command: string, decision: CommandDecision, note: string) => api.invoke<Run>('runs:command', id, command, decision, note),
  skipWait: (id: string, reason: string) => api.invoke<Run>('runs:skipWait', id, reason),
  sendBack: (id: string, stage: string, note: string) => api.invoke<Run>('runs:sendBack', id, stage, note),
  migrateFlow: (id: string) => api.invoke<Run>('runs:migrateFlow', id),
  undoPost: (id: string, key: string) => api.invoke<UndoResult>('runs:undoPost', id, key),
  setSquad: (id: string, squad: string | null) => api.invoke<Run>('runs:setSquad', id, squad),
  setAutonomous: (agent: string, on: boolean) => api.invoke<boolean>('runs:setAutonomous', agent, on),
  setSquadAutonomous: (squad: string, on: boolean) => api.invoke<boolean>('runs:setSquadAutonomous', squad, on),
  artifact: (id: string, name: string) => api.invoke<ArtifactText | null>('runs:artifact', id, name),
};

const REFRESH_MS = 20_000;
const BURST_MS = 250;

let runs: readonly Run[] | null = null;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<() => void>();

function set(next: readonly Run[]): void {
  runs = next;
  for (const fn of subscribers) fn();
}

/** Puts a run the main process just returned into the shared list, so the screen that acted does not wait for the next read. */
export function patchRun(run: Run): void {
  const list = runs ?? [];
  const at = list.findIndex((r) => r.id === run.id);
  if (at >= 0 && list[at].rev > run.rev) return;
  set(at >= 0 ? list.map((r, i) => (i === at ? run : r)) : [run, ...list]);
}

export function reloadRuns(): void {
  void runsApi.list().then(set, () => undefined);
}

function soon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    reloadRuns();
  }, BURST_MS);
}

function start(): void {
  if (started) return;
  started = true;
  moduleEvents.addEventListener(FORUM_EVENT, (e) => {
    const thread = (e as CustomEvent<ForumEventPayload>).detail?.thread;
    if (typeof thread === 'string' && thread.startsWith('run-')) soon();
  });
  window.addEventListener('focus', soon);
  setInterval(() => {
    if (!document.hidden) reloadRuns();
  }, REFRESH_MS);
  reloadRuns();
}

/** Every run of the workspace, the newest changes first as the store keeps them; null until the first read. */
export function useRuns(): readonly Run[] | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => runs,
  );
}

/** One run from the shared list: null when the workspace has no such run, undefined while the list is still loading. */
export function useRun(id: string): Run | null | undefined {
  const all = useRuns();
  return all ? (all.find((r) => r.id === id) ?? null) : undefined;
}

// The workspace configuration, for what the run screens name: the team, the squads, the repositories. Read once and again whenever it is saved anywhere.
let config: WorkspaceConfig | null = null;
let configStarted = false;
const configSubscribers = new Set<() => void>();

/** Reads the configuration again: after a switch of the autonomy, which the main process writes into it. */
export function reloadConfig(): void {
  void api.invoke<ConfigView>('config:get').then(
    (v) => {
      config = v.config;
      for (const fn of configSubscribers) fn();
    },
    () => undefined,
  );
}

export function useRunConfig(): WorkspaceConfig | null {
  if (!configStarted) {
    configStarted = true;
    moduleEvents.addEventListener(CONFIG_EVENT, reloadConfig);
    reloadConfig();
  }
  return useSyncExternalStore(
    (fn) => {
      configSubscribers.add(fn);
      return () => configSubscribers.delete(fn);
    },
    () => config,
  );
}
