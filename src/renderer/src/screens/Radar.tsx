import { useEffect, useState } from 'react';
import type { BranchHealth, RadarFinding, RadarKind, RadarResult, RadarSide } from '../../../shared/radar';
import type { Screen } from '../App';
import { api, errorText, moduleEvents } from '../api';
import { intlLocale, useT } from '../i18n';
import { BackIcon } from './icons';
import { jobs, useJobs } from '../useJobs';
import { describeBranch, refreshHealth, useWorktreeHealth } from './radarSlots';

const KIND: Record<RadarKind, { label: string; badge: string }> = {
  'same-fix': { label: 'ui.radar.kind.sameFix', badge: 'badge-block' },
  dependency: { label: 'ui.radar.kind.dependency', badge: 'badge-ask' },
  file: { label: 'ui.radar.kind.file', badge: 'badge-ask' },
  scope: { label: 'ui.radar.kind.scope', badge: 'badge-quiet' },
};

function Side({ s }: { s: RadarSide }) {
  const t = useT();
  return (
    <div style={{ minWidth: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="mono small">#{s.iid}</span>
        <a className="mono small muted" href={s.url} target="_blank" rel="noreferrer">{s.mr}</a>
        <span className="badge badge-quiet">{s.stage ?? t('today.noStage')}</span>
      </div>
      <div className="small" style={{ marginTop: 2 }}>{s.title}</div>
      <div className="faint mono">{s.branch} → {s.target}</div>
    </div>
  );
}

function Finding({ f }: { f: RadarFinding }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const isNew = Date.now() - new Date(f.firstSeen).getTime() < 24 * 3600_000;
  return (
    <section className="panel" style={{ padding: 18, gap: 12, borderColor: f.kind === 'same-fix' ? 'var(--amber-line)' : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`badge ${KIND[f.kind].badge}`}>{t(KIND[f.kind].label)}</span>
        {f.silent && <span className="badge badge-e3">{t('ui.radar.silentMerge')}</span>}
        {isNew && <span className="badge badge-now">{t('ui.radar.new')}</span>}
        <span className="faint">{t('ui.radar.since', { date: new Date(f.firstSeen).toLocaleDateString(intlLocale()) })}</span>
      </div>
      <div className="quad" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }} /* i18n-ignore */>
        <div>
          {f.kind === 'dependency' && <div className="section-title" style={{ marginBottom: 4 }}>{t('ui.radar.alreadyAhead')}</div>}
          <Side s={f.a} />
        </div>
        <div>
          {f.kind === 'dependency' && <div className="section-title" style={{ marginBottom: 4 }}>{t('ui.radar.landsLater')}</div>}
          <Side s={f.b} />
        </div>
      </div>
      <p className="small" style={{ lineHeight: 1.5 }}>{f.summary.replace(/`/g, '')}</p>
      {(f.files.length > 0 || f.scopes.length > 0) && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            {f.files.length ? t('ui.radar.sharedFiles', { count: f.files.length }) : t('ui.radar.sharedModules', { count: f.scopes.length })}
          </summary>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
            {[...f.files, ...f.scopes.map((s) => t('ui.radar.module', { name: s }))].join('\n')}
          </pre>
          {f.regions.length > 0 && (
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
              {f.regions.map((r) => `${r.file}\n  ${t('ui.radar.region', { a: f.a.iid, a1: r.a[0], a2: r.a[1], b: f.b.iid, b1: r.b[0], b2: r.b[1], distance: r.distance })}`).join('\n')}
            </pre>
          )}
        </details>
      )}
      <div className="item" style={{ background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
        <div className="section-title">{t('ui.radar.whatToDo')}</div>
        <div className="small" style={{ color: 'var(--teal-ink)', lineHeight: 1.5 }}>{f.recommendation}</div>
        {f.identicalLines >= 3 && f.kind === 'same-fix' && (
          <div className="small" style={{ color: 'var(--teal-ink)' }}>{t('ui.radar.identicalLines', { count: f.identicalLines })}</div>
        )}
      </div>
      {f.collideCommand && (
        <div className="row" style={{ gap: 8 }}>
          <code className="mono small" style={{ flex: '1 1 400px', wordBreak: 'break-all' }}>{f.collideCommand}</code>
          <button
            type="button"
            className="btn"
            onClick={() => void api.copy(f.collideCommand ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          >
            {copied ? t('ui.radar.copied') : t('ui.radar.copyCommand')}
          </button>
        </div>
      )}
    </section>
  );
}

function BranchRow({ b }: { b: BranchHealth }) {
  const t = useT();
  return (
    <div className="item" style={{ gap: 2 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="mono small">{b.repo} · {b.branch}</span>
        {b.unpushed > 0 && <span className="badge badge-block">{t('ui.radar.unpushedCount', { count: b.unpushed })}</span>}
        {b.dirty > 0 && <span className="badge badge-block">{t('ui.radar.changeCount', { count: b.dirty })}</span>}
        {b.conventionNote && <span className="badge badge-ask">{t('ui.radar.offConventionBadge')}</span>}
      </div>
      <div className="faint">{describeBranch(b).replace(`${b.repo} · ${b.branch}: `, '')}</div>
      {b.worktree && <div className="faint mono">{b.worktree}</div>}
      {b.dirtyFiles.length > 0 && (
        <details>
          <summary className="faint" style={{ cursor: 'pointer' }}>{t('ui.radar.files')}</summary>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{b.dirtyFiles.join('\n')}</pre>
        </details>
      )}
      <div className="faint">{t('ui.radar.mrGoesTo', { base: b.base })}</div>
    </div>
  );
}

export function Radar({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [result, setResult] = useState<RadarResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const health = useWorktreeHealth();

  useEffect(() => {
    void api.invoke<RadarResult | null>('radar:latest').then((r) => setResult((prev) => prev ?? r));
    const on = (e: Event) => setResult((e as CustomEvent<RadarResult>).detail);
    moduleEvents.addEventListener('radar', on);
    return () => moduleEvents.removeEventListener('radar', on);
  }, []);

  const running = useJobs<RadarResult>('radar:', {
    done: (r) => setResult(r),
    failed: (message) => setError(message),
  });
  const busy = running.length > 0;

  const run = () => {
    setError(null);
    jobs.launch('radar:run', { label: t('ui.radar.job.label'), busy: t('ui.radar.job.busy'), screen: { name: 'radar' } }, async () => {
      const [r] = await Promise.all([api.invoke<RadarResult>('radar:run'), refreshHealth()]);
      return r;
    });
  };

  const issues = Object.entries(health?.byIssue ?? {}).sort(([a], [b]) => Number(b) - Number(a));

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1100, gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.nav.backToday')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.radar.title')}</h1>
          </div>
          <div className="row">
            {result && (
              <span className="small muted">
                {t('ui.radar.checked', { time: new Date(result.checkedAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }), count: result.mrsChecked })}
              </span>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => run()}>
              {busy ? <span className="spinner" /> : null} {t('ui.radar.checkNow')}
            </button>
          </div>
        </header>
        <p className="small muted">
          {t('ui.radar.intro')}
        </p>
        {error && <div className="error">{error}</div>}
        {result?.failed.length ? <div className="error">{t('ui.radar.failed', { list: result.failed.join(' · ') })}</div> : null}

        <h2 className="section-title">{t('ui.radar.collisions', { count: result?.findings.length ?? 0 })}</h2>
        {!result && !busy && <p className="small faint">{t('ui.radar.notRun')}</p>}
        {result && !result.findings.length && <p className="small faint">{t('ui.radar.noCollisions')}</p>}
        {result?.findings.map((f) => <Finding key={f.key} f={f} />)}

        <h2 className="section-title" style={{ marginTop: 12 }}>{t('ui.radar.worktrees', { count: issues.length })}</h2>
        <p className="small muted">
          {t('ui.radar.worktreesNote')}
        </p>
        {!health && <p className="small faint">{t('ui.radar.worktreesLoading')}</p>}
        {issues.map(([iid, items]) => (
          <section key={iid} className="panel" style={{ padding: 16, gap: 8 }}>
            <div className="mono" style={{ fontWeight: 600 }}>#{iid}</div>
            {items.map((b) => <BranchRow key={`${b.repo}:${b.branch}:${b.worktree}`} b={b} />)}
          </section>
        ))}
        {health && health.unassigned.length > 0 && (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>{t('ui.radar.unassigned', { count: health.unassigned.length })}</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {health.unassigned.map((b) => <BranchRow key={`${b.repo}:${b.branch}:${b.worktree}`} b={b} />)}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
