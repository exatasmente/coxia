import { useEffect, useState } from 'react';
import type { WorkspaceInfo } from '../../../shared/workspaces';
import { errorText } from '../api';
import { intlLocale, tNodes, useT } from '../i18n';
import { isWeb } from '../platform';
import { publishWorkspaces, useWorkspaces, workspaceApi } from '../workspaceApi';

const day = (iso: string): string => new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

// The window closes and opens again by itself; a browser waits for the server to come back and reloads.
export function RestartOverlay({ name }: { name: string }) {
  const t = useT();
  useEffect(() => {
    if (!isWeb()) return;
    let sawDown = false;
    const started = Date.now();
    const timer = setInterval(() => {
      void fetch(new URL('api/session', document.baseURI), { credentials: 'same-origin', cache: 'no-store' }).then(
        () => {
          if (sawDown || Date.now() - started > 15_000) location.reload();
        },
        () => {
          sawDown = true;
        },
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="ws-restart" role="status" aria-live="polite">
      <div className="panel ws-restart-card">
        <span className="spinner" aria-hidden="true" />
        <div style={{ fontWeight: 600 }}>{t('ui.workspaces.restart.title')}</div>
        <div className="small muted">{isWeb() ? t('ui.workspaces.restart.openingWeb', { name }) : t('ui.workspaces.restart.opening', { name })}</div>
      </div>
    </div>
  );
}

function Item({ w, running, current, onError, onRestart, onlyOne }: { w: WorkspaceInfo; running: boolean; current: boolean; onError: (m: string | null) => void; onRestart: (name: string) => void; onlyOne: boolean }) {
  const t = useT();
  const web = isWeb();
  const [mode, setMode] = useState<'rename' | 'switch' | 'delete' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<unknown>) => {
    onError(null);
    setBusy(true);
    try {
      await job();
      setMode(null);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (next: 'rename' | 'switch' | 'delete') => {
    onError(null);
    setDraft(next === 'rename' ? w.name : '');
    setMode(next);
  };

  return (
    <li className="ws-item">
      <div className="ws-head">
        <div className="ws-title">
          <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{w.name}</span>
          {running && <span className="badge badge-now">{t('ui.workspaces.badge.running')}</span>}
          {!running && current && <span className="badge badge-quiet">{t('ui.workspaces.badge.current')}</span>}
          {w.test && <span className="badge badge-block">{t('ui.workspaces.badge.test')}</span>}
        </div>
        <div className="small muted">{t('ui.workspaces.createdAt', { date: day(w.createdAt) })}</div>
      </div>

      {!web && (
        <label className="ws-flag">
          <input type="checkbox" checked={w.test} disabled={busy} onChange={() => void run(() => workspaceApi.setTest(w.id, !w.test))} />
          <span>
            <span style={{ fontWeight: 600 }}>{t('ui.workspaces.test.label')}</span>
            <span className="small muted" style={{ display: 'block' }}>{t('ui.workspaces.test.hint')}</span>
          </span>
        </label>
      )}

      {mode === null && (
        <div className="ws-actions">
          {!current && <button type="button" className="btn btn-dark" onClick={() => open('switch')}>{t('ui.workspaces.use')}</button>}
          <button type="button" className="btn" onClick={() => open('rename')}>{t('ui.workspaces.rename')}</button>
          {!web && !running && !current && !onlyOne && <button type="button" className="btn" onClick={() => open('delete')}>{t('ui.workspaces.delete')}</button>}
        </div>
      )}

      {mode === 'rename' && (
        <form className="ws-form" onSubmit={(e) => { e.preventDefault(); void run(() => workspaceApi.rename(w.id, draft)); }}>
          <input className="text-input" aria-label={t('ui.workspaces.newNameAria')} value={draft} maxLength={60} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <div className="ws-actions">
            <button type="submit" className="btn btn-dark" disabled={busy || !draft.trim()}>{t('ui.workspaces.saveName')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>{t('ui.workspaces.cancel')}</button>
          </div>
        </form>
      )}

      {mode === 'switch' && (
        <div className="ws-confirm" role="alertdialog" aria-label={t('ui.workspaces.switch.aria', { name: w.name })}>
          <div>{t('ui.workspaces.switch.text', { name: w.name })}</div>
          <div className="ws-actions">
            <button
              type="button"
              className="btn btn-dark"
              disabled={busy}
              onClick={() => void run(async () => {
                const r = await workspaceApi.switchTo(w.id);
                if (r.restarting) onRestart(w.name);
              })}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.workspaces.switch.confirm')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>{t('ui.workspaces.cancel')}</button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <form className="ws-confirm ws-danger" role="alertdialog" aria-label={t('ui.workspaces.delete.aria', { name: w.name })} onSubmit={(e) => { e.preventDefault(); void run(() => workspaceApi.remove(w.id, draft)); }}>
          <div>{t('ui.workspaces.delete.text', { name: w.name })}</div>
          <input className="text-input" aria-label={t('ui.workspaces.delete.inputAria')} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <div className="ws-actions">
            <button type="submit" className="btn btn-red" disabled={busy || draft.trim() !== w.name}>{t('ui.workspaces.delete.confirm')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>{t('ui.workspaces.cancel')}</button>
          </div>
        </form>
      )}
    </li>
  );
}

// Applied on the spot, no Salvar needed: the registry is not part of the settings form.
export function WorkspacesSection() {
  const t = useT();
  const view = useWorkspaces();
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      publishWorkspaces(await workspaceApi.create(name, copy));
      setName('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel ws" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.workspaces.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          {t('ui.workspaces.hint')}
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      {!view ? (
        <span className="spinner" aria-label={t('ui.workspaces.loading')} />
      ) : (
        <ul className="ws-list">
          {view.list.map((w) => (
            <Item key={w.id} w={w} running={w.id === view.running} current={w.id === view.current} onError={setError} onRestart={setRestarting} onlyOne={view.list.length < 2} />
          ))}
        </ul>
      )}
      <form className="ws-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div style={{ fontWeight: 600 }}>{t('ui.workspaces.new.title')}</div>
        <input className="text-input" aria-label={t('ui.workspaces.new.nameAria')} placeholder={t('ui.workspaces.new.namePlaceholder')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label className="ws-copy">
          <input type="checkbox" checked={copy} onChange={() => setCopy(!copy)} />
          <span>{tNodes('ui.workspaces.new.copy', { note: <span className="small muted">{t('ui.workspaces.new.copyNote')}</span> })}</span>
        </label>
        <div>
          <button type="submit" className="btn btn-dark" disabled={busy || !name.trim()}>{t('ui.workspaces.new.create')}</button>
        </div>
      </form>
      {restarting && <RestartOverlay name={restarting} />}
    </section>
  );
}
