import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceConfig } from '../../../../shared/config/types';
import { CONFIG_EVENT, type ConfigView } from '../../../../shared/configView';
import type { Run } from '../../../../shared/runs';
import { api, errorText, moduleEvents } from '../../api';

// What the team and cycle screens call. Reading the configuration is open to a paired browser; everything that writes is desktop-only (webPolicy.ts),
// and the screens check isWeb() before they offer it.
export const teamApi = {
  config: () => api.invoke<ConfigView>('config:get'),
  save: (config: WorkspaceConfig) => api.invoke<ConfigView>('config:save', config),
  setAutonomous: (agent: string, on: boolean) => api.invoke<boolean>('runs:setAutonomous', agent, on),
  setSquadAutonomous: (squad: string, on: boolean) => api.invoke<boolean>('runs:setSquadAutonomous', squad, on),
  removeSquad: (squad: string, confirm: boolean) => api.invoke<{ removed: boolean; runs: string[] }>('runs:removeSquad', squad, confirm),
  runs: () => api.invoke<Run[]>('runs:list'),
};

/** The configuration as the screens last knew it: loaded once, kept current by the `config` event (a save or an import, anywhere). */
export function useConfigView(): { view: ConfigView | null; error: string | null; reload: () => void } {
  const [view, setView] = useState<ConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    teamApi.config().then(
      (v) => {
        setView(v);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => {
    reload();
    const onEvent = (e: Event) => setView((e as CustomEvent<ConfigView>).detail);
    moduleEvents.addEventListener(CONFIG_EVENT, onEvent);
    return () => moduleEvents.removeEventListener(CONFIG_EVENT, onEvent);
  }, [reload]);
  return { view, error, reload };
}
