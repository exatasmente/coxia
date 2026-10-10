import { useId, useState } from 'react';
import { ACTIVITIES, MAX_POOL_ENTRIES, type Activity, type LlmProvider, type ModelPool, type ModelRef, type ScoreOverrides } from '../../../shared/config/types';
import { deprecationOf } from '../../../shared/config/offer';
import type { CatalogModel } from '../../../shared/modelCatalog';
import { intlLocale, useT } from '../i18n';
import { type AddProblem, type EntryFacts, type PoolListKey, addEntry, entryFacts, listOf, moveEntry, removeEntry, withList, withMark } from './poolEdit';

/** US dollars of one typical stage, for the lines of a pool. */
export function usd(n: number): string {
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(n);
}

/** The facts beside an entry: the price of a stage, the window, the scores with their source, and what the listing did not say. */
export function PoolFacts({ facts }: { facts: EntryFacts }) {
  const t = useT();
  const parts: string[] = [];
  if (facts.cost !== null) parts.push(t('wizard.pool.cost', { cost: usd(facts.cost) }));
  if (facts.contextWindow !== null) parts.push(t('wizard.pool.context', { tokens: facts.contextWindow.toLocaleString(intlLocale()) }));
  for (const { activity, found } of facts.scores) {
    const params = { activity: t(`wizard.activity.${activity}`), score: found.score.toLocaleString(intlLocale()) };
    parts.push(found.source === 'override' ? t('wizard.pool.scoreOverride', params) : t('wizard.pool.score', { ...params, benchmark: found.source.benchmark, origin: t(`wizard.pool.origin.${found.source.origin}`) }));
  }
  return (
    <span className="small muted wz-pool-facts">
      {parts.length > 0 ? parts.join(' · ') : t('wizard.pool.noFacts')}
      {facts.unverified.map((u) => <span key={u} className="wz-chip wz-chip-unverified">{t(`wizard.pool.unverified.${u}`)}</span>)}
    </span>
  );
}

/** When the provider retires a model, in the reader's own format. */
export const retiredDate = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString(intlLocale(), { year: 'numeric', month: 'short', day: 'numeric' });

/** "Obsolete since <date>; substitute: <model>", in words that fit a date already past or still to come. Only a warning: nothing is swapped. */
export function obsoleteText(t: ReturnType<typeof useT>, offer: ModelRef['offer']): string | null {
  const d = deprecationOf(offer);
  if (!d) return null;
  const key = d.past ? (d.replacedBy ? 'wizard.pool.deprecated.past' : 'wizard.pool.deprecated.pastNoSub') : d.replacedBy ? 'wizard.pool.deprecated.future' : 'wizard.pool.deprecated.futureNoSub';
  return t(key, { date: retiredDate(d.at), model: d.replacedBy ?? '' });
}

export function ObsoleteNote({ offer }: { offer: ModelRef['offer'] }) {
  const t = useT();
  const text = obsoleteText(t, offer);
  return text ? <span className="small wz-chip wz-chip-unverified wz-wrap-anywhere" role="note">{text}</span> : null;
}

/** The marks the catalog gave an entry (served in the flex tier, takes the effort), which the person corrects on the row, and the warning of an obsolete model. */
function EntryOffer({ entry, provider, name, onMark }: { entry: ModelRef; provider?: LlmProvider; name: string; onMark?: (mark: 'flex' | 'effort', on: boolean) => void }) {
  const t = useT();
  const marks = (['flex', 'effort'] as const).filter((m) => (m === 'flex' ? provider?.features?.serviceTier : provider?.features?.reasoningEffort));
  return (
    <span className="wz-pool-offer">
      {marks.map((m) => {
        const on = entry.offer?.[m] === true;
        return (
          <button key={m} type="button" className={`wz-chip wz-chip-btn ${on ? 'wz-chip-ok' : ''}`} aria-pressed={on} disabled={!onMark} title={t(`wizard.pool.offer.${m}.title`)} aria-label={t(`wizard.pool.offer.${m}.aria`, { model: name })} onClick={() => onMark?.(m, !on)}>
            {t(`wizard.pool.offer.${m}`)}
          </button>
        );
      })}
      <ObsoleteNote offer={entry.offer} />
    </span>
  );
}

interface ListProps {
  list: PoolListKey;
  title: string;
  hint?: string;
  empty: string;
  pool: ModelPool;
  onChange: (next: ModelPool) => void;
  providers: LlmProvider[];
  primary?: ModelRef | null;
  catalogs?: Record<string, CatalogModel[]>;
  overrides?: ScoreOverrides;
  onTest?: (ref: ModelRef) => void;
  testing?: string | null;
  onPrimary?: (next: ModelRef) => void;
}

function PoolList({ list, title, hint, empty, pool, onChange, providers, primary, catalogs, overrides, onTest, testing, onPrimary }: ListProps) {
  const t = useT();
  const id = useId();
  const entries = listOf(pool, list);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [problem, setProblem] = useState<AddProblem | null>(null);
  const chosen = providers.some((p) => p.id === provider) ? provider : (primary?.provider ?? providers[0]?.id ?? '');
  const set = (next: ModelRef[]) => onChange(withList(pool, list, next));
  const add = () => {
    const r = addEntry(entries, { provider: chosen, model }, providers.map((p) => p.id), list === 'fallbacks' ? primary : null);
    if ('problem' in r) {
      setProblem(r.problem);
      return;
    }
    setProblem(null);
    setModel('');
    set(r.list);
  };
  const facts = (r: ModelRef) => entryFacts(r, catalogs?.[r.provider], list, overrides);
  const listName = title;
  return (
    <div className="wz-pool-list" role="group" aria-label={title}>
      <div className="wz-label">{title}</div>
      {hint && <div className="small muted">{hint}</div>}
      {list === 'fallbacks' && primary && primary.model && (
        <div className="wz-pool-row wz-pool-own">
          <span className="wz-pool-model mono wz-wrap-anywhere">{primary.provider} · {primary.model}</span>
          <PoolFacts facts={facts(primary)} />
          <EntryOffer entry={primary} provider={providers.find((p) => p.id === primary.provider)} name={`${primary.provider} · ${primary.model}`} onMark={onPrimary && ((m, on) => onPrimary(withMark(primary, m, on)))} />
          <span className="badge badge-quiet">{t('wizard.pool.own')}</span>
        </div>
      )}
      {entries.length === 0 && <p className="small muted">{empty}</p>}
      {entries.length > 0 && (
        <ol className="wz-pool-entries">
          {entries.map((r, i) => {
            const name = `${r.provider} · ${r.model}`;
            return (
              <li key={`${r.provider}\n${r.model}`} className="wz-pool-row">
                <span className="wz-pool-model mono wz-wrap-anywhere">{name}</span>
                <PoolFacts facts={facts(r)} />
                <EntryOffer entry={r} provider={providers.find((p) => p.id === r.provider)} name={name} onMark={(m, on) => set(entries.map((x, j) => (j === i ? withMark(x, m, on) : x)))} />
                <span className="wz-pool-actions">
                  <button type="button" className="btn wz-mini" aria-label={t('wizard.pool.up', { model: name })} disabled={i === 0} onClick={() => set(moveEntry(entries, i, -1))}>↑</button>
                  <button type="button" className="btn wz-mini" aria-label={t('wizard.pool.down', { model: name })} disabled={i === entries.length - 1} onClick={() => set(moveEntry(entries, i, 1))}>↓</button>
                  {onTest && <button type="button" className="btn wz-mini" disabled={testing === `${r.provider}\n${r.model}`} onClick={() => onTest(r)}>{t('wizard.pool.test')}</button>}
                  <button type="button" className="btn wz-mini" aria-label={t('wizard.pool.remove', { model: name })} onClick={() => set(removeEntry(entries, i))}>×</button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="wz-pool-add">
        <select className="text-input" aria-label={t('wizard.pool.addProvider', { list: listName })} value={chosen} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        <input
          className="text-input mono"
          list={`${id}-models`}
          spellCheck={false}
          aria-label={t('wizard.pool.addModel', { list: listName })}
          placeholder={t('wizard.pool.addPlaceholder')}
          value={model}
          onChange={(e) => { setModel(e.target.value); setProblem(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <datalist id={`${id}-models`}>{(providers.find((p) => p.id === chosen)?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
        <button type="button" className="btn" disabled={entries.length >= MAX_POOL_ENTRIES} onClick={add}>{t('wizard.pool.add')}</button>
      </div>
      {problem && <div className="error small" role="alert">{t(`wizard.pool.problem.${problem}`)}</div>}
    </div>
  );
}

export interface PoolEditorProps {
  providers: LlmProvider[];
  /** The model the pool belongs to; the reserves come after it. */
  primary?: ModelRef | null;
  value: ModelPool;
  onChange: (next: ModelPool) => void;
  /** What the connection test read of each provider's listing, for the price of a stage. */
  catalogs?: Record<string, CatalogModel[]>;
  overrides?: ScoreOverrides;
  /** "Test this model" on an entry. Absent: no button (the agent editor has no connection test). */
  onTest?: (ref: ModelRef) => void;
  /** `provider\nmodel` of the entry being tested. */
  testing?: string | null;
  /** The marks of the model the pool belongs to are corrected here (it is not one of the lists). Absent: they are shown and not edited. */
  onPrimary?: (next: ModelRef) => void;
}

/** The reserves of a model, from the cheapest to the most expensive, and, folded, a list for each kind of work. Only edits the value it is given. */
export function PoolEditor({ providers, primary, value, onChange, catalogs, overrides, onTest, testing, onPrimary }: PoolEditorProps) {
  const t = useT();
  const own = ACTIVITIES.filter((a) => listOf(value, a).length > 0).length;
  const shared = { pool: value, onChange, providers, primary, catalogs, overrides, onTest, testing, onPrimary };
  return (
    <div className="wz-pool">
      <PoolList {...shared} list="fallbacks" title={t('wizard.pool.reserves')} hint={t('wizard.pool.hint')} empty={t('wizard.pool.empty')} />
      <details className="wz-details" open={own > 0 || undefined}>
        <summary>{t('wizard.pool.byActivity', { count: own })}</summary>
        <div className="wz-stack">
          <p className="small muted">{t('wizard.pool.byActivityHint')}</p>
          {ACTIVITIES.map((a: Activity) => (
            <PoolList key={a} {...shared} list={a} title={t(`wizard.activity.${a}`)} hint={t(`wizard.activity.${a}.hint`)} empty={t('wizard.pool.usesRole')} />
          ))}
        </div>
      </details>
    </div>
  );
}
