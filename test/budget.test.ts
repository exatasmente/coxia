// The operating budget (#198): the arithmetic (month, category, estimated and reconciled apart), the ledger on disk, the check every spend goes through with its coded refusal,
// the channels and who may call them, and what is held when the limit is reached (the model category, not the ceremonies).
import { mkdtempSync, readFileSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LedgerEntry, convert, estimateFromTokens, judge, monthOf, summarize } from '../src/shared/budget';
import { neutralConfig } from '../src/shared/config/defaults';
import { CHANNELS, ERROR_CODES, errorCodeOf, wireErrorOf } from '../src/shared/contract';
import { STEP_UP, webAccess } from '../src/main/webPolicy';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
const { bootEnv, atasDir } = await import('../src/main/env');
bootEnv();
const { BudgetError, entryOf, pageOf, readLedger, appendEntry } = await import('../src/main/budget-core');
const { assertSpend, budgetModule, budgetView, checkSpend, modelHeld, modelRefusal, recordModelUsage, recordSpend } = await import('../src/main/budget');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');
const { listAudit } = await import('../src/main/auditoria');
const { createScheduleService } = await import('../src/main/schedules/service');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const line = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ id: `l-${Math.random()}`, at: '2026-10-05T10:00:00Z', category: 'model', vendor: 'v', amount: 1, currency: 'USD', recurrence: 'once', reason: 'r', allowedBy: 'person', kind: 'estimated', ...over });
const budget = (monthly: number | null, categories: Record<string, number> = {}) => ({ currency: 'USD', monthly, categories });

describe('the arithmetic', () => {
  it('refuses a spend over a category limit, naming the category', () => {
    const v = judge([line({ category: 'domains', amount: 8 })], budget(null, { domains: 10 }), { category: 'domains', amount: 3 }, NOW);
    expect(v).toMatchObject({ ok: false, scope: 'category', category: 'domains', limit: 10, spent: 8, left: 2 });
  });

  it('refuses a spend over the month even when its category has room', () => {
    const v = judge([line({ category: 'model', amount: 45 })], budget(50, { infrastructure: 100 }), { category: 'infrastructure', amount: 6 }, NOW);
    expect(v).toMatchObject({ ok: false, scope: 'month', limit: 50, spent: 45, left: 5 });
  });

  it('allows a spend that fits, and one that is exactly what is left', () => {
    expect(judge([line({ amount: 4 })], budget(10, { model: 10 }), { category: 'model', amount: 6 }, NOW)).toEqual({ ok: true });
  });

  it('holds at the limit: nothing is left, so even a zero ask is refused', () => {
    expect(judge([line({ amount: 5 })], budget(null, { model: 5 }), { category: 'model', amount: 0 }, NOW).ok).toBe(false);
    expect(judge([line({ amount: 4.99 })], budget(null, { model: 5 }), { category: 'model', amount: 0 }, NOW).ok).toBe(true);
  });

  it('has no limit when none is set, whatever was spent', () => {
    expect(judge([line({ amount: 1e6 })], budget(null), { category: 'model', amount: 1e6 }, NOW)).toEqual({ ok: true });
    expect(judge([line({ amount: 1e6 })], undefined, { category: 'model', amount: 1 }, NOW)).toEqual({ ok: true });
  });

  it('counts only the month: a spend of last month is not this month\'s, so the month rolling over resumes', () => {
    const old = line({ at: '2026-09-30T23:00:00Z', amount: 50 });
    expect(judge([old], budget(50), { category: 'model', amount: 1 }, Date.parse('2026-09-30T23:30:00Z')).ok).toBe(false);
    expect(judge([old], budget(50), { category: 'model', amount: 1 }, Date.parse('2026-10-01T00:30:00Z')).ok).toBe(true);
  });

  it('shows estimated and reconciled apart, and never sums an estimate its reconciled line replaced', () => {
    const est = line({ id: 'e1', amount: 3, kind: 'estimated' });
    const rec = line({ id: 'r1', amount: 2.5, kind: 'reconciled', reconciles: 'e1' });
    const other = line({ id: 'e2', amount: 1, kind: 'estimated' });
    const v = summarize([est, rec, other], budget(10), NOW);
    expect(v.spent).toEqual({ total: 3.5, estimated: 1, reconciled: 2.5 });
    expect(v.left).toBe(6.5);
    expect(v.categories.find((c) => c.category === 'model')).toMatchObject({ estimated: 1, reconciled: 2.5, total: 3.5 });
  });

  it('lists recurring costs with the next charge, computed from the last charge when none is given, and offers to propose cancelling', () => {
    const v = summarize([line({ category: 'infrastructure', vendor: 'host', amount: 5, recurrence: 'monthly', at: '2026-10-02T00:00:00Z' }), line({ category: 'domains', vendor: 'registrar', amount: 12, recurrence: 'yearly', at: '2026-03-10T00:00:00Z', nextChargeAt: '2027-03-10T00:00:00Z' }), line({ recurrence: 'once' })], budget(null), NOW);
    expect(v.recurring.map((r) => [r.vendor, r.nextChargeAt.slice(0, 10), r.proposeCancel])).toEqual([['host', '2026-11-02', true], ['registrar', '2027-03-10', true]]);
  });

  it('is paused when the model category or the month is spent, and not otherwise', () => {
    expect(summarize([line({ amount: 5 })], budget(null, { model: 5 }), NOW)).toMatchObject({ paused: true, pausedBy: { scope: 'category', category: 'model' } });
    expect(summarize([line({ amount: 5, category: 'domains' })], budget(5), NOW)).toMatchObject({ paused: true, pausedBy: { scope: 'month' } });
    expect(summarize([line({ amount: 5, category: 'domains' })], budget(null, { domains: 5 }), NOW).paused).toBe(false);
    expect(monthOf(NOW)).toBe('2026-10');
  });

  it('estimates model cost from tokens times a list price, charging cached input at the cache price', () => {
    expect(estimateFromTokens({ promptTokens: 1_000_000, cachedTokens: 400_000, completionTokens: 100_000 }, { input: 3, output: 15, cacheRead: 0.3 })).toBeCloseTo(0.6 * 3 + 0.4 * 0.3 + 0.1 * 15, 6);
    expect(estimateFromTokens({ promptTokens: 1000, cachedTokens: 5000, completionTokens: 0 }, { input: 2, output: 8, cacheRead: null })).toBeCloseTo(0.002, 9);
  });
});

describe('the ledger on disk', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'coxia-budget-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const record = { category: 'infrastructure', vendor: 'host', amount: 5, currency: 'USD', reason: 'a small server', allowedBy: 'person' as const, kind: 'reconciled' as const };

  it('keeps what allowed a spend and its kind, appends, and reads back', () => {
    appendEntry(dir, entryOf({ ...record, recurrence: 'monthly', nextChargeAt: '2026-11-01T00:00:00Z' }));
    appendEntry(dir, entryOf({ ...record, allowedBy: 'grant:purchases', kind: 'estimated' }));
    const rows = readLedger(dir);
    expect(rows.map((r) => [r.allowedBy, r.kind, r.recurrence])).toEqual([['person', 'reconciled', 'monthly'], ['grant:purchases', 'estimated', 'once']]);
    expect(rows[0].nextChargeAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('skips a damaged line and keeps the rest', () => {
    appendEntry(dir, entryOf(record));
    appendFileSync(join(dir, 'budget', 'ledger.jsonl'), '{not json\n');
    appendEntry(dir, entryOf(record));
    expect(readLedger(dir)).toHaveLength(2);
  });

  it('refuses a line it must not keep: a bad amount, category, currency or origin', () => {
    expect(() => entryOf({ ...record, amount: -1 })).toThrow();
    expect(() => entryOf({ ...record, amount: Number.NaN })).toThrow();
    expect(() => entryOf({ ...record, category: 'Bad Name' })).toThrow();
    expect(() => entryOf({ ...record, currency: 'dollars' })).toThrow();
    expect(() => entryOf({ ...record, allowedBy: 'anyone' as never })).toThrow();
  });

  it('never keeps a secret value: a key in the vendor or the reason is masked before it is written', () => {
    const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    appendEntry(dir, entryOf({ ...record, vendor: `host ${secret}`, reason: `paid with token=hunter2hunter2 and ${secret}` }));
    const raw = readFileSync(join(dir, 'budget', 'ledger.jsonl'), 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('hunter2hunter2');
  });

  it('pages newest first', () => {
    for (let i = 0; i < 5; i++) appendEntry(dir, entryOf({ ...record, at: `2026-10-0${i + 1}T00:00:00Z` }));
    const p = pageOf(readLedger(dir), 0, 2);
    expect(p.entries.map((e) => e.at.slice(8, 10))).toEqual(['05', '04']);
    expect(p).toMatchObject({ total: 5, nextOffset: 2 });
    expect(pageOf(readLedger(dir), 4, 2)).toMatchObject({ nextOffset: null });
  });
});

describe('the check and the record of the running workspace', () => {
  const set = (b: ReturnType<typeof budget>) => updateConfig((c) => ({ ...c, budget: b }));
  const ledgerFile = () => join(atasDir(), 'budget', 'ledger.jsonl');
  beforeEach(() => {
    rmSync(ledgerFile(), { force: true });
    set(budget(null));
  });

  it('a new workspace has no limit and refuses nothing', () => {
    expect(neutralConfig().budget).toEqual({ currency: 'USD', monthly: null, categories: {} });
    expect(checkSpend({ category: 'infrastructure', amount: 1e6 })).toEqual({ ok: true });
    expect(modelHeld()).toBe(false);
  });

  it('refuses a spend over a category with the code budget-exceeded and the reason in words', () => {
    set(budget(null, { domains: 10 }));
    recordSpend({ category: 'domains', vendor: 'registrar', amount: 8, currency: 'USD', reason: 'a name', allowedBy: 'person', kind: 'reconciled' });
    const c = checkSpend({ category: 'domains', amount: 3 });
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.error).toBeInstanceOf(BudgetError);
    expect(c.error.code).toBe('budget-exceeded');
    expect(c.error.message).toContain('domains');
    expect(c.error.message).toContain('10.00');
    expect(c.error.message).toContain('2.00');
    expect(() => assertSpend({ category: 'domains', amount: 3 })).toThrow(/domains/);
    // the contract carries it as its own code
    expect(ERROR_CODES).toContain('budget-exceeded');
    expect(errorCodeOf(c.error)).toBe('budget-exceeded');
    expect(wireErrorOf(c.error)).toMatchObject({ code: 'budget-exceeded' });
  });

  it('refuses a spend over the month, saying so', () => {
    set(budget(20, { infrastructure: 100 }));
    recordSpend({ category: 'model', vendor: 'provider', amount: 19, currency: 'USD', reason: 'stages', allowedBy: 'person', kind: 'estimated' });
    const c = checkSpend({ category: 'infrastructure', amount: 5 });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.detail).toMatchObject({ scope: 'month', limit: 20 });
  });

  it('holds the model category at its limit and lets it go when the limit is raised', () => {
    set(budget(null, { model: 5 }));
    recordSpend({ category: 'model', vendor: 'provider', amount: 5, currency: 'USD', reason: 'stages', allowedBy: 'person', kind: 'reconciled' });
    expect(modelHeld()).toBe(true);
    expect(modelRefusal()).toContain('model');
    set(budget(null, { model: 6 }));
    expect(modelHeld()).toBe(false);
  });

  it('records who allowed it and an audit line whose reference is the ledger line, and shows the kinds apart', () => {
    const e = recordSpend({ category: 'infrastructure', vendor: 'host', amount: 5, currency: 'USD', recurrence: 'monthly', reason: 'a small server', allowedBy: 'grant:g-1', kind: 'estimated' });
    expect(e.auditRef).toBe(e.id);
    const audit = listAudit().filter((a) => a.kind === 'spend' && a.origin.key === e.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ ok: true, by: 'g-1', fields: { category: 'infrastructure', allowedBy: 'grant:g-1', kind: 'estimated' } });
    recordSpend({ category: 'model', vendor: 'provider', amount: 2, currency: 'USD', reason: 'stages', allowedBy: 'person', kind: 'reconciled' });
    const view = budgetView();
    expect(view.spent).toMatchObject({ total: 7, estimated: 5, reconciled: 2 });
    expect(view.recurring.map((r) => r.vendor)).toEqual(['host']);
  });

  it('refuses a spend in a currency the ledger is not in', () => {
    expect(() => recordSpend({ category: 'domains', vendor: 'r', amount: 1, currency: 'EUR', reason: 'x', allowedBy: 'person', kind: 'estimated' })).toThrow(/USD/);
  });

  it('records a stage\'s model use: the provider\'s figure reconciled, the SDK\'s list price estimated, tokens times a price when there is none, nothing for a subscription', () => {
    const base = { promptTokens: 1000, completionTokens: 100, cachedTokens: 0, calls: 1 };
    expect(recordModelUsage({ ...base, costUsd: 0.5, costEstimated: false }, { run: 'r-1', stage: 'build' })).toMatchObject({ kind: 'reconciled', amount: 0.5, category: 'model', allowedBy: 'person' });
    expect(recordModelUsage({ ...base, costUsd: 0.25, costEstimated: true }, { run: 'r-1', stage: 'build' })).toMatchObject({ kind: 'estimated', amount: 0.25 });
    expect(recordModelUsage({ ...base, costUsd: null }, { run: 'r-1', stage: 'build' }, { input: 1000, output: 1000, cacheRead: null })).toMatchObject({ kind: 'estimated' });
    expect(recordModelUsage({ ...base, costUsd: null }, { run: 'r-1', stage: 'build' })).toBeNull();
    expect(recordModelUsage({ ...base, costUsd: null, subscriptionCalls: 1 }, { run: 'r-1', stage: 'build' })).toBeNull();
  });

  it('writes an audit line for a refusal only when asked', () => {
    set(budget(null, { domains: 1 }));
    const before = listAudit().filter((a) => a.kind === 'spend' && !a.ok).length;
    checkSpend({ category: 'domains', amount: 5 });
    expect(listAudit().filter((a) => a.kind === 'spend' && !a.ok)).toHaveLength(before);
    checkSpend({ category: 'domains', amount: 5 }, { audit: true });
    expect(listAudit().filter((a) => a.kind === 'spend' && !a.ok)).toHaveLength(before + 1);
  });

  it('keeps no secret value in the ledger file', () => {
    recordSpend({ category: 'infrastructure', vendor: 'host', amount: 5, currency: 'USD', reason: 'key sk-or-v1-0123456789abcdef0123456789abcdef', allowedBy: 'person', kind: 'estimated' });
    expect(readFileSync(ledgerFile(), 'utf8')).not.toContain('sk-or-v1');
  });
});

describe('the channels', () => {
  type Handler = (...args: unknown[]) => unknown;
  const mount = () => {
    const handlers = new Map<string, Handler>();
    const events: unknown[] = [];
    budgetModule({ handle: (c, fn) => void handlers.set(c, fn as Handler), notify: () => undefined, emit: (e) => void events.push(e), job: () => undefined });
    return { call: (c: string, ...a: unknown[]) => handlers.get(c)?.(...a), handlers, events };
  };
  beforeEach(() => {
    rmSync(join(atasDir(), 'budget', 'ledger.jsonl'), { force: true });
    updateConfig((c) => ({ ...c, budget: budget(null) }));
  });

  it('are in the contract, and a paired browser may read but never set', () => {
    for (const c of ['budget:get', 'budget:set', 'budget:ledger']) expect(CHANNELS).toContain(c);
    expect(webAccess('budget:get')).toBe('allow');
    expect(webAccess('budget:ledger')).toBe('allow');
    expect(webAccess('budget:set')).toBe('deny');
    // a channel added under the prefix later starts closed
    expect(webAccess('budget:anything-else')).toBe('deny');
  });

  it('opens setting the budget to a device with a passkey, which is asked for it at that moment', () => {
    expect(webAccess('budget:set', true)).toBe('allow');
    expect(STEP_UP.get('budget:set')).toBe('budget');
  });

  it('set stores the limits, rounds them, audits the change, and get answers what was spent', () => {
    const m = mount();
    expect([...m.handlers.keys()].sort()).toEqual(['budget:get', 'budget:ledger', 'budget:set']);
    const view = m.call('budget:set', { monthly: 50.005, categories: { model: 20, domains: 5, bogus: null } }) as { monthly: number };
    expect(view.monthly).toBe(50.01);
    expect(getConfig().budget).toEqual({ currency: 'USD', monthly: 50.01, categories: { model: 20, domains: 5 } });
    expect(listAudit().some((a) => a.kind === 'config' && Object.keys(a.fields).includes('budget.monthly'))).toBe(true);
    expect(m.events).toHaveLength(1);
    recordSpend({ category: 'model', vendor: 'p', amount: 4, currency: 'USD', reason: 'x', allowedBy: 'person', kind: 'reconciled' });
    expect(m.call('budget:get')).toMatchObject({ spent: { total: 4 }, left: 46.01 });
    expect(m.call('budget:ledger', 0, 10)).toMatchObject({ total: 1 });
  });

  it('set refuses a negative or non-numeric limit and leaves the stored ones alone', () => {
    const m = mount();
    m.call('budget:set', { monthly: 10, categories: {} });
    expect(() => m.call('budget:set', { monthly: -5, categories: {} })).toThrow(/monthly/);
    expect(() => m.call('budget:set', { monthly: 'lots', categories: {} })).toThrow();
    expect(getConfig().budget?.monthly).toBe(10);
  });
});

describe('the phone\'s one config save', () => {
  it('cannot change the budget', async () => {
    const { refusedPaths } = await import('../src/main/configScope');
    const before = neutralConfig();
    const after = { ...before, budget: { currency: 'USD', monthly: 1e6, categories: {} } };
    expect(refusedPaths(before, after)).toContain('budget.monthly');
    // nor the currency or a rate, which change what a price is worth against the limits
    const priced = { ...before, budget: { currency: 'BRL', monthly: null, categories: {}, rates: { USD: 0.01 } } };
    expect(refusedPaths(before, priced)).toEqual(expect.arrayContaining(['budget.currency', 'budget.rates']));
  });
});

describe('what is held at the limit, and what is not', () => {
  it('holds a schedule\'s own initiative while the budget is spent and fires it when there is room; nothing else asks the budget', async () => {
    const fire = vi.fn(async () => 'fired' as const);
    const store = { list: () => [{ id: 's1', nextRun: '2026-10-13T11:00:00Z', active: true }] };
    let held = true;
    const svc = createScheduleService({ store: store as never, firer: { fire, running: () => false } as never, now: () => new Date(NOW), held: () => held });
    await svc.setEnabled(true);
    await svc.tick();
    expect(fire).not.toHaveBeenCalled();
    held = false;
    await svc.tick();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('the ceremonies, the web and the admin do not consult the budget', () => {
    const src = join(import.meta.dirname, '../src/main');
    const users = ['cycle.ts', 'ceremonyCommands.ts', 'falas.ts', 'rpc.ts', 'adminDoor.ts', 'webPolicy.ts'].filter((f) => existsSync(join(src, f)) && /from '\.\/budget'/.test(readFileSync(join(src, f), 'utf8')));
    expect(users).toEqual([]);
  });
});


describe('a budget in another currency', () => {
  type Handler = (...args: unknown[]) => unknown;
  const mount = () => {
    const handlers = new Map<string, Handler>();
    budgetModule({ handle: (c, fn) => void handlers.set(c, fn as Handler), notify: () => undefined, emit: () => undefined, job: () => undefined });
    return (c: string, ...a: unknown[]) => handlers.get(c)?.(...a);
  };
  const brl = { currency: 'BRL', monthly: 600, categories: { infrastructure: 200 }, rates: { USD: 5.45 } };
  beforeEach(() => {
    rmSync(join(atasDir(), 'budget', 'ledger.jsonl'), { force: true });
    updateConfig((c) => ({ ...c, budget: budget(null) }));
  });

  it('converts at the rate the person set, takes its own currency at 1, and has no 1:1 fallback', () => {
    expect(convert(10, 'USD', brl)).toEqual({ amount: 54.5, rate: 5.45 });
    expect(convert(70.99, 'BRL', brl)).toEqual({ amount: 70.99, rate: 1 });
    expect(convert(1, 'EUR', brl)).toBeNull();
    expect(convert(1, 'EUR', budget(null))).toBeNull();
    expect(convert(1, 'EUR', { ...brl, rates: { EUR: 0 } })).toBeNull();
  });

  it('records a spend priced in another currency in the budget\'s, keeping the price as charged and the rate, in the ledger and the audit', () => {
    updateConfig((c) => ({ ...c, budget: brl }));
    const e = recordSpend({ category: 'domains', vendor: 'registrar', amount: 10, currency: 'USD', reason: 'a name', allowedBy: 'person', kind: 'reconciled' });
    expect(e).toMatchObject({ amount: 54.5, currency: 'BRL', original: { amount: 10, currency: 'USD', rate: 5.45 } });
    expect(readLedger(atasDir())[0]).toMatchObject({ amount: 54.5, currency: 'BRL', original: { amount: 10, currency: 'USD' } });
    expect(listAudit().find((a) => a.kind === 'spend' && a.origin.key === e.id)?.fields).toMatchObject({ amount: '54.5', currency: 'BRL', originalAmount: '10', originalCurrency: 'USD', rate: '5.45' });
    const own = recordSpend({ category: 'infrastructure', vendor: 'host', amount: 70.99, currency: 'BRL', reason: 'a server', allowedBy: 'person', kind: 'reconciled' });
    expect(own.original).toBeUndefined();
    expect(budgetView().spent.total).toBe(125.49);
    expect(budgetView().rates).toEqual({ USD: 5.45 });
  });

  it('refuses a spend in a currency with no rate, saying which one and how to set it', () => {
    updateConfig((c) => ({ ...c, budget: brl }));
    expect(() => recordSpend({ category: 'domains', vendor: 'r', amount: 1, currency: 'EUR', reason: 'x', allowedBy: 'person', kind: 'estimated' })).toThrow(/EUR/);
    expect(readLedger(atasDir())).toHaveLength(0);
  });

  it('counts the model\'s USD cost against the limits of a BRL budget', () => {
    updateConfig((c) => ({ ...c, budget: { ...brl, categories: { model: 10 } } }));
    const base = { promptTokens: 1000, completionTokens: 100, cachedTokens: 0, calls: 1 };
    expect(recordModelUsage({ ...base, costUsd: 2, costEstimated: false }, { run: 'r-1', stage: 'build' })).toMatchObject({ amount: 10.9, currency: 'BRL', original: { amount: 2, currency: 'USD' } });
    expect(modelHeld()).toBe(true);
  });

  it('judges a converted amount against the limits in the budget\'s currency', () => {
    updateConfig((c) => ({ ...c, budget: brl }));
    recordSpend({ category: 'infrastructure', vendor: 'host', amount: 30, currency: 'USD', reason: 'a server', allowedBy: 'person', kind: 'reconciled' });
    const c = checkSpend({ category: 'infrastructure', amount: 50 });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.detail).toMatchObject({ scope: 'category', limit: 200, spent: 163.5 });
  });

  it('set takes the currency and the rates, upper-cased, and keeps the rates when only the limits are sent', () => {
    const call = mount();
    expect(call('budget:set', { currency: 'brl', rates: { usd: 5.45 }, monthly: 600, categories: {} })).toMatchObject({ currency: 'BRL', rates: { USD: 5.45 } });
    expect(getConfig().budget).toEqual({ currency: 'BRL', monthly: 600, categories: {}, rates: { USD: 5.45 } });
    call('budget:set', { monthly: 700, categories: {} });
    expect(getConfig().budget).toMatchObject({ currency: 'BRL', monthly: 700, rates: { USD: 5.45 } });
    expect(listAudit().some((a) => a.kind === 'config' && Object.keys(a.fields).some((k) => k.startsWith('budget.'))) ).toBe(true);
  });

  it('set refuses a budget the model cost cannot be counted in, a bad code, a bad rate and a rate of the budget\'s own currency', () => {
    const call = mount();
    expect(() => call('budget:set', { currency: 'BRL', monthly: null, categories: {} })).toThrow(/USD/);
    expect(() => call('budget:set', { currency: 'reais', rates: { USD: 5 }, monthly: null, categories: {} })).toThrow();
    expect(() => call('budget:set', { currency: 'BRL', rates: { USD: 0 }, monthly: null, categories: {} })).toThrow(/USD/);
    expect(() => call('budget:set', { currency: 'BRL', rates: { USD: 'five' }, monthly: null, categories: {} })).toThrow();
    expect(() => call('budget:set', { currency: 'BRL', rates: { USD: 5, BRL: 1 }, monthly: null, categories: {} })).toThrow(/BRL/);
    expect(getConfig().budget?.currency).toBe('USD');
  });

  it('set refuses to change the currency while this month has spends in the old one, and lets it change with none', () => {
    const call = mount();
    recordSpend({ category: 'model', vendor: 'p', amount: 1, currency: 'USD', reason: 'x', allowedBy: 'person', kind: 'reconciled' });
    expect(() => call('budget:set', { currency: 'BRL', rates: { USD: 5.45 }, monthly: null, categories: {} })).toThrow(/USD/);
    expect(getConfig().budget?.currency).toBe('USD');
    rmSync(join(atasDir(), 'budget', 'ledger.jsonl'), { force: true });
    expect(call('budget:set', { currency: 'BRL', rates: { USD: 5.45 }, monthly: null, categories: {} })).toMatchObject({ currency: 'BRL' });
  });

  it('keeps a ledger line that names a bad original price out', () => {
    const record = { category: 'infrastructure', vendor: 'host', amount: 5, currency: 'BRL', reason: 'r', allowedBy: 'person' as const, kind: 'reconciled' as const };
    expect(() => entryOf({ ...record, original: { amount: 1, currency: 'BRL', rate: 5 } })).toThrow();
    expect(() => entryOf({ ...record, original: { amount: 1, currency: 'USD', rate: 0 } })).toThrow();
    expect(() => entryOf({ ...record, original: { amount: -1, currency: 'USD', rate: 5 } })).toThrow();
    expect(entryOf({ ...record, original: { amount: 1, currency: 'USD', rate: 5 } }).original).toEqual({ amount: 1, currency: 'USD', rate: 5 });
  });
});
