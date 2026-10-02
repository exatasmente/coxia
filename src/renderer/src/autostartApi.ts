import { api } from './api';

export const autostartApi = {
  get: () => api.invoke<boolean>('autostart:get'),
  set: (on: boolean) => api.invoke<boolean>('autostart:set', on),
};
