import { type ReactNode, useEffect, useState } from 'react';
import { CEREMONY_IDS, LLM_ROLES } from '../../../../shared/config/types';
import { collectSecretRequirements } from '../../../../shared/config/validate';
import { DOCS_KEYS, type WizardStepId, needsSdk, visibleSteps } from '../../../../shared/wizard';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { ConfigExport } from '../ConfigTransfer';
import { Notice } from '../ui';
import { wizardApi } from '../wizardApi';

type Status = 'ok' | 'warn' | 'skip';

function Row({ step, status, children, onEdit }: { step: WizardStepId; status: Status; children: ReactNode; onEdit: (s: WizardStepId) => void }) {
  const t = useT();
  return (
    <li className="wz-review-row">
      <span className={`wz-dot wz-dot-${status}`} aria-hidden="true">{status === 'ok' ? '✓' : status === 'warn' ? '!' : '–'}</span>
      <div className="wz-review-body">
        <div className="wz-card-title">
          {t(`wizard.step.${step}`)}
          <span className="wz-sr"> ({t(`wizard.review.status.${status}`)})</span>
        </div>
        <div className="small wz-wrap-anywhere">{children}</div>
      </div>
      <button type="button" className="btn" onClick={() => onEdit(step)} aria-label={t('wizard.review.editStep', { step: t(`wizard.step.${step}`) })}>{t('wizard.review.edit')}</button>
    </li>
  );
}

export function ReviewStep({ cfg, view, goTo, finish }: StepProps) {
  const t = useT();
  const [check, setCheck] = useState<{ ok: boolean; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] } | null>(null);

  useEffect(() => {
    let live = true;
    void wizardApi.validate(cfg).then((r) => live && setCheck(r), () => undefined);
    return () => {
      live = false;
    };
  }, [cfg]);

  const missing = collectSecretRequirements(cfg).filter((r) => !view.secrets.some((s) => s.ref === r.ref && s.available));
  const sdkNeeded = needsSdk(cfg);
  const sdkReady = view.claudeSdk.mode !== 'missing';
  const steps = visibleSteps(cfg);
  const ceremonies = CEREMONY_IDS.filter((c) => cfg.devCycle.ceremonies[c]);
  const docsCount = DOCS_KEYS.reduce((n, k) => n + cfg.docs[k].length, 0);
  const keyOf = (ref: string | null) => !ref || view.secrets.some((s) => s.ref === ref && s.available);

  return (
    <div className="wz-stack">
      <ul className="wz-review">
        <Row step="language" status="ok" onEdit={goTo}>
          {t(`settings.language.${cfg.language}`)} · {cfg.userName || t('wizard.review.noName')}
        </Row>
        <Row step="models" status={cfg.llm.providers.every((p) => keyOf(p.secretRef)) ? 'ok' : 'warn'} onEdit={goTo}>
          <div>{t('wizard.review.providers', { list: cfg.llm.providers.map((p) => `${p.id}${keyOf(p.secretRef) ? '' : ' (' + t('wizard.models.keyMissing') + ')'}`).join(', ') })}</div>
          <ul className="wz-list">{LLM_ROLES.map((r) => <li key={r} className="mono">{t(`wizard.role.${r}`)}: {cfg.llm.roles[r].provider}/{cfg.llm.roles[r].model}</li>)}</ul>
        </Row>
        {steps.includes('sdk') && (
          <Row step="sdk" status={sdkReady ? 'ok' : 'warn'} onEdit={goTo}>
            {t(`wizard.review.sdk.${view.claudeSdk.mode}`)}
          </Row>
        )}
        <Row step="projects" status={cfg.projects.roots.length || cfg.projects.repos.length ? 'ok' : 'skip'} onEdit={goTo}>
          {t('wizard.review.projects', { roots: cfg.projects.roots.length, repos: cfg.projects.repos.length })}
        </Row>
        <Row step="integrations" status={cfg.vcs.length ? (cfg.vcs.every((v) => keyOf(v.secretRef) && v.secretRef) ? 'ok' : 'warn') : 'skip'} onEdit={goTo}>
          {cfg.vcs.length ? cfg.vcs.map((v) => `${t(`wizard.vcs.${v.kind}`)} ${v.host}${v.secretRef && keyOf(v.secretRef) ? '' : ' (' + t('wizard.review.noToken') + ')'}`).join(' · ') : t('wizard.review.none')}
        </Row>
        <Row step="docs" status={docsCount || cfg.docs.autoDetect ? 'ok' : 'skip'} onEdit={goTo}>
          {t('wizard.review.docs', { count: docsCount })}{cfg.docs.autoDetect ? ` · ${t('wizard.review.autoDetect')}` : ''}
        </Row>
        <Row step="cycle" status={cfg.devCycle.templateId === 'none' ? 'skip' : 'ok'} onEdit={goTo}>
          {t('wizard.review.cycle', { template: cfg.devCycle.templateId, count: ceremonies.length })}
        </Row>
        <Row step="voice" status={cfg.voice.enabled ? (cfg.voice.depsInstalled ? 'ok' : 'warn') : 'skip'} onEdit={goTo}>
          {cfg.voice.enabled ? t('wizard.review.voiceOn', { engine: t(`wizard.voice.engine.${cfg.voice.engine}`) }) : t('wizard.review.voiceOff')}
        </Row>
      </ul>

      {sdkNeeded && !sdkReady && <Notice tone="warn">{t('wizard.review.sdkWarn')}</Notice>}
      {missing.length > 0 && <Notice tone="warn">{t('wizard.review.missingSecrets', { refs: missing.map((m) => m.ref).join(', ') })}</Notice>}
      {check && check.errors.length > 0 && (
        <Notice tone="error">
          <strong>{t('wizard.review.errors')}</strong>
          <ul className="wz-list">{check.errors.map((e, i) => <li key={i} className="mono small">{e.path}: {e.message}</li>)}</ul>
        </Notice>
      )}
      {check && check.warnings.length > 0 && (
        <details className="wz-details">
          <summary>{t('wizard.review.warnings', { count: check.warnings.length })}</summary>
          <ul className="wz-list">{check.warnings.map((e, i) => <li key={i} className="mono small">{e.path}: {e.message}</li>)}</ul>
        </details>
      )}

      <section className="wz-aside" aria-labelledby="wz-export">
        <h3 id="wz-export" className="wz-sub">{t('wizard.review.exportTitle')}</h3>
        <ConfigExport />
      </section>

      <div className="wz-actions">
        <button type="button" className="btn btn-dark" disabled={!!check && !check.ok} onClick={finish}>{t('wizard.finish')}</button>
      </div>
    </div>
  );
}
