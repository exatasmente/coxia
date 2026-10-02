import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../api';
import { isWeb } from '../platform';
import { disablePush, enablePush, pushStatus, pushSupport, sendTestPush } from '../pushClient';
import '../web.css';

type View = { subscribed: boolean; notificationsOn: boolean; permission: NotificationPermission };

// Browser build only: opt-in to notifications on this phone or computer. The permission prompt only ever follows a tap.
export function PushSection() {
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
      return permission === 'granted' ? 'Notificações ativadas neste aparelho.' : permission === 'denied' ? 'O navegador bloqueou as notificações deste site. Libere nas configurações do navegador e tente de novo.' : 'Você fechou o pedido sem escolher. Toque em Ativar de novo quando quiser.';
    });

  return (
    <section className="panel web-access" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Notificações neste aparelho</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Os mesmos avisos que o app do computador mostra (bloqueios, mudança de status, hora da pré-daily), mesmo com o app fechado.
        </p>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="small" role="status" style={{ fontWeight: 600 }}>{message}</div>}

      {support === 'ios-install' && (
        <div className="web-code-box" role="note">
          <strong>No iPhone, instale o app primeiro.</strong>
          <span className="small">
            Toque em Compartilhar e depois em Adicionar à Tela de Início, abra o app pelo ícone novo e volte aqui. As notificações exigem iOS 16.4 ou mais novo.
          </span>
        </div>
      )}
      {support === 'unsupported' && <p className="small muted">Este navegador não oferece notificações push. No iPhone, só funciona com o app adicionado à Tela de Início (iOS 16.4 ou mais novo).</p>}

      {support === 'ok' && view && (
        <>
          <p className="small">
            Estado:{' '}
            <strong>
              {view.subscribed ? 'ativadas' : view.permission === 'denied' ? 'bloqueadas pelo navegador' : 'desativadas'}
            </strong>
            {view.subscribed && !view.notificationsOn ? ' · desligadas em Configurações › Notificações do computador (só o teste chega)' : ''}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {!view.subscribed && (
              <button type="button" className="btn btn-dark" disabled={busy !== null || view.permission === 'denied'} onClick={enable}>
                {busy === 'enable' ? <span className="spinner" /> : null} Ativar notificações neste aparelho
              </button>
            )}
            {view.subscribed && (
              <>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => run('test', async () => { await sendTestPush(); return 'Teste enviado. Ele chega em alguns segundos.'; })}>
                  {busy === 'test' ? <span className="spinner" /> : null} Enviar notificação de teste
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => run('disable', async () => { await disablePush(); return 'Notificações desativadas neste aparelho.'; })}>
                  {busy === 'disable' ? <span className="spinner" /> : null} Desativar
                </button>
              </>
            )}
          </div>
          {view.permission === 'denied' && !view.subscribed && <p className="small muted">O navegador bloqueou as notificações deste site. Libere em Configurações do site e volte aqui.</p>}
        </>
      )}
      {support === 'ok' && !view && !error && <div className="row" role="status"><span className="spinner" aria-hidden="true" /> <span className="small muted">Conferindo…</span></div>}
    </section>
  );
}
