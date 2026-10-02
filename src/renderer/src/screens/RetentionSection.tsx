import { useState } from 'react';
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, type RetentionPreview } from '../../../shared/retention';
import type { Settings } from '../../../shared/settings';
import { errorText, plural } from '../api';
import { retentionApi } from '../retentionApi';

const SHOWN = 8;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RetentionSection({ value, onChange }: { value: Settings['retention']; onChange: (v: Settings['retention']) => void }) {
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setConfirming(false);
    setMessage(null);
  };

  const look = async () => {
    setBusy(true);
    setError(null);
    reset();
    try {
      setPreview(await retentionApi.preview(value.days));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await retentionApi.apply(preview.days, preview.fingerprint);
      setPreview(null);
      setConfirming(false);
      setMessage(`Apagados ${plural(r.deleted, 'arquivo', 'arquivos')} (${size(r.bytes)}).${r.failed.length ? ` Não consegui apagar ${r.failed.length}: ${r.failed[0].name} (${r.failed[0].error}).` : ''}`);
    } catch (e) {
      setError(errorText(e));
      setPreview(null);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Retenção de dados</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Apaga o que o app guardou e já passou do prazo: sessões dos agentes, histórico, gates, passagens para o QA, retros e reentradas.
          Atas em .md e as suas sessões do Claude Code nunca são apagadas.
        </p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={value.enabled} onChange={() => { reset(); onChange({ ...value, enabled: !value.enabled }); }} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>Apagar sozinho, uma vez por dia</span>
          <span className="small muted">Desligado por padrão. Ligado, o app apaga o que a prévia mostraria, sem perguntar.</span>
        </span>
      </label>
      <div className="settings-row">
        <label htmlFor="ret-days" style={{ fontWeight: 600 }}>Prazo</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="ret-days"
            type="number"
            min={RETENTION_MIN_DAYS}
            max={RETENTION_MAX_DAYS}
            className="text-input"
            style={{ maxWidth: 90 }}
            value={value.days}
            onChange={(e) => { reset(); onChange({ ...value, days: Number(e.target.value) }); }}
          />
          <span className="small muted">dias (de {RETENTION_MIN_DAYS} a {RETENTION_MAX_DAYS}), contados da última alteração</span>
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy && !confirming ? <span className="spinner" /> : null} Ver o que seria apagado
        </button>
        {preview && preview.count > 0 && !confirming && (
          <button type="button" className="btn btn-red" disabled={busy} onClick={() => setConfirming(true)}>Apagar agora</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="small muted">{message}</div>}
      {preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {preview.count === 0 ? (
            <div className="small muted">Nada passou do prazo de {preview.days} dias. Sessões fora do app, que o filtro ignora: {preview.untouchedSessions}.</div>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>
                {plural(preview.count, 'arquivo seria apagado', 'arquivos seriam apagados')} · {size(preview.bytes)}
              </div>
              {preview.groups.map((g) => {
                const items = preview.items.filter((i) => i.kind === g.kind);
                const expanded = open === g.kind;
                return (
                  <div key={g.kind} style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
                    <button type="button" className="btn" style={{ minHeight: 36, width: '100%', justifyContent: 'space-between' }} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : g.kind)}>
                      <span>{g.label}</span>
                      <span className="small muted">{g.count} · {size(g.bytes)}</span>
                    </button>
                    {expanded && (
                      <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                        {items.slice(0, SHOWN).map((i) => (
                          <li key={i.name}><span style={{ fontFamily: 'var(--mono)' }}>{i.name.slice(0, 13)}</span>: {i.reason}</li>
                        ))}
                        {items.length > SHOWN && <li>e mais {items.length - SHOWN}</li>}
                      </ul>
                    )}
                  </div>
                );
              })}
              <div className="small muted">Sessões fora do app, que o filtro ignora: {preview.untouchedSessions}.</div>
            </>
          )}
          {confirming && (
            <div className="error" role="alertdialog" aria-label="Confirmar a exclusão" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 600 }}>
                Apagar {plural(preview.count, 'arquivo', 'arquivos')} ({size(preview.bytes)}) de vez? Não há como desfazer.
              </div>
              <div className="row">
                <button type="button" className="btn btn-red" disabled={busy} onClick={() => void wipe()}>
                  {busy ? <span className="spinner" /> : null} Sim, apagar
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
