import { useEffect, useState } from 'react';
import { mergeDeep, neutralConfig } from '../../../../shared/config/defaults';
import { CEREMONY_IDS, STAGE_KINDS, type StageDef, type WorkspaceConfig } from '../../../../shared/config/types';
import type { CycleTemplateInfo, CycleTemplatesResult } from '../../../../shared/wizard';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { Notice } from '../ui';
import { wizardApi } from '../wizardApi';

/** The config after choosing a template: the cycle section starts from the neutral one, then the template's patch goes over it. */
export function applyTemplate(c: WorkspaceConfig, tpl: Pick<CycleTemplateInfo, 'id' | 'patch'>): WorkspaceConfig {
  const base: WorkspaceConfig = { ...c, devCycle: neutralConfig().devCycle };
  const next = tpl.patch ? mergeDeep(base, tpl.patch) : base;
  return { ...next, devCycle: { ...next.devCycle, templateId: tpl.id } };
}

export function CycleStep({ cfg, setCfg }: StepProps) {
  const t = useT();
  const [res, setRes] = useState<CycleTemplatesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wizardApi.cycleTemplates().then(setRes, (e) => setError(errorText(e)));
  }, []);

  const current = cfg.devCycle.templateId;
  const trackerOn = cfg.vcs.length > 0 && !!cfg.projects.issues.vcsId;

  const setStage = (id: string, change: Partial<StageDef>) => setCfg((c) => ({ ...c, devCycle: { ...c.devCycle, stages: c.devCycle.stages.map((s) => (s.id === id ? { ...s, ...change } : s)) } }));

  return (
    <div className="wz-stack">
      {error && <div className="error" role="alert">{error}</div>}
      {!res && !error && <span className="spinner" aria-label={t('wizard.loading')} />}
      {res?.source === 'placeholder' && <Notice tone="info">{t('wizard.cycle.placeholder')}</Notice>}

      {res && (
        <div role="radiogroup" aria-label={t('wizard.cycle.templates')} className="wz-cards">
          {res.templates.map((tpl) => {
            const placeholder = res.source === 'placeholder';
            const name = placeholder ? t(`wizard.cycle.tpl.${tpl.id}`) : tpl.name;
            const desc = placeholder ? t(`wizard.cycle.tpl.${tpl.id}.hint`) : tpl.description;
            return (
              <label key={tpl.id} className={`wz-card-item wz-choice ${current === tpl.id ? 'wz-on' : ''} ${tpl.available ? '' : 'wz-disabled'}`}>
                <input type="radio" name="cycle-template" checked={current === tpl.id} disabled={!tpl.available} onChange={() => setCfg((c) => applyTemplate(c, tpl))} />
                <span>
                  <span className="wz-card-title">{name} {!tpl.available && <span className="badge badge-quiet">{t('wizard.soon')}</span>}</span>
                  {desc && <span className="small muted wz-block">{desc}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <section className="wz-stack" aria-labelledby="wz-ceremonies">
        <h3 id="wz-ceremonies" className="wz-sub">{t('wizard.cycle.ceremonies')}</h3>
        <p className="small muted">{t('wizard.cycle.ceremoniesHint')}</p>
        {CEREMONY_IDS.map((id) => (
          <label key={id} className="check-row">
            <input type="checkbox" checked={cfg.devCycle.ceremonies[id]} onChange={(e) => setCfg((c) => ({ ...c, devCycle: { ...c.devCycle, ceremonies: { ...c.devCycle.ceremonies, [id]: e.target.checked } } }))} />
            <span><span style={{ fontWeight: 600, display: 'block' }}>{t(`wizard.cer.${id}`)}</span><span className="small muted">{t(`wizard.cer.${id}.hint`)}</span></span>
          </label>
        ))}
      </section>

      {cfg.devCycle.stages.length > 0 && (
        <section className="wz-stack" aria-labelledby="wz-stages">
          <h3 id="wz-stages" className="wz-sub">{t('wizard.cycle.stages')}</h3>
          <p className="small muted">{t('wizard.cycle.stagesHint')}</p>
          {!trackerOn && <Notice tone="warn">{t('wizard.cycle.noTracker')}</Notice>}
          <ul className="wz-cards">
            {cfg.devCycle.stages.map((s) => (
              <li key={s.id} className="wz-card-item wz-stack">
                <div className="wz-card-head">
                  <span className="wz-card-title">{s.label}</span>
                  <span className="badge badge-quiet">{t(`wizard.stageKind.${s.kind}`)}</span>
                </div>
                <label className="wz-field">
                  <span className="wz-label">{t('wizard.cycle.stageMatch', { stage: s.label })}</span>
                  <input className="text-input mono" spellCheck={false} value={s.match.join(', ')} onChange={(e) => setStage(s.id, { match: e.target.value.split(',').map((m) => m.trim()).filter(Boolean) })} />
                </label>
              </li>
            ))}
          </ul>
          <p className="small muted">{t('wizard.cycle.stageKinds', { kinds: STAGE_KINDS.map((k) => t(`wizard.stageKind.${k}`)).join(', ') })}</p>
        </section>
      )}
    </div>
  );
}
