import { t } from './i18n';

export type RetentionKind = 'sessoes' | 'historico' | 'gates' | 'qa' | 'retros' | 'atividade' | 'feedback';

/** The name of a kind of retained data, in the language of the running process. */
export const retentionLabel = (kind: RetentionKind): string => t(`main.retention.kind.${kind}`);

export const RETENTION_MIN_DAYS = 7;
export const RETENTION_MAX_DAYS = 365;

export interface RetentionItem {
  kind: RetentionKind;
  name: string;
  size: number;
  mtime: string;
  reason: string;
}

export interface RetentionGroup {
  kind: RetentionKind;
  label: string;
  count: number;
  bytes: number;
}

export interface RetentionPreview {
  days: number;
  cutoff: string;
  groups: RetentionGroup[];
  items: RetentionItem[];
  count: number;
  bytes: number;
  // Same list, same files, same modification times: "Apagar agora" only runs if this still matches.
  fingerprint: string;
  // Sessions the app never touches, to show the filter is working.
  untouchedSessions: number;
}

export interface RetentionResult {
  deleted: number;
  bytes: number;
  failed: { name: string; error: string }[];
}
