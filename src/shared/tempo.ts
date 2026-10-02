export type TempoKind = 'pre-daily' | 'desbloqueio' | 'gate' | 'qa' | 'retro' | 'daily';

export const TEMPO_LABEL: Record<TempoKind, string> = {
  'pre-daily': 'pré-daily',
  desbloqueio: 'desbloqueio',
  gate: 'gate',
  qa: 'passagem ao QA',
  retro: 'retro',
  daily: 'daily',
};

// Same shape as a block of a time-tracking activity, plus the fields the app knows for sure.
export interface TempoBlock {
  start: string;
  end: string;
  minutes: number;
  seconds: number;
  projects: string[];
  gitlab_ids: { issues: string[]; mrs: string[] };
  events: { time: string; kind: string; project: string; text: string }[];
  ceremony: TempoKind;
  ref: string | null;
  sessionId: string | null;
  description: string;
}

// One entry of a time export; never overlaps another one.
export interface TempoEntry {
  start: string;
  end: string;
  description: string;
  issue: string | null;
  ceremony: TempoKind;
}

export interface TempoIssue {
  issue: string | null;
  title: string;
  minutes: number;
  byCeremony: Partial<Record<TempoKind, number>>;
}

export interface TempoDay {
  version: 1;
  source: 'cerimonias';
  date: string;
  generatedAt: string;
  blocks: TempoBlock[];
  entries: TempoEntry[];
  issues: TempoIssue[];
  totalMinutes: number;
  file: string;
}
