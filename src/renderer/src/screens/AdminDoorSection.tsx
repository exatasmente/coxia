import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';

// Settings › the admin door: the opt-in of the local socket a tool on this computer uses. Desktop window only: the channels refuse a paired browser and the admin door itself.
interface AdminDoorView {
  enabled: boolean;
  listening: boolean;
  path: string;
  reason: string;
}

export function AdminDoorSection() {
  const t = useT();
  const [view, setView] = useState<AdminDoorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = isWeb();

  useEffect(() => {
    if (web) return;
    api.invoke('adminDoor:get').then((v) => setView(v as AdminDoorView), (e) => setError(errorText(e)));
  }, [web]);

  if (web) return null;

  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      setView((await api.invoke('adminDoor:set', enabled)) as AdminDoorView);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="panel" aria-labelledby="admin-door-title">
      <div>
        <h3 id="admin-door-title" className="wz-sub">{t('ui.settings.adminDoor.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.adminDoor.hint')}</p>
      </div>
      {view && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={view.enabled} onChange={() => void toggle(!view.enabled)} />
            <span style={{ fontWeight: 600 }}>{view.enabled ? t('ui.settings.adminDoor.on') : t('ui.settings.adminDoor.off')}</span>
          </label>
          {view.enabled && <p className="small muted">{view.listening ? t('ui.settings.adminDoor.listening', { path: view.path }) : t('ui.settings.adminDoor.closed', { reason: view.reason })}</p>}
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
