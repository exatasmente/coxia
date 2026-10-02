import { useEffect, useState } from 'react';
import { buildState, type UpdateInfo } from '../../../shared/update';
import { errorText, plural } from '../api';
import { isWeb } from '../platform';
import { updateApi } from '../updateApi';
import '../update.css';

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function Latest({ info }: { info: UpdateInfo }) {
  const l = info.latest;
  if (info.latestError) return <span className="small muted">{info.latestError}</span>;
  if (!l) return <span className="small muted">Consultando…</span>;
  const state = buildState(info.build.commit, l);
  return (
    <>
      <code>{l.commit}</code> <span className="muted">{when(l.date)}</span>{' '}
      {state === 'current' && <span className="badge badge-quiet">Em dia</span>}
      {state === 'behind' && <span className="badge badge-now">{l.behind ? plural(l.behind, 'commit novo', 'commits novos') : 'Há mudanças'}</span>}
      <span className="upd-subject">{l.subject}</span>
    </>
  );
}

// Desktop only: update.sh rebuilds from the source tree, quits this app, installs and opens the new build.
export function UpdateSection() {
  const web = isWeb();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [mode, setMode] = useState<'confirm' | 'dev' | 'started' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (web) return;
    updateApi.info().then(setInfo, (e) => setError(errorText(e)));
  }, [web]);

  if (web) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateApi.run();
      setMode('started');
    } catch (e) {
      setError(errorText(e));
      setMode(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel upd" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Atualizar o app</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Recompila a partir do código em {info?.sourceDir ?? '~/projects/cerimonias'}, fecha o app, instala a nova versão e abre de novo.
        </p>
      </div>
      {error && <div className="error upd-error">{error}</div>}
      {!info ? (
        !error && <span className="spinner" aria-label="Carregando" />
      ) : (
        <dl className="upd-facts">
          <dt>Instalada</dt>
          <dd>
            {info.build.version} · <code>{info.build.commit}</code>
            {info.build.builtAt && <span className="muted"> · compilada em {when(info.build.builtAt)}</span>}
          </dd>
          <dt>Última da main</dt>
          <dd><Latest info={info} /></dd>
          <dt>Log</dt>
          <dd><code className="upd-path">{info.logPath}</code></dd>
        </dl>
      )}

      {mode === null && (
        <div>
          <button type="button" className="btn btn-dark" disabled={!info} onClick={() => setMode(info?.packaged ? 'confirm' : 'dev')}>Atualizar agora</button>
        </div>
      )}

      {mode === 'dev' && (
        <div className="ws-confirm" role="status">
          <div>Isto só funciona no app instalado. Aqui, em desenvolvimento, rode <code>scripts/update.sh</code> num terminal.</div>
          <div className="ws-actions"><button type="button" className="btn" onClick={() => setMode(null)}>Entendi</button></div>
        </div>
      )}

      {mode === 'confirm' && (
        <div className="ws-confirm" role="alertdialog" aria-label="Atualizar o app">
          <div>
            A compilação leva alguns minutos. Quando termina, o app fecha e abre sozinho na versão nova. A cerimônia do dia e as ações ficam salvas; execuções em andamento (agentes, voz) são interrompidas.
          </div>
          <div className="ws-actions">
            <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void start()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null} Atualizar e reiniciar
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {mode === 'started' && info && (
        <div className="ws-confirm" role="status" aria-live="polite">
          <div>
            <span className="spinner" aria-hidden="true" /> Atualizando. O app continua aberto durante a compilação e fecha sozinho no fim; acompanhe em <code className="upd-path">{info.logPath}</code>.
          </div>
        </div>
      )}
    </section>
  );
}
