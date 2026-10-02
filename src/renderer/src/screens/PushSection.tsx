import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../api';
import { tNodes, useT } from '../i18n';
import { isWeb } from '../platform';
import { disablePush, enablePush, pushStatus, pushSupport, sendTestPush } from '../pushClient';
import '../web.css';

type View = { subscribed: boolean; notificationsOn: boolean; permission: NotificationPermission };

// Browser build only: opt-in to notifications on this phone or computer. The permission prompt only ever follows a tap.
export function PushSection() {
  const t = useT();
  const support = pushSupport();
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<'enable' | 'disable' | 'test' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (support !== 'ok' || !isWeb()) return;
    try {
      const s = await pushStatus();
      setView({ subscribed: s.subscribed, notificationsOn: s.notificationsOn, permission: Notification.permission });
    } catch (e) {
      setError(errorText(e));
    }
  }, [support]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isWeb()) return null;

  const run = (kind: 'enable' | 'disable' | 'test', fn: () => Promise<string | void>) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    fn().then(
      (m) => {
        if (m) setMessage(m);
        setBusy(null);
        void refresh();
      },
      (e) => {
        setError(errorText(e));
        setBusy(null);
        void refresh();
      },
    );
  };

  // enablePush starts inside the click handler, so the permission prompt counts as a user gesture.
  const enable = () =>
    run('enable', async () => {
      const permission = await enablePush();
      return permission === 'granted' ? t('ui.push.msg.granted') : permission === 'denied' ? t('ui.push.msg.denied') : t('ui.push.msg.dismissed');
    });

  return (
    <section className="panel web-access" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.push.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          {t('ui.push.hint')}
        </p>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="small" role="status" style={{ fontWeight: 600 }}>{message}</div>}

      {support === 'ios-install' && (
        <div className="web-code-box" role="note">
          <strong>{t('ui.push.ios.title')}</strong>
          <span className="small">
            {t('ui.push.ios.hint')}
          </span>
        </div>
      )}
      {support === 'unsupported' && <p className="small muted">{t('ui.push.unsupported')}</p>}

      {support === 'ok' && view && (
        <>
          <p className="small">
            {tNodes(
              'ui.push.state',
              { value: <strong>{view.subscribed ? t('ui.push.state.on') : view.permission === 'denied' ? t('ui.push.state.blocked') : t('ui.push.state.off')}</strong> },
              { extra: view.subscribed && !view.notificationsOn ? t('ui.push.state.muted') : '' },
            )}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {!view.subscribed && (
              <button type="button" className="btn btn-dark" disabled={busy !== null || view.permission === 'denied'} onClick={enable}>
                {busy === 'enable' ? <span className="spinner" /> : null} {t('ui.push.enable')}
              </button>
            )}
            {view.subscribed && (
              <>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => run('test', async () => { await sendTestPush(); return t('ui.push.msg.testSent'); })}>
                  {busy === 'test' ? <span className="spinner" /> : null} {t('ui.push.sendTest')}
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => run('disable', async () => { await disablePush(); return t('ui.push.msg.disabled'); })}>
                  {busy === 'disable' ? <span className="spinner" /> : null} {t('ui.push.disable')}
                </button>
              </>
            )}
          </div>
          {view.permission === 'denied' && !view.subscribed && <p className="small muted">{t('ui.push.deniedHint')}</p>}
        </>
      )}
      {support === 'ok' && !view && !error && <div className="row" role="status"><span className="spinner" aria-hidden="true" /> <span className="small muted">{t('ui.push.checking')}</span></div>}
    </section>
  );
}
