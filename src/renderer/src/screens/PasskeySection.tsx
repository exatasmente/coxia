import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { intlLocale, useT } from '../i18n';
import { passkeysSupported, registerPasskey } from '../passkeyClient';
import { isWeb } from '../platform';
import '../web.css';

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
}

// Browser build only: registers a passkey for this paired device so it can administer the instance. The computer allows the registration first (Settings › Browser access).
export function PasskeySection() {
  const t = useT();
  const [list, setList] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList((await api.invoke('passkey:list')) as Passkey[]);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    if (isWeb()) void refresh();
  }, [refresh]);

  if (!isWeb()) return null;

  const register = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await registerPasskey((channel, ...args) => api.invoke(channel, ...args), t('ui.passkey.name', { device: document.title || 'web' }));
      setMessage(t('ui.passkey.registered'));
      await refresh();
    } catch (e) {
      // The browser raises NotAllowedError when the person dismisses the prompt.
      setError(e instanceof Error && (e.name === 'NotAllowedError' || e.message === 'cancelled') ? t('ui.passkey.cancelled') : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.invoke('passkey:remove', id);
      setMessage(t('ui.passkey.removed'));
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="panel web-access" style={{ padding: 20, gap: 10 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.passkey.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.passkey.hint')}</p>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="small" style={{ color: 'var(--teal-ink)' }} role="status">{message}</div>}
      {list && list.length === 0 && <p className="small muted">{t('ui.passkey.none')}</p>}
      {list?.map((p) => (
        <div key={p.id} className="web-device">
          <div>
            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{p.name}</div>
            <div className="small muted">{t('ui.passkey.created', { date: new Date(p.createdAt).toLocaleDateString(intlLocale()) })}</div>
          </div>
          <button type="button" className="btn" onClick={() => void remove(p.id)}>{t('ui.passkey.remove')}</button>
        </div>
      ))}
      {passkeysSupported() ? (
        <div className="row">
          <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void register()}>{busy ? t('ui.passkey.registering') : t('ui.passkey.register')}</button>
        </div>
      ) : (
        <p className="small muted">{t('ui.passkey.unsupported')}</p>
      )}
    </section>
  );
}
