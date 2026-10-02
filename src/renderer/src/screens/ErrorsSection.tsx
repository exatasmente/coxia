import { useEffect, useRef, useState } from 'react';
import { errorReport, type ErrorGroup, type ErrorsView } from '../../../shared/errorlog';
import { api, errorText } from '../api';
import '../errors.css';
import { errorsApi } from '../errorsApi';
import { isWeb } from '../platform';

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Group({ g }: { g: ErrorGroup }) {
  const context = Object.entries(g.context).map(([k, v]) => `${k}=${v}`).join('  ');
  const detail = [context, g.stack].filter(Boolean).join('\n\n');
  return (
    <li className="err-item">
      <div className="err-head">
        <span className="dot" style={{ background: 'var(--warn)', flex: '0 0 auto', marginTop: 7 }} aria-hidden="true" />
        <span className="err-msg">{g.message}</span>
        <span className="badge badge-quiet" aria-label={`${g.count} ocorrência(s)`}>×{g.count}</span>
        {g.unseen && <span className="badge badge-block">novo</span>}
      </div>
      {g.hint && <div className="small err-hint">{g.hint}</div>}
      <div className="small faint err-meta">
        <span>primeiro: {when(g.firstAt)}</span>
        <span>último: {when(g.lastAt)}</span>
        <span>origem: {g.sources.join(', ')}</span>
        <span>workspace: {g.workspaces.join(', ')}</span>
      </div>
      {detail && (
        <details className="err-details">
          <summary>Detalhes</summary>
          <pre className="err-stack">{detail}</pre>
        </details>
      )}
    </li>
  );
}

export function ErrorsSection() {
  const [view, setView] = useState<ErrorsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const total = useRef<number | null>(null);

  // Opening the screen is what "sees" the errors; the list keeps the markers it came with.
  const load = () =>
    errorsApi
      .get()
      .then((v) => {
        total.current = v.total;
        setView(v);
        void errorsApi.seen().catch(() => {});
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    void load();
    return errorsApi.onChanged((s) => s.total !== total.current && void load());
  }, []);

  const copy = async () => {
    if (!view) return;
    await api.copy(errorReport(view));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clear = () =>
    errorsApi
      .clear()
      .then((v) => {
        total.current = v.total;
        setView(v);
      })
      .catch((e) => setError(errorText(e)));

  return (
    <section className="panel" style={{ padding: 20, gap: 12 }}>
      <div className="row spread">
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Erros recentes</h2>
        {view && view.groups.length > 0 && (
          <div className="err-actions">
            {!isWeb() && (
              <button type="button" className="btn" onClick={() => void copy()}>
                {copied ? 'Copiado' : 'Copiar para o Claude Code'}
              </button>
            )}
            <button type="button" className="btn" onClick={() => void clear()}>Limpar</button>
          </div>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {!view && !error && <div className="row faint"><span className="spinner" /> Lendo…</div>}
      {view && !view.groups.length && <p className="small faint">Nenhum erro registrado.</p>}
      {view && view.groups.length > 0 && (
        <ul className="err-list">
          {view.groups.map((g) => (
            <Group key={g.message} g={g} />
          ))}
        </ul>
      )}
      <p className="small faint">Erros do app, das tarefas, da voz e das telas, agrupados pela mensagem. Textos digitados, áudio e chaves nunca entram no registro.</p>
    </section>
  );
}
