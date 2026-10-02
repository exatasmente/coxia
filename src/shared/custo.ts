export type CustoKind = 'turn' | 'deep' | 'gate' | 'qa' | 'retro' | 'teams' | 'release';

// 'current' sums only the sessions the running workspace started; 'all' sums every session found, including the ones no workspace claimed.
export type CustoScope = 'current' | 'all';

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
  // Month spend of the whole key (Claude Code through OpenRouter included) plus the last 7 days' pace for the days left.
  projected: number | null;
  days: CustoRow[];
  kinds: CustoRow[];
  sessions: number;
  falas: CustoFalas;
  scope: CustoScope;
  workspace: { id: string; name: string; test: boolean };
  // Every workspace plus "sem workspace" (id null) for sessions that predate the index; the biggest month first.
  byWorkspace: CustoWorkspaceRow[];
  // App sessions no workspace claimed: they only show in the 'all' scope.
  unassigned: number;
}

export interface CustoWorkspaceRow {
  id: string | null;
  name: string;
  test: boolean;
  today: number;
  week: number;
  month: number;
  calls: number;
  sessions: number;
}

export interface CustoModelRow {
  model: string;
  speeches: number;
  cost: number;
  // Real average price of one agent speech (one pre-daily session) on this model.
  avg: number;
}

export interface CustoFalas {
  reusedToday: number;
  reusedWeek: number;
  // Average real price of one speech in the last 7 days; the base of the avoided cost.
  avgPerSpeech: number | null;
  avoidedToday: number | null;
  avoidedWeek: number | null;
  byModel: CustoModelRow[];
}
