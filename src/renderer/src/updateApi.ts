import type { UpdateInfo } from '../../shared/update';
import { api } from './api';

export const updateApi = {
  info: () => api.invoke<UpdateInfo>('update:info'),
  run: () => api.invoke<{ logPath: string }>('update:run'),
  seen: () => api.invoke<void>('update:seen'),
};
