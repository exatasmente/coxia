import { useState } from 'react';
import { LANGUAGES } from '../../../../shared/config/types';
import { useT } from '../../i18n';
import { RestartOverlay } from '../../screens/WorkspacesSection';
import { useWorkspaces } from '../../workspaceApi';
import type { StepProps } from '../SetupWizard';
import { ConfigImport } from '../ConfigTransfer';
import { Field } from '../ui';

export function LanguageStep({ cfg, setCfg, reload, firstRun }: StepProps) {
  const t = useT();
  const workspaces = useWorkspaces();
  const [importing, setImporting] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  return (
    <div className="wz-stack">
      <div role="group" aria-labelledby="wz-lang-label" className="wz-stack">
        <div id="wz-lang-label" className="wz-label">{t('settings.language.title')}</div>
        <div className="wz-pills">
          {LANGUAGES.map((lang) => (
            <button key={lang} type="button" aria-pressed={cfg.language === lang} className={`filter ${cfg.language === lang ? 'on' : ''}`} onClick={() => setCfg((c) => ({ ...c, language: lang }))}>
              {t(`settings.language.${lang}`)}
            </button>
          ))}
        </div>
      </div>

      <Field label={t('wizard.language.name')} htmlFor="wz-name" hint={t('wizard.language.nameHint')}>
        <input id="wz-name" className="text-input" autoComplete="given-name" maxLength={80} value={cfg.userName} onChange={(e) => setCfg((c) => ({ ...c, userName: e.target.value }))} />
      </Field>

      <section className="wz-aside" aria-labelledby="wz-import-title">
        <h3 id="wz-import-title" className="wz-sub">{t('wizard.language.importTitle')}</h3>
        <p className="small muted">{t(firstRun ? 'wizard.language.importHint' : 'wizard.language.importHintRerun')}</p>
        {!importing ? (
          <div className="wz-actions">
            <button type="button" className="btn" onClick={() => setImporting(true)}>{t('wizard.language.importOpen')}</button>
          </div>
        ) : (
          <ConfigImport
            runningId={workspaces?.running ?? ''}
            workspaces={workspaces?.list ?? []}
            allowNew={!firstRun}
            onApplied={(r) => {
              if (r.appliedToRunning) void reload();
            }}
            onRestart={setRestarting}
          />
        )}
      </section>
      {restarting && <RestartOverlay name={restarting} />}
    </div>
  );
}
