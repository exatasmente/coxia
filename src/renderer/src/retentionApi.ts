import type { RetentionPreview, RetentionResult } from '../../shared/retention';
import { api } from './api';

export const retentionApi = {
  preview: (days: number) => api.invoke<RetentionPreview>('retention:preview', days),
  apply: (days: number, fingerprint: string) => api.invoke<RetentionResult>('retention:apply', days, fingerprint),
};
