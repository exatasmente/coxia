import type { BudgetConfig } from './config/types';

// The operating budget (#198), pure: what a ledger line is, how a month is summed and how a spend is judged against the limits. Nothing here reads the disk or the
// config, so the main process, the renderer and a test all use the same arithmetic. The amounts are in `BudgetConfig.currency`; a line of another currency is refused at the door.

/** The categories the app knows by name; a category added later is just another key of `BudgetConfig.categories`. */
export const BUDGET_CATEGORIES = ['model', 'infrastructure', 'domains'] as const;

/** The provider id a run waits on when the workspace's own budget, not a provider's key, holds it (`run.wait.provider`). */
export const WORKSPACE_BUDGET_WAIT = 'workspace-budget';

/** The category every model call is counted under. */
export const MODEL_CATEGORY = 'model';

export const RECURRENCES = ['once', 'monthly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** `estimated`: tokens times a list price, or a figure the provider did not bill; `reconciled`: what the provider said it charged. They are summed apart. */
export type LedgerKind = 'estimated' | 'reconciled';

/** What allowed a spend: the person's "yes", an autonomy grant (`grant:<id>`), or the app's own estimate of model use it did not ask anyone about. */
export type AllowedBy = 'person' | 'estimate' | `grant:${string}`;

/** One line of the ledger. Never a credential: a vendor account is named by a secret reference elsewhere, and the reason is plain words. */
export interface LedgerEntry {
  id: string;
  /** ISO time of the spend. */
  at: string;
  category: string;
  vendor: string;
  amount: number;
  currency: string;
  recurrence: Recurrence;
  /** The next charge of a recurring spend, ISO. Absent for a one-off. */
  nextChargeAt?: string;
  reason: string;
  allowedBy: AllowedBy;
  /** The audit line of this spend: the `origin.key` it carries in `auditoria.jsonl`, or the audit id of the "yes" that allowed it. */
  auditRef?: string;
  kind: LedgerKind;
  /** On a reconciled line: the id of the estimated line it replaces, so the two are never summed together. */
  reconciles?: string;
}

/** A spend the instance asks to make. `amount` zero asks only whether there is anything left (the start of a model stage). */
export interface SpendRequest {
  category: string;
  amount: number;
}

export type SpendVerdict = { ok: true } | { ok: false; scope: 'category' | 'month'; category: string; limit: number; spent: number; left: number };

export interface Amounts {
  total: number;
  estimated: number;
  reconciled: number;
}

export interface CategoryView extends Amounts {
  category: string;
  limit: number | null;
  /** What is left of the limit this month; null with no limit. Never below zero. */
  left: number | null;
}

export interface RecurringView {
  vendor: string;
  category: string;
  amount: number;
  currency: string;
  recurrence: Exclude<Recurrence, 'once'>;
  nextChargeAt: string;
  reason: string;
  /** The app can only propose cancelling it: the provisioning work does the cancelling, and only after a "yes". */
  proposeCancel: true;
}

export interface BudgetView {
  currency: string;
  /** `YYYY-MM`, UTC. */
  month: string;
  monthly: number | null;
  spent: Amounts;
  left: number | null;
  categories: CategoryView[];
  recurring: RecurringView[];
  /** The runner and the purchases are held: the month or the model category is at its limit. Ceremonies, the web and admin are not. */
  paused: boolean;
  /** Why, as `scope:category`; the words are the translator's in the main process. */
  pausedBy: { scope: 'category' | 'month'; category: string } | null;
}

const CENT = 100;
const round = (n: number): number => Math.round(n * CENT * 100) / (CENT * 100);

export const monthOf = (at: number | string | Date): string => new Date(at).toISOString().slice(0, 7);

const addPeriod = (from: Date, r: Exclude<Recurrence, 'once'>): Date => {
  const d = new Date(from.getTime());
  if (r === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
};

/** The lines counted: the ones of the month, without an estimate a reconciled line already replaced. */
export function countedIn(entries: readonly LedgerEntry[], month: string): LedgerEntry[] {
  const replaced = new Set(entries.flatMap((e) => (e.reconciles ? [e.reconciles] : [])));
  return entries.filter((e) => monthOf(e.at) === month && !replaced.has(e.id));
}

function sum(entries: readonly LedgerEntry[]): Amounts {
  const estimated = round(entries.filter((e) => e.kind === 'estimated').reduce((n, e) => n + e.amount, 0));
  const reconciled = round(entries.filter((e) => e.kind === 'reconciled').reduce((n, e) => n + e.amount, 0));
  return { total: round(estimated + reconciled), estimated, reconciled };
}

/** The limit of a category, null when it has none (a missing budget has none at all). */
export const limitOf = (b: BudgetConfig | undefined, category: string): number | null => {
  const v = b?.categories?.[category];
  return typeof v === 'number' ? v : null;
};

/** Judges a spend against the month and the category: refused when nothing is left, or when the amount is more than what is left. */
export function judge(entries: readonly LedgerEntry[], budget: BudgetConfig | undefined, req: SpendRequest, now: number | Date = Date.now()): SpendVerdict {
  const month = monthOf(now);
  const counted = countedIn(entries, month);
  const catLimit = limitOf(budget, req.category);
  if (catLimit !== null) {
    const spent = sum(counted.filter((e) => e.category === req.category)).total;
    const left = Math.max(0, round(catLimit - spent));
    if (left <= 0 || req.amount > left) return { ok: false, scope: 'category', category: req.category, limit: catLimit, spent, left };
  }
  const monthly = budget?.monthly ?? null;
  if (monthly !== null) {
    const spent = sum(counted).total;
    const left = Math.max(0, round(monthly - spent));
    if (left <= 0 || req.amount > left) return { ok: false, scope: 'month', category: req.category, limit: monthly, spent, left };
  }
  return { ok: true };
}

/** What the ledger and the limits say about this month, for the view and the channel. */
export function summarize(entries: readonly LedgerEntry[], budget: BudgetConfig | undefined, now: number | Date = Date.now()): BudgetView {
  const month = monthOf(now);
  const counted = countedIn(entries, month);
  const names = [...new Set([...BUDGET_CATEGORIES, ...Object.keys(budget?.categories ?? {}), ...counted.map((e) => e.category)])];
  const categories: CategoryView[] = names.map((category) => {
    const amounts = sum(counted.filter((e) => e.category === category));
    const limit = limitOf(budget, category);
    return { category, limit, left: limit === null ? null : Math.max(0, round(limit - amounts.total)), ...amounts };
  });
  const spent = sum(counted);
  const monthly = budget?.monthly ?? null;
  // The runner is the model's spender and the purchases need room in every limit; the runner is held when the model category or the month has none left.
  const held = judge(entries, budget, { category: MODEL_CATEGORY, amount: 0 }, now);
  const latest = new Map<string, LedgerEntry>();
  for (const e of entries) if (e.recurrence !== 'once') latest.set(`${e.category}|${e.vendor}|${e.reason}`, e);
  const recurring: RecurringView[] = [...latest.values()].map((e) => ({
    vendor: e.vendor,
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    recurrence: e.recurrence as Exclude<Recurrence, 'once'>,
    nextChargeAt: e.nextChargeAt ?? addPeriod(new Date(e.at), e.recurrence as Exclude<Recurrence, 'once'>).toISOString(),
    reason: e.reason,
    proposeCancel: true,
  }));
  return {
    currency: budget?.currency ?? 'USD',
    month,
    monthly,
    spent,
    left: monthly === null ? null : Math.max(0, round(monthly - spent.total)),
    categories,
    recurring: recurring.sort((a, b) => a.nextChargeAt.localeCompare(b.nextChargeAt)),
    paused: !held.ok,
    pausedBy: held.ok ? null : { scope: held.scope, category: held.category },
  };
}

/** What a model call costs from its tokens and a list price, in US dollars per million tokens; cached input is charged at the cache price when there is one. */
export function estimateFromTokens(t: { promptTokens: number; cachedTokens: number; completionTokens: number }, price: { input: number; output: number; cacheRead: number | null }): number {
  const cached = Math.min(Math.max(0, t.cachedTokens), Math.max(0, t.promptTokens));
  const fresh = Math.max(0, t.promptTokens) - cached;
  return ((fresh * price.input + cached * (price.cacheRead ?? price.input) + Math.max(0, t.completionTokens) * price.output) / 1_000_000);
}
