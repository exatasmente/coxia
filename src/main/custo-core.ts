import { CUSTO_LABEL, type CustoFalas, type CustoKey, type CustoKind, type CustoRow, type CustoScope, type CustoSummary, type CustoWorkspaceRow } from '../shared/custo';
import type { WorkspaceInfo } from '../shared/workspaces';

export const DEFAULT_GOAL = 20;

// A session belongs to the app when its first prompt starts like one of the prompts the app sends.
const FIRST_PROMPTS: [RegExp, CustoKind][] = [
  [/^Você é o agente da atividade /, 'turn'],
  [/^Desbloqueio por voz da atividade /, 'deep'],
  [/^Gate \d da issue /, 'gate'],
  [/^Passagem para o QA da issue /, 'qa'],
  [/^Retro semanal do Luiz/, 'retro'],
  [/^Escreva o texto que o Luiz vai colar no Teams/, 'teams'],
  [/^A issue sz4#\d+ foi sincronizada com a main/, 'release'],
  [/^Call sobre um conflito de sincronização/, 'release'],
  [/^Conflito de sincronização com a main depois de uma release/, 'release'],
];

export function classify(firstPrompt: string): CustoKind | null {
  return FIRST_PROMPTS.find(([re]) => re.test(firstPrompt))?.[1] ?? null;
}

export interface GenStat {
  cost: number;
  prompt: number;
  cached: number;
  completion: number;
  at: number;
  kind: CustoKind;
  session: string;
  model?: string;
}

export interface GenRef {
  id: string;
  at: number;
  kind: CustoKind;
  session: string;
  model?: string;
}

export function firstPromptOf(lines: Iterable<string>): string | null {
  for (const line of lines) {
    if (!line.includes('"type":"user"')) continue;
    try {
      const o = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      if (o.type !== 'user') continue;
      const c = o.message?.content;
      return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x?.text ?? '').join(' ') : '';
    } catch {}
  }
  return null;
}

// Each content block of one response is a transcript line with the same message id: count the id once.
export function gensOf(lines: Iterable<string>, kind: CustoKind, session: string): GenRef[] {
  const seen = new Map<string, GenRef>();
  for (const line of lines) {
    if (!line.includes('"gen-')) continue;
    try {
      const o = JSON.parse(line) as { type?: string; timestamp?: string; message?: { id?: string; model?: string } };
      const id = o.message?.id;
      if (o.type === 'assistant' && id?.startsWith('gen-') && o.timestamp && !seen.has(id)) {
        const model = o.message?.model;
        seen.set(id, { id, at: Date.parse(o.timestamp), kind, session, ...(model ? { model } : {}) });
      }
    } catch {}
  }
  return [...seen.values()];
}

export function parseKey(body: unknown): CustoKey {
  const d = (body as { data?: Record<string, unknown> }).data;
  if (!d || typeof d.usage !== 'number') throw new Error('resposta inesperada da OpenRouter');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    limit: typeof d.limit === 'number' ? d.limit : null,
    limitRemaining: typeof d.limit_remaining === 'number' ? d.limit_remaining : null,
    limitReset: typeof d.limit_reset === 'string' ? d.limit_reset : null,
    usage: d.usage,
    usageDaily: num(d.usage_daily),
    usageWeekly: num(d.usage_weekly),
    usageMonthly: num(d.usage_monthly),
  };
}

export function parseGeneration(body: unknown, ref: GenRef): GenStat {
  const d = (body as { data?: Record<string, unknown> }).data;
  const cost = d && (typeof d.total_cost === 'number' ? d.total_cost : d.usage);
  if (!d || typeof cost !== 'number') throw new Error('geração sem custo');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    cost,
    prompt: num(d.native_tokens_prompt) || num(d.tokens_prompt),
    cached: num(d.native_tokens_cached),
    completion: num(d.native_tokens_completion) || num(d.tokens_completion),
    at: typeof d.created_at === 'string' ? Date.parse(d.created_at) : ref.at,
    kind: ref.kind,
    session: ref.session,
    ...(ref.model ? { model: ref.model } : {}),
  };
}

function row(key: string, label: string, gens: GenStat[]): CustoRow {
  const prompt = gens.reduce((n, g) => n + g.prompt, 0);
  const cached = gens.reduce((n, g) => n + g.cached, 0);
  return { key, label, cost: gens.reduce((n, g) => n + g.cost, 0), calls: gens.length, cachePct: prompt ? (cached / prompt) * 100 : null };
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString('sv-SE');
}

// One agent speech is one 'turn' session, so the average per speech is the cost of those sessions' calls divided by their count.
export function falasOf(gens: GenStat[], reuses: number[], now: number): CustoFalas {
  const today = day(now);
  const weekFrom = now - 7 * 86_400_000;
  const turns = gens.filter((g) => g.kind === 'turn' && g.at >= weekFrom);
  const sessions = new Set(turns.map((g) => g.session)).size;
  const avgPerSpeech = sessions ? turns.reduce((n, g) => n + g.cost, 0) / sessions : null;
  const reusedToday = reuses.filter((t) => day(t) === today).length;
  const reusedWeek = reuses.filter((t) => t >= weekFrom).length;
  const models = new Map<string, { sessions: Set<string>; cost: number }>();
  for (const g of turns) {
    const m = models.get(g.model ?? 'desconhecido') ?? { sessions: new Set<string>(), cost: 0 };
    m.sessions.add(g.session);
    m.cost += g.cost;
    models.set(g.model ?? 'desconhecido', m);
  }
  return {
    reusedToday,
    reusedWeek,
    avgPerSpeech,
    avoidedToday: avgPerSpeech === null ? null : reusedToday * avgPerSpeech,
    avoidedWeek: avgPerSpeech === null ? null : reusedWeek * avgPerSpeech,
    byModel: [...models.entries()]
      .map(([model, m]) => ({ model, speeches: m.sessions.size, cost: m.cost, avg: m.cost / m.sessions.size }))
      .sort((a, b) => b.speeches - a.speeches),
  };
}

export const NO_WORKSPACE = 'sem workspace';

// The workspace that started a session, or null when none did (sessions from before the index existed).
export type Owners = ReadonlyMap<string, string>;

export function inScope(scope: CustoScope, current: string, owners: Owners): (session: string) => boolean {
  return (session) => scope === 'all' || owners.get(session) === current;
}

export function byWorkspaceOf(gens: GenStat[], owners: Owners, workspaces: WorkspaceInfo[], now: number): CustoWorkspaceRow[] {
  const today = day(now);
  const weekFrom = now - 7 * 86_400_000;
  const month = today.slice(0, 7);
  const known = new Set(workspaces.map((w) => w.id));
  const owner = (g: GenStat) => {
    const id = owners.get(g.session);
    return id && known.has(id) ? id : null;
  };
  const rows: CustoWorkspaceRow[] = [...workspaces.map((w) => ({ id: w.id as string | null, name: w.name, test: w.test })), { id: null, name: NO_WORKSPACE, test: false }].map((w) => {
    const mine = gens.filter((g) => owner(g) === w.id);
    const sum = (list: GenStat[]) => list.reduce((n, g) => n + g.cost, 0);
    return {
      ...w,
      today: sum(mine.filter((g) => day(g.at) === today)),
      week: sum(mine.filter((g) => g.at >= weekFrom)),
      month: sum(mine.filter((g) => day(g.at).startsWith(month))),
      calls: mine.length,
      sessions: new Set(mine.map((g) => g.session)).size,
    };
  });
  // "sem workspace" is listed only when there is something in it.
  return rows.filter((r) => r.id !== null || r.calls > 0).sort((a, b) => b.month - a.month || b.calls - a.calls);
}

export function summarize(args: {
  gens: GenStat[];
  pending: number;
  goal: number;
  key: CustoKey | null;
  keyError: string | null;
  refreshedAt: string | null;
  reuses?: number[];
  now?: number;
  scope?: CustoScope;
  owners?: Owners;
  workspaces?: WorkspaceInfo[];
  current?: WorkspaceInfo;
}): CustoSummary {
  const now = args.now ?? Date.now();
  const scope = args.scope ?? 'all';
  const owners = args.owners ?? new Map<string, string>();
  const workspaces = args.workspaces ?? [];
  const current = args.current ?? { id: '', name: '', createdAt: '', test: false };
  const everything = args.gens;
  const mine = inScope(scope, current.id, owners);
  const gens = everything.filter((g) => mine(g.session));
  const today = day(now);
  const weekFrom = now - 7 * 86_400_000;
  const month = today.slice(0, 7);
  const byDay = new Map<string, GenStat[]>();
  for (const g of gens) byDay.set(day(g.at), [...(byDay.get(day(g.at)) ?? []), g]);

  const week = gens.filter((g) => g.at >= weekFrom);
  const kinds = (Object.keys(CUSTO_LABEL) as CustoKind[])
    .map((k) => row(k, CUSTO_LABEL[k], week.filter((g) => g.kind === k)))
    .filter((r) => r.calls > 0)
    .sort((a, b) => b.cost - a.cost);

  const d = new Date(now);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    goal: args.goal,
    refreshedAt: args.refreshedAt,
    key: args.key,
    keyError: args.keyError,
    pending: args.pending,
    today: row('today', 'Hoje', byDay.get(today) ?? []),
    week: row('week', 'Últimos 7 dias', week),
    month: row('month', 'Este mês', gens.filter((g) => day(g.at).startsWith(month))),
    // Spent so far plus the pace of the last 7 days for the days left; the month alone is too noisy in its first days.
    projected: args.key ? args.key.usageMonthly + (args.key.usageWeekly / 7) * (daysInMonth - d.getDate()) : null,
    days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, g]) => row(date, date, g)),
    kinds,
    sessions: new Set(gens.map((g) => g.session)).size,
    // The price of a speech is a property of the model, so it comes from every workspace; only the reuses are this workspace's.
    falas: falasOf(everything, args.reuses ?? [], now),
    scope,
    workspace: { id: current.id, name: current.name, test: current.test },
    byWorkspace: byWorkspaceOf(everything, owners, workspaces, now),
    unassigned: new Set(everything.filter((g) => !owners.has(g.session)).map((g) => g.session)).size,
  };
}
