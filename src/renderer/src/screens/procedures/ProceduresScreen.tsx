import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { PROCEDURE_KINDS, PROCEDURE_STATES } from '../../../../shared/procedures';
import { NO_FILTERS, distinct, filterProcedures, sortProcedures, type ProcedureFilters, type ProcedureListView, type ProcedureStatsView, type ProcedureSummary } from '../../../../shared/proceduresView';
import { intlLocale, useT } from '../../i18n';
import { isWeb } from '../../platform';
import { BackIcon } from '../icons';
import { useRunConfig } from '../cycle/runsApi';
import { agentName } from '../cycle/names';
import { RecordPanel } from './RecordPanel';
import { day } from './RecordBody';
import { KIND_LABEL, STATE_LABEL, STATE_TONE } from './labels';
import { proceduresApi } from './proceduresApi';
import '../cycle/cycle.css';
import './procedures.css';

// The Procedures view: every record the agents of the workspace kept, filtered by kind, key, writer and state, each opening into its steps, who wrote it and what it saved. It
// reads whatever the workspace switch says. Where the person is on the computer it also changes them (RecordPanel); in a paired browser it only reads.

/** The workspace's numbers: how many, how many need the person, and the saving the procedures show, with its label. */
export function Summary({ stats }: { stats: ProcedureStatsView }) {
  const t = useT();
  const n = new Intl.NumberFormat(intlLocale());
  const money = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const s = stats.saved;
  return (
    <section className="panel pr-summary" aria-label={t('ui.procedures.summary.label')}>
      <ul className="pr-counts">
        <li>{t('ui.procedures.summary.total', { count: n.format(stats.total) })}</li>
        <li>{t('ui.procedures.summary.unreviewed', { count: n.format(stats.unreviewed) })}</li>
        <li>{t('ui.procedures.summary.failing', { count: n.format(stats.failing) })}</li>
        <li>{t('ui.procedures.summary.old', { count: n.format(stats.old) })}</li>
      </ul>
      {stats.oldest && <p className="small muted">{t('ui.procedures.summary.oldest', { title: stats.oldest.title, date: day(stats.oldest.at) })}</p>}
      {stats.total > 0 && (
        <p className="small">
          {s.procedures === 0
            ? t('ui.procedures.summary.noSaving')
            : t(s.costUsd === null ? 'ui.procedures.summary.saved' : s.costEstimated ? 'ui.procedures.summary.savedCostEstimated' : 'ui.procedures.summary.savedCost', {
                tokens: n.format(s.tokens),
                procedures: n.format(s.procedures),
                cost: s.costUsd === null ? '' : money.format(s.costUsd),
              })}
        </p>
      )}
    </section>
  );
}

function Filters({ items, filters, set }: { items: readonly ProcedureSummary[]; filters: ProcedureFilters; set: (f: ProcedureFilters) => void }) {
  const t = useT();
  const team = useRunConfig()?.agents.team;
  const keys = useMemo(() => distinct(items, (p) => p.key), [items]);
  const writers = useMemo(() => distinct(items, (p) => p.by), [items]);
  const on = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const select = (label: string, all: string, value: string, options: [string, string][], change: (v: string) => void) => (
    <label className="cy-field pr-filter">
      <span className="small muted">{label}</span>
      <select className="text-input" value={value} onChange={(e) => change(e.target.value)}>
        <option value="">{all}</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
  return (
    <div className="pr-filters" role="group" aria-label={t('ui.procedures.filter.label')}>
      <label className="cy-field pr-search">
        <span className="small muted">{t('ui.procedures.filter.search')}</span>
        <input className="text-input" type="search" value={filters.search} placeholder={t('ui.procedures.filter.searchPlaceholder')} onChange={(e) => set({ ...filters, search: e.target.value })} />
      </label>
      {select(t('ui.procedures.filter.kind'), t('ui.procedures.filter.kindAll'), filters.kind, PROCEDURE_KINDS.map((k) => [k, t(KIND_LABEL[k])]), (v) => set({ ...filters, kind: v as ProcedureFilters['kind'] }))}
      {select(t('ui.procedures.filter.key'), t('ui.procedures.filter.keyAll'), filters.key, keys.map((k) => [k, k]), (v) => set({ ...filters, key: v }))}
      {select(t('ui.procedures.filter.by'), t('ui.procedures.filter.byAll'), filters.by, writers.map((w) => [w, w === 'person' ? t('ui.procedures.person') : agentName(team, w)]), (v) => set({ ...filters, by: v }))}
      {select(t('ui.procedures.filter.state'), t('ui.procedures.filter.stateAll'), filters.state, PROCEDURE_STATES.map((s) => [s, t(STATE_LABEL[s])]), (v) => set({ ...filters, state: v as ProcedureFilters['state'] }))}
      <button type="button" className={`filter ${filters.unreviewed ? 'on' : ''}`} aria-pressed={filters.unreviewed} onClick={() => set({ ...filters, unreviewed: !filters.unreviewed })}>{t('ui.procedures.filter.unreviewed')}</button>
      {on && <button type="button" className="btn cy-mini" onClick={() => set(NO_FILTERS)}>{t('ui.procedures.filter.clear')}</button>}
    </div>
  );
}

/** One line of the list: the title, what it is for, and what the person should know before opening it. */
export function Row({ p, open, onToggle, who, children }: { p: ProcedureSummary; open: boolean; onToggle: () => void; who: string; children?: ReactNode }) {
  const t = useT();
  return (
    <li className="pr-item" data-state={p.state}>
      <button type="button" className="cy-run-row" aria-expanded={open} aria-label={t('ui.procedures.row.open', { title: p.title })} onClick={onToggle}>
        <span className="cy-run-main">
          <span className="cy-run-title">{p.title}</span>
          <span className="faint small">{[t(KIND_LABEL[p.kind]), p.key, t('ui.procedures.row.by', { who }), t('ui.procedures.row.uses', { count: p.uses })].join(' · ')}</span>
          <span className="pr-badges">
            <span className={`badge cy-badge ${STATE_TONE[p.state]}`}>{t(STATE_LABEL[p.state])}</span>
            {!p.reviewed && <span className="badge badge-block">{t('ui.procedures.badge.notReviewed')}</span>}
            {p.old && <span className="badge badge-quiet">{t('ui.procedures.badge.old')}</span>}
            {p.withheld && <span className="badge badge-quiet">{t('ui.procedures.badge.withheld')}</span>}
          </span>
        </span>
      </button>
      {open && <div className="pr-open">{children}</div>}
    </li>
  );
}

export function ProceduresScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const team = useRunConfig()?.agents.team;
  const [list, setList] = useState<ProcedureListView | null>(null);
  const [stats, setStats] = useState<ProcedureStatsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProcedureFilters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    void Promise.all([proceduresApi.list(), proceduresApi.stats()]).then(
      ([l, s]) => {
        setList(l);
        setStats(s);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => load(), [load]);

  const shown = useMemo(() => sortProcedures(filterProcedures(list?.items ?? [], filters)), [list, filters]);
  const who = (by: string): string => (by === 'person' ? t('ui.procedures.person') : agentName(team, by));

  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 className="cy-title">{t('ui.procedures.title')}</h1>
          </div>
          {list && <span className="faint">{t('ui.procedures.shown', { shown: shown.length, total: list.items.length })}</span>}
        </header>
        <p className="small muted">{t('ui.procedures.lead')} {isWeb() && t('ui.procedures.leadWeb')}</p>
        {error && <div className="error" role="alert">{error} {t('ui.procedures.loadError')}</div>}
        {list && !list.enabled && <p className="pr-notice" role="status">{t(isWeb() ? 'ui.procedures.off' : 'ui.procedures.offDesktop')}</p>}
        {list && list.skipped > 0 && <p className="small muted">{t('ui.procedures.skipped', { count: list.skipped })}</p>}
        {!list && !error && <span className="spinner" aria-label={t('ui.procedures.loading')} />}
        {stats && list && list.items.length > 0 && <Summary stats={stats} />}
        {list && list.items.length > 0 && <Filters items={list.items} filters={filters} set={setFilters} />}
        {list && !shown.length && <p className="dash-calm">{t(list.items.length ? 'ui.procedures.emptyFilter' : 'ui.procedures.empty')}</p>}
        {shown.length > 0 && (
          <ul className="cy-run-list" aria-label={t('ui.procedures.list.label')}>
            {shown.map((p) => (
              <Row key={p.id} p={p} who={who(p.by)} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)}>
                <RecordPanel id={p.id} revision={p.revision} team={team} onChanged={load} />
              </Row>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
