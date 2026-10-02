import { api } from './api';

export const diagramApi = {
  fix: (code: string, error: string) => api.invoke<string>('diagram:fix', code, error),
};
