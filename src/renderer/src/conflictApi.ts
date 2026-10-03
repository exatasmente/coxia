import { api } from './api';

export interface VerifyConfig {
  commands: Record<string, string>;
  projects: string[];
  unclaimed: Record<string, string>;
}

export const conflictApi = {
  verifyConfig: () => api.invoke<VerifyConfig>('conflicts:verify-get'),
  setVerifyCommands: (commands: Record<string, string>) => api.invoke<VerifyConfig>('conflicts:verify-set', commands),
};
