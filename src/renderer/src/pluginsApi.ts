import type { PluginsView } from '../../shared/plugins/view';
import type { PluginAnswer, PluginNeed } from '../../shared/plugins/grants';
import { api } from './api';

// The plugins of the workspace: the list, the switch, the answer to a plugin's request and taking a permission back. Every call but the list is the
// computer's only (webPolicy.ts): a paired browser sees the list and may block an announced write (actions:skip), never widen what a plugin reaches.
export const pluginsApi = {
  list: () => api.invoke<PluginsView>('plugins:list'),
  setEnabled: (id: string, enabled: boolean) => api.invoke<PluginsView>('plugins:set-enabled', id, enabled),
  settings: (dir: string, confirmSeconds: number) => api.invoke<PluginsView>('plugins:settings', dir, confirmSeconds),
  setSetting: (id: string, key: string, value: string) => api.invoke<PluginsView>('plugins:set-setting', id, key, value),
  setSecret: (id: string, key: string, value: string) => api.invoke<PluginsView>('plugins:set-secret', id, key, value),
  answer: (actionId: string, answer: PluginAnswer) => api.invoke<PluginsView>('plugins:answer', actionId, answer),
  revoke: (id: string, need: PluginNeed) => api.invoke<PluginsView>('plugins:revoke', id, need),
  revokeWrite: (actionId: string) => api.invoke<PluginsView>('plugins:revoke-write', actionId),
};
