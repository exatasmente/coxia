import { useEffect, useRef, useState } from 'react';
import { DOC_LINKS, SDK_EVENT, type SdkEvent, type SdkStatus } from '../../../../shared/wizard';
import { errorText, moduleEvents } from '../../api';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { ExternalLink, Notice } from '../ui';
import { wizardApi } from '../wizardApi';

const MAX_LINES = 80;

export function SdkStep({ cfg, setCfg, refreshView, avail }: StepProps) {
  const t = useT();
  const [status, setStatus] = useState<SdkStatus | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [just, setJust] = useState<string | null>(null);
  const log = useRef<HTMLPreElement>(null);

  const load = () => wizardApi.sdkStatus().then(setStatus, (e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const onEvent = (e: Event) => {
      const ev = (e as CustomEvent<SdkEvent>).detail;
      if (ev.phase === 'start') {
        setInstalling(true);
        setLines([]);
        setError(null);
      } else if (ev.phase === 'log') setLines((all) => [...all, ev.line].slice(-MAX_LINES));
      else if (ev.phase === 'done') {
        setInstalling(false);
        setJust(ev.version);
        void refreshView().then((v) => setCfg((c) => ({ ...c, claudeSdk: v.config.claudeSdk })));
        void load();
      } else if (ev.phase === 'error') {
        setInstalling(false);
        setError(ev.message);
      } else {
        setInstalling(false);
      }
    };
    moduleEvents.addEventListener(SDK_EVENT, onEvent);
    return () => moduleEvents.removeEventListener(SDK_EVENT, onEvent);
  }, [refreshView, setCfg]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines]);

  const install = async () => {
    setError(null);
    setInstalling(true);
    try {
      const r = await wizardApi.sdkInstall();
      if (!r.started) setError(t('wizard.sdk.already'));
    } catch (e) {
      setInstalling(false);
      setError(errorText(e));
    }
  };

  const failure = (message: string): string => (message === 'npm-missing' ? t('wizard.sdk.npmMissing') : message === 'installed-but-missing' ? t('wizard.sdk.notLanded') : message);

  const loc = status?.location;
  const ready = loc?.mode === 'local' || loc?.mode === 'bundled';

  return (
    <div className="wz-stack">
      {!status && !error && <span className="spinner" aria-label={t('wizard.loading')} />}

      {loc?.mode === 'bundled' && (
        <Notice tone="ok" role="status">
          <strong>{t('wizard.sdk.bundled')}</strong>
          {status?.version && <span className="small"> {t('wizard.sdk.version', { version: status.version })}</span>}
          <div className="small">{t('wizard.sdk.bundledHint')}</div>
          {!cfg.claudeSdk.installed && (
            <div className="wz-actions">
              <button type="button" className="btn" onClick={() => setCfg((c) => ({ ...c, claudeSdk: { installed: true, version: status?.version ?? null, path: null } }))}>{t('wizard.sdk.useBundled')}</button>
            </div>
          )}
        </Notice>
      )}
      {loc?.mode === 'local' && (
        <Notice tone="ok" role="status">
          <strong>{t('wizard.sdk.local')}</strong>
          {status?.version && <span className="small"> {t('wizard.sdk.version', { version: status.version })}</span>}
          <div className="small mono wz-wrap-anywhere">{loc.root}</div>
          {just && <div className="small">{t('wizard.sdk.justInstalled', { version: just })}</div>}
        </Notice>
      )}

      {!ready && status && (
        <section className="wz-stack" aria-labelledby="wz-terms">
          <h3 id="wz-terms" className="wz-sub">{t('wizard.sdk.termsTitle')}</h3>
          <p>{t('wizard.sdk.termsBody')}</p>
          <ul className="wz-list">
            <li><ExternalLink href={DOC_LINKS.legal}>{t('wizard.sdk.legalLink')}</ExternalLink> <span className="small muted mono">code.claude.com/docs/en/legal-and-compliance</span></li>
            <li><ExternalLink href={DOC_LINKS.commercialTerms}>{t('wizard.sdk.commercialLink')}</ExternalLink> <span className="small muted mono">anthropic.com/legal/commercial-terms</span></li>
          </ul>
          <Notice tone="info">{t('wizard.sdk.noSubscription')}</Notice>
          <label className="check-row">
            <input type="checkbox" checked={accepted} disabled={installing} onChange={(e) => setAccepted(e.target.checked)} />
            <span><span style={{ fontWeight: 600, display: 'block' }}>{t('wizard.sdk.accept')}</span><span className="small muted">{t('wizard.sdk.acceptHint', { dir: status.installDir })}</span></span>
          </label>
          {avail && !avail.npm && <Notice tone="warn">{t('wizard.sdk.npmMissing')}</Notice>}
          <div className="wz-actions">
            <button type="button" className="btn btn-dark" disabled={!accepted || installing} onClick={() => void install()}>
              {installing ? <span className="spinner" aria-hidden="true" /> : null} {t(installing ? 'wizard.sdk.installing' : 'wizard.sdk.install')}
            </button>
            {installing && <button type="button" className="btn" onClick={() => void wizardApi.sdkCancel()}>{t('wizard.cancel')}</button>}
          </div>
        </section>
      )}

      {(installing || lines.length > 0) && !ready && (
        <pre ref={log} className="wz-log" role="log" aria-live="polite" aria-label={t('wizard.sdk.log')} tabIndex={0}>{lines.join('\n') || t('wizard.sdk.starting')}</pre>
      )}
      {error && <div className="error" role="alert">{failure(error)}</div>}
      {!ready && status && <p className="small muted">{t('wizard.sdk.skipHint')}</p>}
    </div>
  );
}
