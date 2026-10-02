export type CustoKind = 'turn' | 'deep' | 'gate' | 'qa' | 'retro' | 'teams' | 'release';

export const CUSTO_LABEL: Record<CustoKind, string> = {
  turn: 'Pré-daily (agentes)',
  deep: 'Desbloqueio',
  gate: 'Gate',
  qa: 'Passagem para o QA',
  retro: 'Retro',
  teams: 'Texto do Teams',
  release: 'Release e conflitos',
};

export interface CustoKey {
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
}

export interface CustoRow {
  key: string;
  label: string;
  cost: number;
  calls: number;
  cachePct: number | null;
}

export interface CustoSummary {
  goal: number;
  refreshedAt: string | null;
  key: CustoKey | null;
  keyError: string | null;
  // Generations of the app sessions whose price is not known yet (too recent or the lookup failed).
  pending: number;
  today: CustoRow;
  week: CustoRow;
  month: CustoRow;
  // Projection of the month spend of the whole key (Claude Code through OpenRouter included).
  projected: number | null;
  days: CustoRow[];
  kinds: CustoRow[];
  sessions: number;
}
