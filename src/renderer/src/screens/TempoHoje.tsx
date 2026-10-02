import { useEffect, useState } from 'react';
import type { TempoDay, TempoKind } from '../../../shared/tempo';
import { api, errorText } from '../api';
import { tempoSegments } from '../dashboard';
import { useT } from '../i18n';
import { ChevronIcon } from './dashIcons';

function hm(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`; // i18n-ignore
}

const KIND_LABEL: Record<TempoKind, string> = {
  'pre-daily': 'ui.today.tempo.preDaily',
  desbloqueio: 'ui.today.tempo.unblock',
  gate: 'ui.today.tempo.gate',
  qa: 'ui.today.tempo.qa',
  retro: 'ui.today.tempo.retro',
  daily: 'ui.today.tempo.daily',
};

// "Tempo de hoje por issue": the blocks come from the files the app already keeps and are written for clockify-log.
export function TempoHoje({ refreshKey, colorFor }: { refreshKey: unknown; colorFor: (issue: string | null) => string | undefined }) {
  const t = useT();
  const [day, setDay] = useState<TempoDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => api.invoke<TempoDay>('tempo:day').then((d) => { setDay(d); setError(null); }, (e) => setError(errorText(e)));
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [refreshKey]);

  if (error) return <div className="error">{t('ui.today.tempo.error', { error })}</div>;
  if (!day || !day.issues.length) return null;

  const copy = async () => {
    await api.copy(day.file);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="dash-card tempo" aria-labelledby="tempo-h">
      <h2 id="tempo-h" className="dash-h tempo-h">
        <button type="button" className="tempo-toggle" aria-expanded={open} aria-controls="tempo-detail" onClick={() => setOpen((v) => !v)}>
          <span>{t('ui.today.tempo.title')}</span>
          <strong className="tempo-total">{hm(day.totalMinutes)}</strong>
          <span className={`chev ${open ? 'open' : ''}`}><ChevronIcon /></span>
        </button>
      </h2>
      <div className="tempo-bar" aria-hidden="true">
        {tempoSegments(day.issues).map((s) => (
          <span key={s.issue ?? 'sem'} style={{ flexBasis: `${s.pct}%`, background: colorFor(s.issue) ?? 'var(--faint)' }} />
        ))}
      </div>
      {open && (
        <div id="tempo-detail" className="tempo-detail">
          {day.issues.map((i) => (
            <div key={i.issue ?? 'sem'} className="tempo-row">
              <span className="tempo-dot" style={{ background: colorFor(i.issue) ?? 'var(--faint)' }} aria-hidden="true" />
              <span className="mono small muted tempo-iid">{i.issue ?? '—'}</span>
              <span className="tempo-title">{i.title}</span>
              <span className="tempo-min">{hm(i.minutes)}</span>
              <span className="small faint tempo-by">
                {(Object.entries(i.byCeremony) as [TempoKind, number][]).map(([k, m]) => `${t(KIND_LABEL[k])} ${m}`).join(' · ')}
              </span>
            </div>
          ))}
          <p className="small faint">{t('ui.today.tempo.note')}</p>
          <button type="button" className="btn" title={day.file} onClick={() => void copy()}>
            {copied ? t('ui.today.tempo.copied') : t('ui.today.tempo.copy')}
          </button>
        </div>
      )}
    </section>
  );
}
