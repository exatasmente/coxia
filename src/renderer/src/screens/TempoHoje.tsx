import { useEffect, useState } from 'react';
import type { TempoDay, TempoKind } from '../../../shared/tempo';
import { TEMPO_LABEL } from '../../../shared/tempo';
import { api, errorText } from '../api';

function hm(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

// "Tempo de hoje por issue": the blocks come from the files the app already keeps and are written for clockify-log.
export function TempoHoje({ refreshKey }: { refreshKey: unknown }) {
  const [day, setDay] = useState<TempoDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () => api.invoke<TempoDay>('tempo:day').then((d) => { setDay(d); setError(null); }, (e) => setError(errorText(e)));
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [refreshKey]);

  if (error) return <div className="error">Não consegui somar o tempo de hoje: {error}</div>;
  if (!day || !day.issues.length) return null;

  const copy = async () => {
    await api.copy(day.file);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="panel" style={{ padding: '16px 20px', gap: 10 }}>
      <div className="row spread">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Tempo de hoje por issue · {hm(day.totalMinutes)}</h2>
          <p className="small faint" style={{ marginTop: 2 }}>Medido nas cerimônias do app; sem sobreposição, pronto para o clockify-log.</p>
        </div>
        <button type="button" className="btn" style={{ minHeight: 34 }} title={day.file} onClick={() => void copy()}>
          {copied ? 'Caminho copiado' : 'Copiar caminho do arquivo'}
        </button>
      </div>
      {day.issues.map((i) => (
        <div key={i.issue ?? 'sem'} className="row" style={{ gap: 12, flexWrap: 'nowrap', padding: '6px 0', borderTop: '1px solid var(--line-2)' }}>
          <span className="mono small muted" style={{ flex: '0 0 64px' }}>{i.issue ?? '—'}</span>
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
          <span className="small faint" style={{ flex: '0 1 auto' }}>
            {(Object.entries(i.byCeremony) as [TempoKind, number][]).map(([k, m]) => `${TEMPO_LABEL[k]} ${m}`).join(' · ')}
          </span>
          <span style={{ flex: '0 0 84px', textAlign: 'right', fontWeight: 600 }}>{hm(i.minutes)}</span>
        </div>
      ))}
    </section>
  );
}
