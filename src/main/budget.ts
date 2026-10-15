import type { BudgetConfig } from '../shared/config/types';
import { CURRENCY, MODEL_CATEGORY, MODEL_CURRENCY, RATE_LIMITS, type BudgetView, type LedgerEntry, type SpendRequest, convert, countedIn, estimateFromTokens, judge, monthOf, summarize } from '../shared/budget';
import type { StageUsage } from '../shared/runs';
import { t } from '../shared/i18n';
import { recordWrite } from './auditoria';
import { BudgetError, type SpendRecord, appendEntry, entryOf, pageOf, readLedger } from './budget-core';
import { configAuditEntry } from './configAudit';
import { atasDir } from './env';
import type { Module } from './module';
import { viaOf } from './rpc';
import { getConfig, updateConfig } from './workspaceConfig';

export { BudgetError };

// The operating budget (#198) of the running workspace: the check every spend goes through, the ledger it lands in, and the channels that show and set the limits. It is an operating limit
// the app keeps; the card limit, a provider's own cap and backups are the person's, outside the app. A workspace with no limit (the default, and every one that existed before) is never refused.

const budgetOf = (): BudgetConfig | undefined => getConfig().budget;
const fmt = (n: number): string => n.toFixed(2);
export const ledger = (): LedgerEntry[] => readLedger(atasDir());

/** The words of a refusal: the category or the month, its limit and what is left. */
export function refusalText(v: Extract<ReturnType<typeof judge>, { ok: false }>, currency: string): string {
  const params = { category: v.category, limit: fmt(v.limit), left: fmt(v.left), spent: fmt(v.spent), currency };
  return t(v.scope === 'month' ? 'main.budget.refused.month' : 'main.budget.refused.category', params);
}

export type SpendCheck = { ok: true } | { ok: false; error: BudgetError };

/** Whether a spend fits: the category's limit and the month's. A refusal carries the coded error and its reason in words. `audit` writes the refusal to the audit log (a purchase's, not the runner's repeated look). */
export function checkSpend(req: SpendRequest, opts: { audit?: boolean; now?: number } = {}): SpendCheck {
  const budget = budgetOf();
  const v = judge(ledger(), budget, req, opts.now ?? Date.now());
  if (v.ok) return { ok: true };
  const error = new BudgetError(refusalText(v, budget?.currency ?? 'USD'), { scope: v.scope, category: v.category, limit: v.limit, spent: v.spent, left: v.left });
  if (opts.audit) {
    recordWrite({ kind: 'spend', issue: 0, target: `spend:${req.category}`, via: 'budget', fields: { category: req.category, amount: String(req.amount), scope: v.scope, limit: String(v.limit) }, ok: false, code: null, result: 'budget-exceeded', origin: { actionId: '', kind: 'spend', key: '', summary: null }, by: null });
  }
  return { ok: false, error };
}

/** `checkSpend` that throws the coded error: for the caller that has nothing to do with a refusal but stop. */
export function assertSpend(req: SpendRequest, opts: { audit?: boolean; now?: number } = {}): void {
  const c = checkSpend(req, opts);
  if (!c.ok) throw c.error;
}

/** The words for a price in a currency the budget has no rate for. */
export const noRateText = (currency: string): string => t('main.budget.noRate', { currency, budget: budgetOf()?.currency ?? 'USD' });

/** An amount of `currency` in the budget's currency, at the rate the person set; null when there is no rate for it (the spend is refused, never taken at 1:1). */
export const inBudgetCurrency = (amount: number, currency: string): number | null => convert(amount, currency, budgetOf())?.amount ?? null;

/**
 * Adds a spend to the ledger and writes its audit line. A spend priced in another currency than the budget's is converted at the person's rate, and the line keeps the price as
 * charged beside it; one with no rate is refused. Returns the line kept.
 */
export function recordSpend(r: SpendRecord): LedgerEntry {
  const budget = budgetOf();
  const own = budget?.currency ?? 'USD';
  const converted = convert(r.amount, r.currency, budget);
  if (!converted) throw new Error(noRateText(r.currency));
  const entry = entryOf(r.currency === own ? r : { ...r, amount: converted.amount, currency: own, original: { amount: r.amount, currency: r.currency, rate: converted.rate } });
  // The ledger line is its own audit reference unless the caller names the audit line of the "yes" that allowed it.
  if (!entry.auditRef) entry.auditRef = entry.id;
  appendEntry(atasDir(), entry);
  recordWrite({
    kind: 'spend',
    issue: 0,
    target: `spend:${entry.category}`,
    via: 'budget',
    fields: {
      category: entry.category,
      vendor: entry.vendor,
      amount: String(entry.amount),
      currency: entry.currency,
      recurrence: entry.recurrence,
      kind: entry.kind,
      allowedBy: entry.allowedBy,
      ...(entry.original ? { originalAmount: String(entry.original.amount), originalCurrency: entry.original.currency, rate: String(entry.original.rate) } : {}),
    },
    ok: true,
    code: null,
    result: '',
    origin: { actionId: '', kind: 'spend', key: entry.id, summary: null },
    by: entry.allowedBy.startsWith('grant:') ? entry.allowedBy.slice('grant:'.length) : null,
  });
  return entry;
}

export const budgetView = (now = Date.now()): BudgetView => summarize(ledger(), budgetOf(), now);

/** The words that say why the runner and the schedules are held, or null when they are not. The model category and the month are what they spend. */
export function modelRefusal(now = Date.now()): string | null {
  const c = checkSpend({ category: MODEL_CATEGORY, amount: 0 }, { now });
  return c.ok ? null : c.error.message;
}

export const modelHeld = (): boolean => modelRefusal() !== null;

/** What a stage's model calls cost, entered in the ledger. The provider's own figure is `reconciled` (what it said it charged on the call), the SDK's list price or a tokens-times-price figure is `estimated`. */
export function recordModelUsage(used: StageUsage, about: { run: string; stage: string }, price?: { input: number; output: number; cacheRead: number | null } | null): LedgerEntry | null {
  let amount = used.costUsd;
  let estimated = used.costEstimated === true;
  if (amount === null && price) {
    amount = estimateFromTokens(used, price);
    estimated = true;
  }
  if (amount === null || !(amount > 0)) return null;
  return recordSpend({ category: MODEL_CATEGORY, vendor: 'model provider', amount, currency: MODEL_CURRENCY, reason: `stage ${about.stage} of run ${about.run}`, allowedBy: 'person', kind: estimated ? 'estimated' : 'reconciled' });
}

/**
 * The budget as a person may set it: the currency (the one stored when none is sent), the rates of the others, and the limits as numbers of zero or more or null for none. Throws a
 * worded error for anything else, for a budget the model's cost could not be counted in (not in USD and no rate for it), and for a change of currency while this month already has
 * lines in the old one (they would be summed as if they were in the new one).
 */
function cleanLimits(input: unknown, now = Date.now()): BudgetConfig {
  const o = (input ?? {}) as Partial<BudgetConfig>;
  const stored = getConfig().budget;
  const before = stored?.currency ?? 'USD';
  const cur = o.currency === undefined ? before : typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : '';
  if (!CURRENCY.test(cur)) throw new Error(t('main.budget.invalidCurrency', { currency: String(o.currency) }));
  if (cur !== before) {
    const month = monthOf(now);
    if (countedIn(ledger(), month).some((e) => e.currency !== cur)) throw new Error(t('main.budget.currencyInUse', { currency: before, month }));
  }
  const rates: Record<string, number> = {};
  const sentRates = o.rates === undefined ? (cur === before ? (stored?.rates ?? {}) : {}) : o.rates;
  if (sentRates === null || typeof sentRates !== 'object' || Array.isArray(sentRates)) throw new Error(t('main.budget.invalidRate', { currency: '' }));
  for (const [k, v] of Object.entries(sentRates)) {
    if (v === null || v === undefined) continue;
    const code = k.trim().toUpperCase();
    if (!CURRENCY.test(code) || code === cur) throw new Error(t('main.budget.invalidCurrency', { currency: k }));
    if (typeof v !== 'number' || !Number.isFinite(v) || v < RATE_LIMITS.min || v > RATE_LIMITS.max) throw new Error(t('main.budget.invalidRate', { currency: code }));
    rates[code] = v;
  }
  // Every stage's model calls are priced in USD: a budget in another currency that cannot convert them would refuse each one at the ledger.
  if (cur !== MODEL_CURRENCY && rates[MODEL_CURRENCY] === undefined) throw new Error(t('main.budget.modelRate', { currency: MODEL_CURRENCY, budget: cur }));
  const num = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new Error(t('main.budget.invalid', { field: name }));
    return Math.round(v * 100) / 100;
  };
  const monthly = o.monthly === null || o.monthly === undefined ? null : num(o.monthly, 'monthly');
  const categories: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.categories ?? {})) {
    if (v === null || v === undefined) continue;
    categories[k] = num(v, k);
  }
  return { currency: cur, monthly, categories, ...(Object.keys(rates).length > 0 ? { rates } : {}) };
}

export const budgetModule: Module = (ctx) => {
  ctx.handle('budget:get', () => budgetView());
  ctx.handle('budget:ledger', (offset?: number, limit?: number) => pageOf(ledger(), Number(offset ?? 0), Number(limit ?? 50)));
  // Raising a limit lets the app spend more: webPolicy.ts refuses a paired browser without a passkey and asks a passkey device for one (STEP_UP, kind budget),
  // and the persona never changes it.
  ctx.handle('budget:set', (next: unknown) => {
    if (viaOf() === 'persona') throw new Error(t('main.budget.personaRefused'));
    const budget = cleanLimits(next);
    const before = getConfig();
    updateConfig((c) => ({ ...c, budget }));
    try {
      const line = configAuditEntry(before, getConfig(), { op: 'save', via: viaOf() });
      if (line) recordWrite(line);
    } catch (e) {
      console.error('[budget] audit', e instanceof Error ? e.message : e);
    }
    const view = budgetView();
    ctx.emit({ type: 'module', name: 'budget:changed', payload: view });
    return view;
  });
};
