import { useEffect, useMemo, useState } from 'react';
import type { AuditEntry } from '../../../shared/auditoria';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { BackIcon } from './icons';

const KIND: Record<AuditEntry['kind'], string> = {
  gitlab: 'GitLab',
  github: 'GitHub',
  bitbucket: 'Bitbucket',
  graphql: 'GraphQL',
  sync: 'Sincronização',
  publish: 'Publicação',
  'note-edit': 'Edição de nota',
  push: 'Push de branch',
  minutes: 'Atas',
};

function Row({ e }: { e: AuditEntry }) {
  const fields = Object.entries(e.fields);
  return (
    <section className="panel" style={{ padding: 16, gap: 8, borderColor: e.ok ? undefined : 'var(--red-ink)' }}>
      <div className="row" style={{ gap: 10 }}>
        <span className={`badge ${e.ok ? 'badge-now' : 'badge-block'}`}>{e.ok ? 'ok' : 'erro'}{e.code ? ` ${e.code}` : ''}</span>
        <span className="badge badge-quiet">{KIND[e.kind]}</span>
        {e.issue > 0 && <span className="mono small">#{e.issue}</span>}
        <span className="faint">{new Date(e.at).toLocaleString('pt-BR')}</span>
        <span className="faint" style={{ marginLeft: 'auto' }}>{e.origin.kind}{e.origin.summary ? ` · ${e.origin.summary}` : ''}</span>
      </div>
      <div className="mono small" style={{ wordBreak: 'break-all' }}>{e.target} <span className="faint">(via {e.via})</span></div>
      {fields.length > 0 && (
        <div className="mono small muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {fields.map(([k, v]) => `${k} = ${v}`).join('\n')}
        </div>
      )}
      <div className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: e.ok ? undefined : 'var(--red-ink)' }}>{e.result}</div>
    </section>
  );
}

export function Auditoria({ go }: { go: (s: Screen) => void }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState('');

  const load = () => api.invoke<AuditEntry[]>('auditoria:list').then(setRows, (e) => setError(errorText(e)));
  useEffect(() => void load(), []);

  const shown = useMemo(() => {
    const n = issue.replace(/\D/g, '');
    return (rows ?? []).filter((r) => !n || String(r.issue).includes(n));
  }, [rows, issue]);

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 16 }}>
        <header className="row" style={{ gap: 14 }}>
          <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>Auditoria das escritas</h1>
          <span className="faint">{rows ? `${shown.length} de ${rows.length}` : ''}</span>
          <input
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Filtrar por issue (ex.: 15499)"
            aria-label="Filtrar por issue"
            style={{ marginLeft: 'auto', minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--field-line)', minWidth: 220 }}
          />
          <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => void load()}>Atualizar</button>
        </header>
        {error && <div className="error">{error}</div>}
        {!rows && !error && <div className="row faint"><span className="spinner" /> Lendo o registro…</div>}
        {rows && !shown.length && <p className="small faint">{rows.length ? 'Nenhuma escrita para essa issue.' : 'Nenhuma escrita executada ainda.'}</p>}
        {shown.map((e, i) => <Row key={`${e.at}-${i}`} e={e} />)}
      </div>
    </div>
  );
}
