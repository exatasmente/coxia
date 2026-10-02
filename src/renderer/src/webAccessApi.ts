import type { WebSettings } from '../../shared/settings';
import type { PairingCode, WebView } from '../../shared/webAccess';
import { api } from './api';

export const webAccessApi = {
  view: () => api.invoke<WebView>('web:view'),
  configure: (patch: Partial<WebSettings>) => api.invoke<WebView>('web:configure', patch),
  pair: () => api.invoke<PairingCode>('web:pair'),
  cancelPair: () => api.invoke<void>('web:unpair'),
  rename: (id: string, name: string) => api.invoke<WebView>('web:rename', id, name),
  revoke: (id: string) => api.invoke<WebView>('web:revoke', id),
};
