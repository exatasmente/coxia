import { useEffect, useState } from 'react';
import type { BudgetView } from '../../../shared/budget';
import { BUDGET_CATEGORIES } from '../../../shared/budget';
import { api, errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';

// Settings › the operating budget: a monthly total and a limit per category, with what was spent and what is left this month. Empty means no limit. Setting a limit is the
// computer's alone (webPolicy.ts), so a paired browser never shows the section.

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
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (v: BudgetView): void => {
    setView(v);
    setMonthly(toText(v.monthly));
    setCats(Object.fromEntries(v.categories.map((c) => [c.category, toText(c.limit)])));
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
      load(await api.invoke<BudgetView>('budget:set', { monthly: toLimit(monthly), categories }));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (c: string): string => (c in CATEGORY_LABEL ? t(CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]) : c);

  return (
    <section className="panel" aria-labelledby="budget-title">
      <div>
        <h3 id="budget-title" className="wz-sub">{t('ui.settings.budget.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.budget.hint')}</p>
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
