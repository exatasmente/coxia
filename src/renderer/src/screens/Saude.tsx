import { useEffect, useState } from 'react';
import type { SaudeSnapshot } from '../../../shared/saude';
import type { Screen } from '../App';
import { errorText } from '../api';
import { saudeApi } from '../saudeApi';
import { BackIcon } from './icons';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'nunca';

const secs = (ms: number | null) => (ms === null ? '–' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function Dot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? 'var(--faint)' : ok ? 'var(--teal)' : 'var(--warn)';
  return <span className="dot" style={{ background: color, flex: '0 0 auto' }} aria-label={ok === null ? 'sem dado' : ok ? 'ok' : 'com problema'} />;
}

export function Saude({ go }: { go: (s: Screen) => void }) {
  const [snap, setSnap] = useState<SaudeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void saudeApi.get().then(setSnap);
    return saudeApi.onChanged(setSnap);
  }, []);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setSnap(await saudeApi.check());
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Saúde</h1>
            {snap && <span className="faint">{snap.problems ? `${snap.problems} problema(s)` : 'Tudo certo'}</span>}
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
            {busy ? <span className="spinner" /> : null} Verificar agora
          </button>
        </header>

        {error && <div className="error">{error}</div>}
        {!snap && <div className="row faint"><span className="spinner" /> Lendo…</div>}

        {snap && (
          <>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Dependências</h2>
              {snap.deps.map((d) => (
                <div key={d.id} className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Dot ok={d.ok} />
                  <div style={{ flex: '0 0 190px', fontWeight: 500 }}>{d.label}</div>
                  <div className="small" style={{ flex: '1 1 auto', minWidth: 0, color: d.ok === false ? 'var(--amber-ink)' : 'var(--muted)' }}>{d.message}</div>
                  <div className="small faint" style={{ flex: '0 0 190px', textAlign: 'right' }}>{when(d.checkedAt)} · {secs(d.durationMs)}</div>
                </div>
              ))}
              <p className="small faint">O modelo só é chamado em “Verificar agora” (uma requisição de poucos tokens). As outras verificações rodam sozinhas a cada 30 minutos.</p>
            </section>

            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Tarefas periódicas</h2>
              {!snap.tasks.length && <p className="small faint">Nenhuma tarefa registrada ainda.</p>}
              {snap.tasks.map((t) => (
                <div key={t.name} className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Dot ok={t.ok} />
                  <div style={{ flex: '0 0 190px' }}>
                    <div style={{ fontWeight: 500 }}>{t.label}</div>
                    <div className="small faint">{t.everyMin ? `a cada ${t.everyMin} min` : 'sob demanda'}</div>
                  </div>
                  <div className="small" style={{ flex: '1 1 auto', minWidth: 0, color: t.ok === false ? 'var(--amber-ink)' : 'var(--muted)' }}>
                    {t.message}
                    {t.failStreak > 1 ? ` (${t.failStreak} falhas seguidas)` : ''}
                  </div>
                  <div className="small faint" style={{ flex: '0 0 190px', textAlign: 'right' }}>{when(t.lastRunAt)} · {secs(t.durationMs)}</div>
                </div>
              ))}
              <p className="small faint">Só aparecem as execuções agendadas, dentro do horário de trabalho. Três falhas seguidas da mesma tarefa geram uma notificação.</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
