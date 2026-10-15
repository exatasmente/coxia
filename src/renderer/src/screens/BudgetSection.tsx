import { useEffect, useState } from 'react';
import type { BudgetView } from '../../../shared/budget';
import { BUDGET_CATEGORIES } from '../../../shared/budget';
import { api, errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';

// Settings › the operating budget: its currency, a monthly total and a limit per category, with what was spent and what is left this month. Empty means no limit. A price in
// another currency is converted at the rate set here, and one with no rate is refused. Setting any of it is the computer's alone (webPolicy.ts), so a paired browser never shows the section.

// Literal keys, so the catalog check sees each one used.
const CATEGORY_LABEL: Record<(typeof BUDGET_CATEGORIES)[number], string> = { model: 'ui.settings.budget.category.model', infrastructure: 'ui.settings.budget.category.infrastructure', domains: 'ui.settings.budget.category.domains' };
const EVERY_LABEL = { monthly: 'ui.settings.budget.every.monthly', yearly: 'ui.settings.budget.every.yearly' } as const;

const toText = (n: number | null | undefined): string => (typeof n === 'number' ? String(n) : '');
const toLimit = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const money = (n: number, currency: string): string => `${n.toFixed(2)} ${currency}`;

export function BudgetSection() {
  const t = useT();
  const web = isWeb();
  const [view, setView] = useState<BudgetView | null>(null);
  const [monthly, setMonthly] = useState('');
  const [cats, setCats] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('');
  const [rates, setRates] = useState<{ code: string; rate: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (v: BudgetView): void => {
    setView(v);
    setMonthly(toText(v.monthly));
    setCats(Object.fromEntries(v.categories.map((c) => [c.category, toText(c.limit)])));
    setCurrency(v.currency);
    setRates(Object.entries(v.rates).map(([code, rate]) => ({ code, rate: String(rate) })));
  };

  useEffect(() => {
    if (web) return;
    api.invoke<BudgetView>('budget:get').then(load, (e) => setError(errorText(e)));
  }, [web]);

  if (web) return null;
  if (!view) return error ? <div className="error" role="alert">{error}</div> : null;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const categories: Record<string, number> = {};
      for (const [k, v] of Object.entries(cats)) {
        const n = toLimit(v);
        if (n !== null) categories[k] = n;
      }
      const byCode: Record<string, number> = {};
      for (const r of rates) if (r.code.trim() !== '' && r.rate.trim() !== '') byCode[r.code.trim().toUpperCase()] = Number(r.rate);
      load(await api.invoke<BudgetView>('budget:set', { currency: currency.trim().toUpperCase(), rates: byCode, monthly: toLimit(monthly), categories }));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const touch = (): void => setSaved(false);
  const setRate = (i: number, patch: Partial<{ code: string; rate: string }>): void => {
    touch();
    setRates(rates.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const own = currency.trim().toUpperCase() || view.currency;

  const labelOf = (c: string): string => (c in CATEGORY_LABEL ? t(CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]) : c);

  return (
    <section className="panel" aria-labelledby="budget-title">
      <div>
        <h3 id="budget-title" className="wz-sub">{t('ui.settings.budget.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.budget.hint')}</p>
      </div>
      <div className="settings-row">
        <label htmlFor="budget-currency" style={{ fontWeight: 600 }}>{t('ui.settings.budget.currency')}</label>
        <div className="row" style={{ gap: 8 }}>
          <input id="budget-currency" className="text-input" style={{ maxWidth: 80 }} maxLength={3} autoComplete="off" spellCheck={false} value={currency} onChange={(e) => { touch(); setCurrency(e.target.value.toUpperCase()); }} />
          <span className="small muted">{t('ui.settings.budget.currencyHint')}</span>
        </div>
      </div>
      <div className="settings-row">
        <span style={{ fontWeight: 600 }}>{t('ui.settings.budget.rates')}</span>
        <div>
          <p className="small muted" style={{ margin: '0 0 6px' }}>{t('ui.settings.budget.ratesHint', { currency: own })}</p>
          {rates.map((r, i) => (
            <div className="row" style={{ gap: 8, marginBottom: 6 }} key={i}>
              <span className="small muted">1</span>
              <input aria-label={t('ui.settings.budget.rateCode')} className="text-input" style={{ maxWidth: 70 }} maxLength={3} autoComplete="off" spellCheck={false} value={r.code} onChange={(e) => setRate(i, { code: e.target.value.toUpperCase() })} />
              <span className="small muted">=</span>
              <input aria-label={t('ui.settings.budget.rateValue', { code: r.code || '?', currency: own })} type="number" min={0} step="any" className="text-input" style={{ maxWidth: 110 }} value={r.rate} onChange={(e) => setRate(i, { rate: e.target.value })} />
              <span className="small muted">{own}</span>
              <button type="button" className="btn" onClick={() => { touch(); setRates(rates.filter((_, j) => j !== i)); }}>{t('ui.settings.budget.rateRemove')}</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => { touch(); setRates([...rates, { code: '', rate: '' }]); }}>{t('ui.settings.budget.rateAdd')}</button>
        </div>
      </div>
      {view.paused && <div className="error" role="status">{t(view.pausedBy?.scope === 'month' ? 'ui.settings.budget.pausedMonth' : 'ui.settings.budget.pausedCategory', { category: view.pausedBy?.category ?? '' })}</div>}
      <div className="settings-row">
        <label htmlFor="budget-monthly" style={{ fontWeight: 600 }}>{t('ui.settings.budget.monthly')}</label>
        <div className="row" style={{ gap: 8 }}>
          <input id="budget-monthly" type="number" min={0} step="0.01" className="text-input" style={{ maxWidth: 120 }} placeholder={t('ui.settings.budget.noLimit')} value={monthly} onChange={(e) => { setSaved(false); setMonthly(e.target.value); }} />
          <span className="small muted">{t('ui.settings.budget.spentLeft', { spent: money(view.spent.total, view.currency), left: view.left === null ? t('ui.settings.budget.noLimit') : money(view.left, view.currency) })}</span>
        </div>
      </div>
      {view.categories.map((c) => (
        <div className="settings-row" key={c.category}>
          <label htmlFor={`budget-${c.category}`} style={{ fontWeight: 600 }}>{labelOf(c.category)}</label>
          <div className="row" style={{ gap: 8 }}>
            <input id={`budget-${c.category}`} type="number" min={0} step="0.01" className="text-input" style={{ maxWidth: 120 }} placeholder={t('ui.settings.budget.noLimit')} value={cats[c.category] ?? ''} onChange={(e) => { setSaved(false); setCats({ ...cats, [c.category]: e.target.value }); }} />
            <span className="small muted">{t('ui.settings.budget.spentLeft', { spent: money(c.total, view.currency), left: c.left === null ? t('ui.settings.budget.noLimit') : money(c.left, view.currency) })}</span>
            {c.category === 'model' && <span className="small muted">{t('ui.settings.budget.modelSplit', { estimated: money(c.estimated, view.currency), reconciled: money(c.reconciled, view.currency) })}</span>}
          </div>
        </div>
      ))}
      {view.recurring.length > 0 && (
        <div>
          <div style={{ fontWeight: 600 }}>{t('ui.settings.budget.recurring')}</div>
          <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {view.recurring.map((r) => <li key={`${r.category}|${r.vendor}|${r.reason}`}>{t('ui.settings.budget.recurringItem', { vendor: r.vendor, amount: money(r.amount, r.currency), every: t(EVERY_LABEL[r.recurrence]), next: r.nextChargeAt.slice(0, 10) })}</li>)}
          </ul>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{t('ui.settings.budget.save')}</button>
        {saved && <span className="small muted" role="status">{t('ui.settings.budget.saved')}</span>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
