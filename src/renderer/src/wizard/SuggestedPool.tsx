import { useMemo, useState } from 'react';
import { type Activity, type LlmProvider, type ModelRef, type ScoredActivity, type WorkspaceConfig, LLM_ROLES, SCORED_ACTIVITIES } from '../../../shared/config/types';
import { type CatalogModel, catalogHasFacts } from '../../../shared/modelCatalog';
import { type RankedModel, MIN_SUGGESTED_CONTEXT, suggestPools } from '../../../shared/modelPools';
import { FLOORS, floorFor, scoreFor } from '../../../shared/modelScores';
import { intlLocale, useT } from '../i18n';
import { PoolFacts } from './PoolEditor';
import { applySuggestion, entryFacts, rolesOnProvider, withFloor, withModelScore, withOverrides } from './poolEdit';
import { Notice } from './ui';

interface Props {
  provider: LlmProvider;
  /** What the connection test read of this provider's listing. */
  catalog: CatalogModel[];
  cfg: WorkspaceConfig;
  setCfg: (change: (c: WorkspaceConfig) => WorkspaceConfig) => void;
  onTest: (ref: ModelRef) => void;
  /** `provider\nmodel` of the model being tested. */
  testing: string | null;
}

const num = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * "Suggested pool", after a connection test: the models of the provider's listing that can do the work, in the order of the price of a typical stage, with
 * the quality floors the app ships (editable). "Use the suggestion" only puts the pools in the draft; saving is the wizard's own save.
 */
export function SuggestedPool({ provider, catalog, cfg, setCfg, onTest, testing }: Props) {
  const t = useT();
  const [placed, setPlaced] = useState(false);
  const overrides = cfg.llm.scoreOverrides;
  const roles = rolesOnProvider(cfg, provider.id);
  const suggestion = useMemo(
    () => suggestPools(catalog, { provider: provider.id, scoreOverrides: overrides, roles }),
    // `roles` is rebuilt every render; what it says is what keys the memo.
    [catalog, provider.id, overrides, JSON.stringify(roles)],
  );
  const roleNames = LLM_ROLES.filter((r) => roles[r]).map((r) => t(`wizard.role.${r}`)).join(', ');
  const setOverrides = (next: ReturnType<typeof withFloor>) => {
    setPlaced(false);
    setCfg((c) => withOverrides(c, next));
  };

  const row = (r: RankedModel, key: Activity) => {
    const name = r.ref.model;
    const scored = (SCORED_ACTIVITIES as readonly string[]).includes(key) ? (key as ScoredActivity) : null;
    const mine = scored ? scoreFor(name, scored, overrides) : null;
    return (
      <li key={name} className="wz-pool-row">
        <span className="wz-pool-model mono wz-wrap-anywhere">{name}</span>
        <PoolFacts facts={entryFacts(r.ref, catalog, key, overrides)} />
        {r.ref.images === true && <span className="wz-chip wz-chip-ok">{t('wizard.cap.images')}</span>}
        {r.belowFloor && <span className="wz-chip wz-chip-unverified">{t('wizard.suggest.belowFloor')}</span>}
        <span className="wz-pool-actions">
          {scored && (
            <input
              className="text-input wz-score-input"
              type="number"
              min={0}
              max={100}
              step={0.1}
              inputMode="decimal"
              aria-label={t('wizard.suggest.scoreFor', { model: name, activity: t(`wizard.activity.${scored}`) })}
              placeholder={t('wizard.suggest.noScore')}
              value={mine?.score ?? ''}
              onChange={(e) => setOverrides(withModelScore(overrides, name, scored, num(e.target.value)))}
            />
          )}
          <button type="button" className="btn wz-mini" disabled={testing === `${provider.id}\n${name}`} onClick={() => onTest(r.ref)}>{t('wizard.pool.test')}</button>
        </span>
      </li>
    );
  };

  if (!catalogHasFacts(catalog)) {
    return <Notice tone="info">{t('wizard.suggest.noCatalog', { provider: provider.id })}</Notice>;
  }
  const activityLists = Object.entries(suggestion.activities) as [Activity, RankedModel[]][];
  return (
    <section className="wz-aside wz-suggest" aria-label={t('wizard.suggest.title')}>
      <h4 className="wz-sub">{t('wizard.suggest.title')}</h4>
      <p className="small">{t('wizard.suggest.intro', { provider: provider.id, tokens: MIN_SUGGESTED_CONTEXT.toLocaleString(intlLocale()) })}</p>
      <Notice tone="warn">{t('wizard.suggest.scoresNote')}</Notice>

      <fieldset className="wz-fieldset">
        <legend className="wz-label">{t('wizard.suggest.floors')}</legend>
        <p className="small muted">{t('wizard.suggest.floorsHint')}</p>
        <div className="wz-pool-floors">
          {SCORED_ACTIVITIES.map((a) => (
            <label key={a} className="wz-field">
              <span className="small">{t(`wizard.activity.${a}`)}</span>
              <input
                className="text-input"
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="decimal"
                aria-label={t('wizard.suggest.floorFor', { activity: t(`wizard.activity.${a}`) })}
                value={floorFor(a, overrides) ?? ''}
                onChange={(e) => setOverrides(withFloor(overrides, a, num(e.target.value)))}
              />
              <span className="small muted">{t('wizard.suggest.floorTable', { floor: String(FLOORS[a]) })}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {suggestion.write.length === 0 ? (
        <Notice tone="info">{t('wizard.suggest.none', { tokens: MIN_SUGGESTED_CONTEXT.toLocaleString(intlLocale()) })}</Notice>
      ) : (
        <>
          <div className="wz-pool-list" role="group" aria-label={t('wizard.suggest.default')}>
            <div className="wz-label">{t('wizard.suggest.default')}</div>
            <div className="small muted">{t('wizard.suggest.defaultHint')}</div>
            <ol className="wz-pool-entries">{suggestion.write.map((r) => row(r, 'write'))}</ol>
          </div>
          {activityLists.length > 0 && (
            <details className="wz-details">
              <summary>{t('wizard.suggest.byActivity', { count: activityLists.length })}</summary>
              <div className="wz-stack">
                {activityLists.map(([a, list]) => (
                  <div key={a} className="wz-pool-list" role="group" aria-label={t(`wizard.activity.${a}`)}>
                    <div className="wz-label">{t(`wizard.activity.${a}`)}</div>
                    <div className="small muted">{t(`wizard.activity.${a}.hint`)}</div>
                    <ol className="wz-pool-entries">{list.map((r) => row(r, a))}</ol>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="wz-actions">
            <button type="button" className="btn btn-dark" disabled={!roleNames} onClick={() => { setCfg((c) => applySuggestion(c, suggestion)); setPlaced(true); }}>{t('wizard.suggest.use')}</button>
            <span className="small muted">{roleNames ? t('wizard.suggest.useHint', { roles: roleNames }) : t('wizard.suggest.noRoles', { provider: provider.id })}</span>
          </div>
          {placed && <Notice tone="ok" role="status">{t('wizard.suggest.placed')}</Notice>}
        </>
      )}
    </section>
  );
}
