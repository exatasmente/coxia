import { useEffect, useState } from 'react';
import type { UpdateInfo } from '../../shared/update';
import { UPDATES_EVENT, type UpdateSettings, type UpdatesStatus } from '../../shared/updates';
import { api, moduleEvents } from './api';
import { isWeb } from './platform';

export interface InstallResult {
  ok: boolean;
  reason?: 'busy' | 'not-ready' | 'not-release' | 'failed';
}

export const updateApi = {
  info: () => api.invoke<UpdateInfo>('update:info'),
  run: () => api.invoke<{ logPath: string }>('update:run'),
  seen: () => api.invoke<void>('update:seen'),
  status: () => api.invoke<UpdatesStatus>('update:status'),
  check: (opts?: { allowDowngrade?: boolean }) => api.invoke<UpdatesStatus>('update:check', opts),
  saveSettings: (settings: UpdateSettings) => api.invoke<UpdatesStatus>('update:settings-save', settings),
  install: (opts?: { force?: boolean }) => api.invoke<InstallResult>('update:install', opts),
  busy: (value: boolean) => api.invoke<void>('update:busy', value),
};

// The status of the updates, kept current: read at mount and again whenever the main process says something changed. Desktop only (null in the browser); the setter takes an answer a call already returned.
export function useUpdatesStatus(): readonly [UpdatesStatus | null, (s: UpdatesStatus) => void] {
  const [status, setStatus] = useState<UpdatesStatus | null>(null);
  useEffect(() => {
    if (isWeb()) return;
    let live = true;
    const read = () => void updateApi.status().then((s) => live && setStatus(s), () => undefined);
    read();
    moduleEvents.addEventListener(UPDATES_EVENT, read);
    return () => {
      live = false;
      moduleEvents.removeEventListener(UPDATES_EVENT, read);
    };
  }, []);
  return [status, setStatus] as const;
}

// The main process never restarts for an update while something is running unless the person confirms: it needs to know what is.
export function useReportUpdateBusy(busy: boolean): void {
  useEffect(() => {
    if (isWeb()) return;
    void updateApi.busy(busy).catch(() => undefined);
  }, [busy]);
}
