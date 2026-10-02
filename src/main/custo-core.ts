import { CUSTO_LABEL, type CustoKey, type CustoKind, type CustoRow, type CustoSummary } from '../shared/custo';

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
}

export interface GenRef {
  id: string;
  at: number;
  kind: CustoKind;
  session: string;
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
      const o = JSON.parse(line) as { type?: string; timestamp?: string; message?: { id?: string } };
      const id = o.message?.id;
      if (o.type === 'assistant' && id?.startsWith('gen-') && o.timestamp && !seen.has(id)) seen.set(id, { id, at: Date.parse(o.timestamp), kind, session });
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

export function summarize(args: {
  gens: GenStat[];
  pending: number;
  goal: number;
  key: CustoKey | null;
  keyError: string | null;
  refreshedAt: string | null;
  now?: number;
}): CustoSummary {
  const now = args.now ?? Date.now();
  const today = day(now);
  const weekFrom = now - 7 * 86_400_000;
  const month = today.slice(0, 7);
  const byDay = new Map<string, GenStat[]>();
  for (const g of args.gens) byDay.set(day(g.at), [...(byDay.get(day(g.at)) ?? []), g]);

  const week = args.gens.filter((g) => g.at >= weekFrom);
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
    month: row('month', 'Este mês', args.gens.filter((g) => day(g.at).startsWith(month))),
    // Spent so far plus the pace of the last 7 days for the days left; the month alone is too noisy in its first days.
    projected: args.key ? args.key.usageMonthly + (args.key.usageWeekly / 7) * (daysInMonth - d.getDate()) : null,
    days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, g]) => row(date, date, g)),
    kinds,
    sessions: new Set(args.gens.map((g) => g.session)).size,
  };
}
