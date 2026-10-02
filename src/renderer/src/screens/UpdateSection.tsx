import { useState } from 'react';
import { INTERVAL_MAX_HOURS, INTERVAL_MIN_HOURS, UPDATE_CHANNELS, UPDATE_MODE_SETTINGS, type UpdateSettings, type UpdatesStatus } from '../../../shared/updates';
import { errorText } from '../api';
import { intlLocale, useT } from '../i18n';
import { isWeb } from '../platform';
import { updateApi, useUpdatesStatus } from '../updateApi';
import '../update.css';

const INTERVALS = [1, 3, 6, 12, 24, 72, 168];

const when = (value: string | number | null): string => {
  if (value === null) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const megabytes = (bytes: number): string => `${new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;

type T = ReturnType<typeof useT>;

function Radios<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: [V, string, string?][]; onChange: (v: V) => void }) {
  return (
    <div role="group" aria-label={label} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {options.map(([v, text, hint]) => (
        <button key={v} type="button" aria-pressed={value === v} title={hint} className={`filter ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function SourceBlock({ status, t, onRun }: { status: UpdatesStatus; t: T; onRun: () => void }) {
  const s = status.source;
  const shown = s.commits.length;
  return (
    <>
      <dl className="upd-facts">
        <dt>{t('updates.installed')}</dt>
        <dd>
          {status.build.version} · <code>{status.build.commit}</code>
          {status.build.builtAt && <span className="muted"> · {t('updates.builtAt', { date: when(status.build.builtAt) })}</span>}
        </dd>
        <dt>{t('updates.source.dir')}</dt>
        <dd><code className="upd-path">{s.dir ?? '—'}</code></dd>
        <dt>{t('updates.source.head')}</dt>
        <dd>
          {s.head ? <code>{s.head}</code> : '—'}{' '}
          {s.error === null && s.ahead === 0 && <span className="badge badge-quiet">{t('updates.source.upToDate')}</span>}
          {s.error === null && (s.ahead ?? 0) > 0 && <span className="badge badge-now">{t('updates.source.ahead', { count: s.ahead ?? 0 })}</span>}
        </dd>
      </dl>
      {s.error && <div className="error upd-error">{t(`updates.source.error.${s.error}`, { detail: s.errorDetail ?? '' })}</div>}
      {s.fetchError && <div className="small muted upd-error">{t('updates.source.fetchError', { message: s.fetchError })}</div>}
      {s.remoteAhead !== null && s.remoteAhead > 0 && <p className="small muted">{t('updates.source.remoteAhead', { count: s.remoteAhead })}</p>}
      {shown > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>{t('updates.source.commits')}</div>
          <ul className="upd-commits">
            {s.commits.map((c) => (
              <li key={c.commit}>
                <code>{c.commit}</code> <span className="muted">{when(c.date)}</span>
                <span className="upd-subject">{c.subject}</span>
              </li>
            ))}
          </ul>
          {(s.ahead ?? 0) > shown && <p className="small muted">{t('updates.source.moreCommits', { count: (s.ahead ?? 0) - shown })}</p>}
        </div>
      )}
      <div>
        <button type="button" className="btn btn-dark" onClick={onRun}>{t('updates.source.run')}</button>
      </div>
    </>
  );
}

function ReleaseBlock({ status, t, restart }: { status: UpdatesStatus; t: T; restart: (force: boolean) => void }) {
  const r = status.release;
  const [confirm, setConfirm] = useState(false);
  const version = r.version ?? '';
  return (
    <>
      <dl className="upd-facts">
        <dt>{t('updates.installed')}</dt>
        <dd>
          {status.build.version} · <code>{status.build.commit}</code>
          {status.build.builtAt && <span className="muted"> · {t('updates.builtAt', { date: when(status.build.builtAt) })}</span>}
        </dd>
      </dl>
      {r.phase === 'available' && <p>{t('updates.release.available', { version })}</p>}
      {r.phase === 'downloading' && r.progress && (
        <div>
          <p>{t('updates.release.downloading', { version, percent: Math.floor(r.progress.percent), done: megabytes(r.progress.transferred), total: megabytes(r.progress.total) })}</p>
          <progress className="upd-progress" max={100} value={r.progress.percent} aria-label={t('updates.release.downloading', { version, percent: Math.floor(r.progress.percent), done: megabytes(r.progress.transferred), total: megabytes(r.progress.total) })} />
        </div>
      )}
      {r.phase === 'downloading' && !r.progress && <p>{t('updates.release.available', { version })}</p>}
      {r.phase === 'installing' && <p><span className="spinner" aria-hidden="true" /> {t('updates.release.installing', { version })}</p>}
      {r.phase === 'downloaded' && (
        <div className="ws-confirm" role="status">
          <div>{t('updates.release.downloaded', { version })} {t('updates.release.installOnQuit')}</div>
          {confirm && status.busy && <div className="small">{t('updates.release.busy')}</div>}
          <div className="ws-actions">
            {status.busy && !confirm ? (
              <button type="button" className="btn btn-dark" onClick={() => setConfirm(true)}>{t('updates.release.restart')}</button>
            ) : (
              <button type="button" className="btn btn-dark" onClick={() => restart(confirm)}>{confirm ? t('updates.release.restartAnyway') : t('updates.release.restart')}</button>
            )}
            {confirm && <button type="button" className="btn" onClick={() => setConfirm(false)}>{t('updates.release.later')}</button>}
          </div>
        </div>
      )}
      {r.notes && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>{t('updates.notes.title')}{r.releaseName ? ` · ${r.releaseName}` : ''}</div>
          <pre className="upd-notes">{r.notes}</pre>
        </div>
      )}
    </>
  );
}

// Desktop only. Which block shows depends on how the app was installed: a published build downloads its own updates; a build made from a
// source tree learns that the tree's main has commits it lacks and rebuilds it with scripts/update.sh.
export function UpdateSection() {
  const t = useT();
  const web = isWeb();
  const [status, setStatus] = useUpdatesStatus();
  const [flow, setFlow] = useState<'confirm' | 'dev' | 'started' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (web) return null;

  const run = async <V,>(fn: () => Promise<V>): Promise<V | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const save = (patch: Partial<UpdateSettings>) => {
    if (!status) return;
    void run(async () => setStatus(await updateApi.saveSettings({ ...status.settings, ...patch })));
  };
  const check = (allowDowngrade = false) => void run(async () => setStatus(await updateApi.check({ allowDowngrade })));
  const restart = (force: boolean) =>
    void run(async () => {
      const result = await updateApi.install({ force });
      if (!result.ok && result.reason === 'failed') setError(t('updates.release.failed'));
    });
  const startSource = async () => {
    const started = await run(() => updateApi.run());
    setFlow(started ? 'started' : null);
  };

  const mode = status?.mode.mode;
  const last = status ? (status.mode.mode === 'source' ? status.source.checkedAt : status.release.lastCheckAt) : null;
  const lastResult = status?.release.lastResult;

  return (
    <section id="updates" className="panel upd" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('updates.title')}</h2>
        {status && (
          <p className="small muted" style={{ marginTop: 4 }}>
            <strong>{t(`updates.mode.${status.mode.mode}`)}</strong>. {t(`updates.reason.${status.mode.reason}`)}
          </p>
        )}
        {mode === 'source' && status && <p className="small muted">{t('updates.source.explain', { dir: status.source.dir ?? '' })}</p>}
      </div>
      {error && <div className="error upd-error">{error}</div>}
      {!status ? (
        !error && <span className="spinner" aria-label={t('updates.loading')} />
      ) : (
        <>
          {status.mode.requiresSigning && <p className="small muted">{t('updates.signing')}</p>}

          {mode === 'release' && <ReleaseBlock status={status} t={t} restart={restart} />}
          {mode === 'source' && <SourceBlock status={status} t={t} onRun={() => setFlow(status.packaged ? 'confirm' : 'dev')} />}

          {(mode === 'release' || mode === 'source') && (
            <>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn" disabled={busy || status.release.phase === 'checking' || status.release.phase === 'installing'} onClick={() => check()}>
                  {busy || status.release.phase === 'checking' ? <span className="spinner" aria-hidden="true" /> : null}
                  {busy || status.release.phase === 'checking' ? t('updates.checking') : t('updates.check')}
                </button>
                <span className="small muted" aria-live="polite">
                  {t('updates.last.label')}: {last ? when(last) : t('updates.last.never')}
                  {mode === 'release' && lastResult && last ? ` · ${t(`updates.result.${lastResult}`)}` : ''}
                </span>
              </div>
              {mode === 'release' && status.release.lastResult === 'error' && status.release.error && <div className="error upd-error">{status.release.error}</div>}

              <label className="check-row">
                <input type="checkbox" checked={status.settings.auto} onChange={() => save({ auto: !status.settings.auto })} />
                <span>
                  <span style={{ fontWeight: 600, display: 'block' }}>{t('updates.auto.label')}</span>
                  <span className="small muted">{t('updates.auto.hint')}</span>
                </span>
              </label>
              {mode === 'release' && (
                <div className="upd-field">
                  <label htmlFor="upd-interval" className="small muted">{t('updates.interval.label')}</label>
                  <select
                    id="upd-interval"
                    className="text-input"
                    value={status.settings.intervalHours}
                    disabled={!status.settings.auto}
                    onChange={(e) => save({ intervalHours: Number(e.target.value) })}
                  >
                    {[...new Set([...INTERVALS, status.settings.intervalHours])]
                      .filter((h) => h >= INTERVAL_MIN_HOURS && h <= INTERVAL_MAX_HOURS)
                      .sort((a, b) => a - b)
                      .map((h) => <option key={h} value={h}>{t('updates.interval.hours', { count: h })}</option>)}
                  </select>
                </div>
              )}
              {mode === 'release' && (
                <div className="upd-field">
                  <span className="small muted">{t('updates.channel.label')}</span>
                  <Radios
                    label={t('updates.channel.label')}
                    value={status.settings.channel}
                    options={UPDATE_CHANNELS.map((c) => [c, t(`updates.channel.${c}`), t(`updates.channel.${c}.hint`)])}
                    onChange={(channel) => save({ channel })}
                  />
                  {status.canDowngrade && (
                    <div>
                      <button type="button" className="btn" disabled={busy} onClick={() => check(true)}>{t('updates.downgrade.label')}</button>
                      <p className="small muted" style={{ marginTop: 6 }}>{t('updates.downgrade.hint')}</p>
                    </div>
                  )}
                </div>
              )}
              {mode === 'source' && (
                <label className="check-row">
                  <input type="checkbox" checked={status.settings.fetchSource} onChange={() => save({ fetchSource: !status.settings.fetchSource })} />
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{t('updates.source.fetch.label')}</span>
                    <span className="small muted">{t('updates.source.fetch.hint')}</span>
                  </span>
                </label>
              )}
            </>
          )}

          {status.packaged && (
            <div className="upd-field">
              <span className="small muted">{t('updates.mode.setting.label')}</span>
              <Radios
                label={t('updates.mode.setting.label')}
                value={status.settings.mode}
                options={UPDATE_MODE_SETTINGS.map((m) => [m, t(`updates.mode.setting.${m}`)])}
                onChange={(m) => save({ mode: m })}
              />
            </div>
          )}

          {mode === 'source' && (
            <dl className="upd-facts">
              <dt>{t('updates.log')}</dt>
              <dd><code className="upd-path">{status.logPath}</code></dd>
            </dl>
          )}
        </>
      )}

      {flow === 'dev' && (
        <div className="ws-confirm" role="status">
          <div>{t('updates.source.devNote')}</div>
          <div className="ws-actions"><button type="button" className="btn" onClick={() => setFlow(null)}>{t('updates.source.devOk')}</button></div>
        </div>
      )}

      {flow === 'confirm' && (
        <div className="ws-confirm" role="alertdialog" aria-label={t('updates.source.confirm.title')}>
          <div>{t('updates.source.confirm.body')}</div>
          <div className="ws-actions">
            <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void startSource()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('updates.source.confirm.go')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setFlow(null)}>{t('updates.source.confirm.cancel')}</button>
          </div>
        </div>
      )}

      {flow === 'started' && status && (
        <div className="ws-confirm" role="status" aria-live="polite">
          <div><span className="spinner" aria-hidden="true" /> {t('updates.source.started', { path: status.logPath })}</div>
        </div>
      )}
    </section>
  );
}
