import { useEffect, useState } from 'react';
import type { SaudeSnapshot } from '../../../shared/saude';
import type { Screen } from '../App';
import { errorText } from '../api';
import { intlLocale, t, useT } from '../i18n';
import { saudeApi } from '../saudeApi';
import { jobs, useJobs } from '../useJobs';
import { ErrorsSection } from './ErrorsSection';
import { BackIcon } from './icons';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : t('ui.health.never');

const secs = (ms: number | null) => (ms === null ? '–' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function Dot({ ok }: { ok: boolean | null }) {
  const t = useT();
  const color = ok === null ? 'var(--faint)' : ok ? 'var(--teal)' : 'var(--warn)';
  return <span className="dot" style={{ background: color, flex: '0 0 auto' }} aria-label={ok === null ? t('ui.health.dot.noData') : ok ? t('ui.health.dot.ok') : t('ui.health.dot.problem')} />;
}

export function Saude({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [snap, setSnap] = useState<SaudeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void saudeApi.get().then(setSnap);
    return saudeApi.onChanged(setSnap);
  }, []);

  const running = useJobs<SaudeSnapshot>('saude:', {
    done: (r) => setSnap(r),
    failed: (message) => setError(message),
  });
  const busy = running.length > 0;

  const check = () => {
    setError(null);
    jobs.launch('saude:check', { label: t('ui.health.job.label'), busy: t('ui.health.job.busy'), screen: { name: 'saude' } }, () => saudeApi.check());
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.nav.backToday')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.nav.health')}</h1>
            {snap && <span className="faint">{snap.problems ? t('ui.health.problems', { count: snap.problems }) : t('ui.health.allGood')}</span>}
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => check()}>
            {busy ? <span className="spinner" /> : null} {t('ui.health.checkNow')}
          </button>
        </header>

        {error && <div className="error">{error}</div>}
        {!snap && <div className="row faint"><span className="spinner" /> {t('ui.health.loading')}</div>}

        <ErrorsSection />

        {snap && (
          <>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.health.deps')}</h2>
              {snap.deps.map((d) => (
                <div key={d.id} className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Dot ok={d.ok} />
                  <div style={{ flex: '0 0 190px', fontWeight: 500 }}>{d.label}</div>
                  <div className="small" style={{ flex: '1 1 auto', minWidth: 0, color: d.ok === false ? 'var(--amber-ink)' : 'var(--muted)' }}>{d.message}</div>
                  <div className="small faint" style={{ flex: '0 0 190px', textAlign: 'right' }}>{when(d.checkedAt)} · {secs(d.durationMs)}</div>
                </div>
              ))}
              <p className="small faint">{t('ui.health.depsNote')}</p>
            </section>

            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.health.tasks')}</h2>
              {!snap.tasks.length && <p className="small faint">{t('ui.health.noTasks')}</p>}
              {snap.tasks.map((task) => (
                <div key={task.name} className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Dot ok={task.ok} />
                  <div style={{ flex: '0 0 190px' }}>
                    <div style={{ fontWeight: 500 }}>{task.label}</div>
                    <div className="small faint">{task.everyMin ? t('ui.health.everyMin', { count: task.everyMin }) : t('ui.health.onDemand')}</div>
                  </div>
                  <div className="small" style={{ flex: '1 1 auto', minWidth: 0, color: task.ok === false ? 'var(--amber-ink)' : 'var(--muted)' }}>
                    {task.message}
                    {task.failStreak > 1 ? ` ${t('ui.health.failStreak', { count: task.failStreak })}` : ''}
                  </div>
                  <div className="small faint" style={{ flex: '0 0 190px', textAlign: 'right' }}>{when(task.lastRunAt)} · {secs(task.durationMs)}</div>
                </div>
              ))}
              <p className="small faint">{t('ui.health.tasksNote')}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
