import { useEffect, useState } from 'react';
import { DOCS_KEYS, type DocsKey, type DocsScanResult } from '../../../../shared/wizard';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import type { StepProps } from '../SetupWizard';
import { DocsSourceLists } from '../DocsSourceLists';
import { Field, Notice } from '../ui';
import { wizardApi } from '../wizardApi';

const SPECS_PLACEHOLDER = '~/project/.specs'; // i18n-ignore: example path

export function DocsStep({ cfg, setCfg }: StepProps) {
  const t = useT();
  const [scan, setScan] = useState<DocsScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setScanning(true);
    setError(null);
    try {
      setScan(await wizardApi.scanDocs());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const add = (k: DocsKey, path: string) => {
    const p = path.trim();
    if (!p) return;
    setCfg((c) => (c.docs[k].includes(p) ? c : { ...c, docs: { ...c.docs, [k]: [...c.docs[k], p] } }));
  };
  const remove = (k: DocsKey, path: string) => setCfg((c) => ({ ...c, docs: { ...c.docs, [k]: c.docs[k].filter((x) => x !== path) } }));

  const proposals = (k: DocsKey): string[] => (scan?.found[k] ?? []).filter((p) => !cfg.docs[k].includes(p));
  const totalProposals = DOCS_KEYS.reduce((n, k) => n + proposals(k).length, 0);

  return (
    <div className="wz-stack">
      <div className="wz-actions">
        <button type="button" className="btn" disabled={scanning} onClick={() => void run()}>{scanning ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.docs.rescan')}</button>
        {totalProposals > 0 && <button type="button" className="btn" onClick={() => DOCS_KEYS.forEach((k) => proposals(k).forEach((p) => add(k, p)))}>{t('wizard.docs.addAll', { count: totalProposals })}</button>}
      </div>
      {scan && <p className="small muted" role="status">{t(scan.source === 'scanner' ? 'wizard.docs.sourceScanner' : 'wizard.docs.sourceFallback')} {totalProposals === 0 && t('wizard.docs.nothingNew')}</p>}
      {error && <div className="error" role="alert">{error}</div>}

      {scan?.projects && scan.projects.length > 0 && (
        <section className="wz-stack wz-group" aria-labelledby="docs-projects">
          <h3 id="docs-projects" className="wz-sub">{t('wizard.docs.projects')}</h3>
          <ul className="wz-cards">
            {scan.projects.map((p) => (
              <li key={p.path} className="wz-card-item wz-stack">
                <span className="wz-card-title">{p.id}</span>
                <span className="small muted wz-block">{p.summary}</span>
              </li>
            ))}
          </ul>
          {scan.notes?.map((n) => <p key={n} className="small muted">{n}</p>)}
        </section>
      )}

      <label className="check-row">
        <input type="checkbox" checked={cfg.docs.autoDetect} onChange={(e) => setCfg((c) => ({ ...c, docs: { ...c.docs, autoDetect: e.target.checked } }))} />
        <span><span style={{ fontWeight: 600, display: 'block' }}>{t('wizard.docs.autoDetect')}</span><span className="small muted">{t('wizard.docs.autoDetectHint')}</span></span>
      </label>

      <DocsSourceLists docs={cfg.docs} onAdd={add} onRemove={remove} proposals={proposals} onError={setError} />

      <section className="wz-stack wz-group">
        <Field label={t('wizard.docs.specsDir')} htmlFor="wz-specs" hint={t('wizard.docs.specsDirHint')}>
          <input id="wz-specs" className="text-input mono" spellCheck={false} placeholder={SPECS_PLACEHOLDER} value={cfg.docs.specsDir ?? ''} onChange={(e) => setCfg((c) => ({ ...c, docs: { ...c.docs, specsDir: e.target.value.trim() || null } }))} />
        </Field>
        {cfg.docs.specsDir && <Notice tone="info">{t('wizard.docs.specsNote')}</Notice>}
        {scan?.specsDir && scan.specsDir !== cfg.docs.specsDir && (
          <div className="wz-card-item wz-row-between wz-found">
            <span className="mono small wz-wrap-anywhere"><span className="badge badge-ask" style={{ marginRight: 8 }}>{t('wizard.docs.found')}</span>{scan.specsDir}</span>
            <button type="button" className="btn" onClick={() => setCfg((c) => ({ ...c, docs: { ...c.docs, specsDir: scan.specsDir ?? null } }))}>{t('wizard.docs.useSpecs')}</button>
          </div>
        )}
      </section>
    </div>
  );
}
