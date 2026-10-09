import { useState } from 'react';
import type { Screen } from '../App';
import { errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';
import { publishWorkspaces, useWorkspaces, workspaceApi } from '../workspaceApi';
import { ConfigExport, ConfigImport } from '../wizard/ConfigTransfer';
import { Notice } from '../wizard/ui';
import { RestartOverlay, WorkspacesSection } from './WorkspacesSection';
import { McpStateSection } from './McpStateSection';

/** Settings → "Configurações e workspaces": the setup wizard, export and import of a configuration, and the list of workspaces. */
export function ConfigWorkspacesSection({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const view = useWorkspaces();
  const web = isWeb();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  // A new workspace is born neutral (setupComplete false): switching to it relaunches the app straight into the wizard.
  const createWithWizard = async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await workspaceApi.create(name, false);
      publishWorkspaces(created);
      const id = created.list[created.list.length - 1].id;
      const r = await workspaceApi.switchTo(id);
      if (r.restarting) setRestarting(created.list.find((w) => w.id === id)?.name ?? name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wz-stack" aria-labelledby="cfg-ws-title">
      <h2 id="cfg-ws-title" className="wz-section-title" style={{ fontSize: 18, fontWeight: 600 }}>{t('settings.configWorkspaces.title')}</h2>
      {web ? (
        <Notice tone="info">{t('wizard.settings.webNote')}</Notice>
      ) : (
        <>
          <div className="panel wz-settings" aria-labelledby="cfg-wizard">
            <div>
              <h3 id="cfg-wizard" className="wz-sub">{t('settings.wizard.title')}</h3>
              <p className="small muted" style={{ marginTop: 4 }}>{t('wizard.settings.wizardHint')}</p>
            </div>
            <div className="wz-actions">
              <button type="button" className="btn btn-dark" onClick={() => go({ name: 'wizard' })}>{t('wizard.settings.open')}</button>
            </div>
            <form className="wz-stack" onSubmit={(e) => { e.preventDefault(); void createWithWizard(); }}>
              <div className="wz-label">{t('wizard.settings.newTitle')}</div>
              <p className="small muted">{t('wizard.settings.newHint')}</p>
              <input className="text-input" aria-label={t('wizard.settings.newName')} placeholder={t('wizard.settings.newName')} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              <div className="wz-actions">
                <button type="submit" className="btn" disabled={busy || !name.trim()}>{busy ? <span className="spinner" aria-hidden="true" /> : null} {t('wizard.settings.newSubmit')}</button>
              </div>
            </form>
            {error && <div className="error" role="alert">{error}</div>}
          </div>

          <div className="panel wz-settings" aria-labelledby="cfg-export">
            <div>
              <h3 id="cfg-export" className="wz-sub">{t('wizard.settings.exportTitle')}</h3>
            </div>
            <ConfigExport />
          </div>

          <div className="panel wz-settings" aria-labelledby="cfg-import">
            <div>
              <h3 id="cfg-import" className="wz-sub">{t('wizard.settings.importTitle')}</h3>
            </div>
            <ConfigImport runningId={view?.running ?? ''} workspaces={view?.list ?? []} allowNew onRestart={setRestarting} />
          </div>
        </>
      )}
      <WorkspacesSection />
      {restarting && <RestartOverlay name={restarting} />}
    </section>
  );
}
