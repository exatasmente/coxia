import { useEffect, useState } from 'react';
import {
  CLAUDE_SESSIONS_ASKS_EVENT,
  CLAUDE_SESSIONS_LINES_EVENT,
  CLAUDE_SESSIONS_STATE_EVENT,
  type ClaudeAnswerResult,
  type ClaudeOwnedSession,
  type ClaudeSessionLines,
  type ClaudeSessionResult,
  type ClaudeSessionsList,
  type PendingClaudePermission,
  type PermissionDecision,
} from '../../shared/claudeSessions';
import { api, moduleEvents } from './api';
import { isWeb } from './platform';

// The channels of the machine's Claude Code sessions. They answer the desktop window only: a paired browser never calls them and never shows the screen.

/** Fired on window when the switch changed in Settings, so the navigation shows or hides the row. */
const SWITCHED = 'coxia:claude-sessions-switched';

const listen = <T>(name: string, cb: (v: T) => void): (() => void) => {
  const h = (e: Event) => cb((e as CustomEvent<T>).detail);
  moduleEvents.addEventListener(name, h);
  return () => moduleEvents.removeEventListener(name, h);
};

export const claudeSessionsApi = {
  enabled: () => api.invoke<boolean>('claudeSessions:enabled'),
  async setEnabled(on: boolean): Promise<boolean> {
    const v = await api.invoke<boolean>('claudeSessions:set-enabled', on);
    window.dispatchEvent(new Event(SWITCHED));
    return v;
  },
  list: () => api.invoke<ClaudeSessionsList>('claudeSessions:list'),
  read: (id: string) => api.invoke<ClaudeSessionLines>('claudeSessions:read', id),
  follow: (id: string | null) => api.invoke<void>('claudeSessions:follow', id ?? ''),
  folders: () => api.invoke<string[]>('claudeSessions:folders'),
  send: (id: string, text: string) => api.invoke<ClaudeSessionResult>('claudeSessions:send', id, text),
  asks: () => api.invoke<PendingClaudePermission[]>('claudeSessions:asks'),
  answer: (id: string, decision: PermissionDecision) => api.invoke<ClaudeAnswerResult>('claudeSessions:answer', id, decision),
  stop: (id: string) => api.invoke<ClaudeSessionResult>('claudeSessions:stop', id),
  end: (id: string) => api.invoke<ClaudeSessionResult>('claudeSessions:end', id),
  start: (folder: string, text: string) => api.invoke<ClaudeSessionResult>('claudeSessions:start', folder, text),
  onLines: (cb: (v: ClaudeSessionLines) => void) => listen(CLAUDE_SESSIONS_LINES_EVENT, cb),
  onAsks: (cb: (v: PendingClaudePermission[]) => void) => listen(CLAUDE_SESSIONS_ASKS_EVENT, cb),
  onState: (cb: (v: ClaudeOwnedSession[]) => void) => listen(CLAUDE_SESSIONS_STATE_EVENT, cb),
};

/** Whether the feature is on, in the desktop window; always false in a paired browser. */
export function useClaudeSessionsOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (isWeb()) return;
    let live = true;
    const load = (): void => void claudeSessionsApi.enabled().then((v) => live && setOn(v === true), () => undefined);
    load();
    window.addEventListener(SWITCHED, load);
    return () => {
      live = false;
      window.removeEventListener(SWITCHED, load);
    };
  }, []);
  return on;
}
