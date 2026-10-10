import { catalogUrlProblem } from '../../../shared/config/offer';
import { EFFORT_SETTINGS, type Activity, ACTIVITIES, type LlmProvider, type WorkspaceConfig } from '../../../shared/config/types';
import { presetFeaturesOf } from '../../../shared/wizard';
import { useT } from '../i18n';
import { type Obsolete, effortSetting, withEffort, withFeatures, withPresetFeatures } from './poolEdit';
import { Notice } from './ui';

type SetCfg = (f: (c: WorkspaceConfig) => WorkspaceConfig) => void;

const SWITCHES = ['serviceTier', 'failFast', 'reasoningEffort'] as const;

/**
 * "Server features" of an open-engine provider: the three parameters it takes beyond the protocol, the address of its richer listing and the preset's own values on
 * a button. The app never switches any of it on by itself; this is where the person does. Only the draft changes.
 */
export function ProviderFeaturesBox({ provider, cfg, setCfg }: { provider: LlmProvider; cfg: WorkspaceConfig; setCfg: SetCfg }) {
  const t = useT();
  const f = cfg.llm.providers.find((p) => p.id === provider.id)?.features ?? {};
  const preset = presetFeaturesOf(provider.baseUrl);
  const problem = catalogUrlProblem(provider.baseUrl, f.catalogUrl);
  const id = `features-${provider.id}`;
  return (
    <fieldset className="wz-stack wz-fieldset" aria-labelledby={`${id}-title`}>
      <legend id={`${id}-title`} className="wz-sub">{t('wizard.features.title')}</legend>
      <p className="small muted">{t('wizard.features.hint')}</p>
      {SWITCHES.map((k) => (
        <label key={k} className="check-row">
          <input type="checkbox" checked={f[k] === true} onChange={(e) => setCfg((c) => withFeatures(c, provider.id, { [k]: e.target.checked }))} />
          <span><span style={{ fontWeight: 600, display: 'block' }}>{t(`wizard.features.${k}`)}</span><span className="small muted">{t(`wizard.features.${k}.hint`)}</span></span>
        </label>
      ))}
      <div className="wz-field">
        <label className="wz-label" htmlFor={`${id}-url`}>{t('wizard.features.catalogUrl')}</label>
        <input id={`${id}-url`} className="text-input mono" inputMode="url" spellCheck={false} aria-invalid={problem !== null || undefined} value={f.catalogUrl ?? ''} onChange={(e) => setCfg((c) => withFeatures(c, provider.id, { catalogUrl: e.target.value }))} />
        <div className="small muted">{t('wizard.features.catalogUrl.hint')}</div>
        {problem && <div className="error small" role="alert">{t(`wizard.features.problem.${problem}`)}</div>}
      </div>
      {preset && (
        <div className="wz-actions">
          <button type="button" className="btn" title={t('wizard.features.preset.hint')} onClick={() => setCfg((c) => withPresetFeatures(c, provider.id))}>{t('wizard.features.preset')}</button>
          <span className="small muted">{t('wizard.features.preset.hint')}</span>
        </div>
      )}
    </fieldset>
  );
}

/** One selector of reasoning effort per activity. "The model's own" sends nothing; an activity left at the proposal leaves nothing in the file. */
export function EffortFields({ cfg, setCfg }: { cfg: WorkspaceConfig; setCfg: SetCfg }) {
  const t = useT();
  return (
    <fieldset className="wz-stack wz-fieldset" aria-labelledby="wz-effort">
      <legend id="wz-effort" className="wz-sub">{t('wizard.effort.title')}</legend>
      <p className="small muted">{t('wizard.effort.intro')}</p>
      {ACTIVITIES.map((a: Activity) => (
        <div key={a} className="wz-field">
          <label className="wz-label" htmlFor={`effort-${a}`}>{t(`wizard.activity.${a}`)}</label>
          <select id={`effort-${a}`} className="text-input" aria-label={t('wizard.effort.label', { activity: t(`wizard.activity.${a}`) })} value={effortSetting(cfg, a)} onChange={(e) => setCfg((c) => withEffort(c, a, e.target.value as (typeof EFFORT_SETTINGS)[number]))}>
            {EFFORT_SETTINGS.map((level) => <option key={level} value={level}>{t(`wizard.effort.${level}`)}</option>)}
          </select>
        </div>
      ))}
    </fieldset>
  );
}

/** The models of a provider the draft uses and the provider marks obsolete, each with the date and the substitute it names. Nothing is swapped for the person. */
export function ObsoleteList({ items, text }: { items: Obsolete[]; text: (o: Obsolete) => string }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <Notice tone="warn">
      <div>{t('wizard.obsolete.title')}</div>
      <ul className="small">{items.map((o) => <li key={o.model}><span className="mono wz-wrap-anywhere">{o.where}</span> · {text(o)}</li>)}</ul>
    </Notice>
  );
}
