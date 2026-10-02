import { useEffect, useState } from 'react';
import type { WorkspaceInfo } from '../../../shared/workspaces';
import { errorText } from '../api';
import { isWeb } from '../platform';
import { publishWorkspaces, useWorkspaces, workspaceApi } from '../workspaceApi';

const day = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// The window closes and opens again by itself; a browser waits for the server to come back and reloads.
export function RestartOverlay({ name }: { name: string }) {
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
        <div style={{ fontWeight: 600 }}>O app vai reiniciar</div>
        <div className="small muted">Abrindo o workspace «{name}»{isWeb() ? '. Esta página recarrega sozinha quando ele voltar.' : '.'}</div>
      </div>
    </div>
  );
}

function Item({ w, running, current, onError, onRestart, onlyOne }: { w: WorkspaceInfo; running: boolean; current: boolean; onError: (m: string | null) => void; onRestart: (name: string) => void; onlyOne: boolean }) {
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
          {running && <span className="badge badge-now">Em uso</span>}
          {!running && current && <span className="badge badge-quiet">Abre ao reiniciar</span>}
          {w.test && <span className="badge badge-block">Testes</span>}
        </div>
        <div className="small muted">Criado em {day(w.createdAt)}</div>
      </div>

      {!web && (
        <label className="ws-flag">
          <input type="checkbox" checked={w.test} disabled={busy} onChange={() => void run(() => workspaceApi.setTest(w.id, !w.test))} />
          <span>
            <span style={{ fontWeight: 600 }}>Workspace de testes</span>
            <span className="small muted" style={{ display: 'block' }}>Nada sai da máquina daqui: sem escrita no GitLab, no Plan das specs nem nas notas de cartão.</span>
          </span>
        </label>
      )}

      {mode === null && (
        <div className="ws-actions">
          {!current && <button type="button" className="btn btn-dark" onClick={() => open('switch')}>Usar este</button>}
          <button type="button" className="btn" onClick={() => open('rename')}>Renomear</button>
          {!web && !running && !current && !onlyOne && <button type="button" className="btn" onClick={() => open('delete')}>Excluir</button>}
        </div>
      )}

      {mode === 'rename' && (
        <form className="ws-form" onSubmit={(e) => { e.preventDefault(); void run(() => workspaceApi.rename(w.id, draft)); }}>
          <input className="text-input" aria-label="Novo nome" value={draft} maxLength={60} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <div className="ws-actions">
            <button type="submit" className="btn btn-dark" disabled={busy || !draft.trim()}>Salvar nome</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {mode === 'switch' && (
        <div className="ws-confirm" role="alertdialog" aria-label={`Usar o workspace ${w.name}`}>
          <div>Usar «{w.name}»? O app vai reiniciar e abrir esse workspace. Execuções em andamento (agentes, voz) são interrompidas.</div>
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
              {busy ? <span className="spinner" aria-hidden="true" /> : null} Reiniciar e usar
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <form className="ws-confirm ws-danger" role="alertdialog" aria-label={`Excluir o workspace ${w.name}`} onSubmit={(e) => { e.preventDefault(); void run(() => workspaceApi.remove(w.id, draft)); }}>
          <div>
            Excluir «{w.name}»? A pasta vai para a lixeira, em workspaces/.trash dentro da pasta de dados do app: nada é apagado de vez. Digite o nome para confirmar.
          </div>
          <input className="text-input" aria-label="Digite o nome do workspace" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <div className="ws-actions">
            <button type="submit" className="btn btn-red" disabled={busy || draft.trim() !== w.name}>Mover para a lixeira</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
          </div>
        </form>
      )}
    </li>
  );
}

// Applied on the spot, no Salvar needed: the registry is not part of the settings form.
export function WorkspacesSection() {
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
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Workspaces</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Cada workspace tem o seu histórico, as suas ações e as suas configurações. Aparelhos pareados, acesso pelo navegador e glossário valem para todos.
          Trocar reinicia o app.
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      {!view ? (
        <span className="spinner" aria-label="Carregando" />
      ) : (
        <ul className="ws-list">
          {view.list.map((w) => (
            <Item key={w.id} w={w} running={w.id === view.running} current={w.id === view.current} onError={setError} onRestart={setRestarting} onlyOne={view.list.length < 2} />
          ))}
        </ul>
      )}
      <form className="ws-new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div style={{ fontWeight: 600 }}>Novo workspace</div>
        <input className="text-input" aria-label="Nome do novo workspace" placeholder="Nome, por exemplo Principal" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label className="ws-copy">
          <input type="checkbox" checked={copy} onChange={() => setCopy(!copy)} />
          <span>Copiar as configurações do atual <span className="small muted">(nunca o histórico)</span></span>
        </label>
        <div>
          <button type="submit" className="btn btn-dark" disabled={busy || !name.trim()}>Criar workspace</button>
        </div>
      </form>
      {restarting && <RestartOverlay name={restarting} />}
    </section>
  );
}
