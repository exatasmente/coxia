import { useCallback, useEffect, useState } from 'react';
import { type DayView, type DeletePreview, type Kept, type TrashEntry, type VersionDiff, type VersionView, TRASH_DAYS, coveredCards, dayMinutes, versionMinutes } from '../../../shared/minutesVersions';
import { getLanguage } from '../../../shared/i18n';
import type { Decision } from '../../../shared/types';
import { api, errorText } from '../api';
import { t } from '../i18n';
import { jobs, useJobs } from '../useJobs';
import { type Which, minutesApi } from '../minutesApi';
import { Sheet } from './Sheet';
import '../minutes.css';

const locale = (): string => (getLanguage() === 'en' ? 'en-GB' : 'pt-BR');

export function clockTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '--:--';
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export type MinutesView = { kind: 'version'; n: number } | { kind: 'day' };

/** "Versão 2 de hoje" for today's, "Versão 2" for another day's. */
export function versionTitle(n: number, date: string): string {
  return t(date === new Date().toLocaleDateString('sv-SE') ? 'minutes.version.label' : 'minutes.version.labelDay', { n });
}

// ---------------------------------------------------------------- switcher

export function VersionSwitcher({
  versions,
  selected,
  onSelect,
  withDay,
}: {
  versions: Pick<VersionView, 'n' | 'startedAt' | 'live'>[];
  selected: MinutesView;
  onSelect: (view: MinutesView) => void;
  withDay: boolean;
}) {
  return (
    <div className="mv-switch" role="group" aria-label={t('minutes.version.pick')}>
      {versions.map((v) => (
        <button key={v.n} type="button" className={`filter ${selected.kind === 'version' && selected.n === v.n ? 'on' : ''}`} aria-pressed={selected.kind === 'version' && selected.n === v.n} onClick={() => onSelect({ kind: 'version', n: v.n })}>
          {t('minutes.version.chip', { n: v.n, time: clockTime(v.startedAt) })}
          {v.live && <span className="mv-live">{t('minutes.version.live')}</span>}
        </button>
      ))}
      {withDay && versions.length > 1 && (
        <button type="button" className={`filter ${selected.kind === 'day' ? 'on' : ''}`} aria-pressed={selected.kind === 'day'} onClick={() => onSelect({ kind: 'day' })}>
          {t('minutes.version.day')}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- what changed

function List({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}

const ref = (r: string) => <span className="mono small muted">{r}</span>;

export function ChangeSummary({ diff }: { diff: VersionDiff }) {
  if (diff.base === null) return <p className="small muted">{t('minutes.diff.first')}</p>;
  if (diff.empty) return <p className="small muted">{t('minutes.diff.empty', { n: diff.base })}</p>;
  return (
    <div className="mv-diff">
      <p className="small muted">{t('minutes.diff.base', { n: diff.base })}</p>
      {diff.decisionsAdded.length > 0 && (
        <List title={t('minutes.diff.decisionsAdded')}>
          {diff.decisionsAdded.map((d, i) => (
            <li key={i}>{ref(d.ref)}<span>{d.text}</span></li>
          ))}
        </List>
      )}
      {diff.decisionsChanged.length > 0 && (
        <List title={t('minutes.diff.decisionsChanged')}>
          {diff.decisionsChanged.map((c) => (
            <li key={c.ref}>
              {ref(c.ref)}
              <span className="mv-before">{c.before.map((d) => d.text).join('; ')}</span>
              <span>{c.after.map((d) => d.text).join('; ')}</span>
            </li>
          ))}
        </List>
      )}
      {diff.effectsAdded.length > 0 && (
        <List title={t('minutes.diff.effectsAdded')}>
          {diff.effectsAdded.map((e, i) => (
            <li key={i}>{ref(e.ref)}<span>{e.text}</span></li>
          ))}
        </List>
      )}
      {diff.questionsResolved.length > 0 && (
        <List title={t('minutes.diff.resolved')}>
          {diff.questionsResolved.map((u) => (
            <li key={u.ref}>{ref(u.ref)}<span>{u.question}</span></li>
          ))}
        </List>
      )}
      {diff.questionsNew.length > 0 && (
        <List title={t('minutes.diff.newQuestions')}>
          {diff.questionsNew.map((u) => (
            <li key={u.ref}>{ref(u.ref)}<span>{u.question}</span></li>
          ))}
        </List>
      )}
      {diff.activitiesNew.length > 0 && (
        <List title={t('minutes.diff.activitiesNew')}>
          {diff.activitiesNew.map((c) => (
            <li key={c.ref}>{ref(`#${c.iid}`)}<span>{c.title}</span></li>
          ))}
        </List>
      )}
      {diff.activitiesChanged.length > 0 && (
        <List title={t('minutes.diff.activitiesChanged')}>
          {diff.activitiesChanged.map((c) => (
            <li key={c.ref}>{ref(`#${c.iid}`)}<span>{c.title}</span></li>
          ))}
        </List>
      )}
      {diff.activitiesUnchanged.length > 0 && (
        <List title={t('minutes.diff.activitiesUnchanged')}>
          {diff.activitiesUnchanged.map((c) => (
            <li key={c.ref}>{ref(`#${c.iid}`)}<span>{c.title}</span></li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- delete

function KeptBlock({ title, items }: { title: string; items: Kept[] }) {
  if (!items.length) return null;
  return (
    <div>
      <strong>{title}</strong>
      <ul>
        {items.map((k, i) => (
          <li key={i}>
            <span className="mono small">{k.ref}</span> {k.text} <span className="mv-tag" /* i18n-ignore: version prefix */>v{k.n}</span>
            <div className="mv-dest">{k.dest}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The confirmation before the minutes go to the trash: what moves, and what stays where it was written. */
export function DeleteSheet({ date, which, onClose, onDone }: { date: string; which: Which; onClose: () => void; onDone: (entry: TrashEntry) => void }) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    minutesApi.previewDelete(date, which).then(setPreview, (e) => setError(errorText(e)));
  }, [date, which]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await minutesApi.remove(date, which));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const whole = which === 'all';
  const kept = preview?.kept;
  const nothingKept = !!kept && !kept.registro.length && !kept.notes.length && !kept.effects.length;
  return (
    <Sheet label={whole ? t('minutes.delete.titleDay', { date: dayLabel(date) }) : t('minutes.delete.title')} onClose={onClose}>
      {!preview && !error && <div className="row faint"><span className="spinner" /> {t('minutes.delete.loading')}</div>}
      {error && <div className="error">{error}</div>}
      {preview && (
        <>
          <p className="small">{t('minutes.delete.intro', { days: preview.trashDays })}</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {preview.versions.map((v) => (
              <li key={v.n}>{t('minutes.delete.versionLine', { n: v.n, from: clockTime(v.startedAt), to: clockTime(v.endedAt) })}</li>
            ))}
            {preview.files.length > 0 && <li className="mono" style={{ overflowWrap: 'anywhere' }}>{preview.files.join(', ')}</li>}
            {preview.ceremonies > 0 && <li>{t('minutes.delete.ceremonies', { count: preview.ceremonies })}</li>}
          </ul>
          <div className="mv-kept" role="note">
            <strong>{t('minutes.delete.keptTitle')}</strong>
            {nothingKept && <span>{t('minutes.delete.keptNone')}</span>}
            {kept && (
              <>
                <KeptBlock title={t('minutes.delete.keptRegistro')} items={kept.registro} />
                <KeptBlock title={t('minutes.delete.keptNotes')} items={kept.notes} />
                <KeptBlock title={t('minutes.delete.keptEffects')} items={kept.effects} />
              </>
            )}
            <span>{t('minutes.delete.keptAlways')}</span>
          </div>
          {preview.blocked && <div className="error">{preview.blocked}</div>}
          <div className="mv-confirm">
            <button type="button" className="btn" onClick={onClose}>{t('minutes.delete.cancel')}</button>
            <button type="button" className="btn btn-red" disabled={!!preview.blocked || busy} onClick={() => void confirm()}>
              {busy && <span className="spinner" />} {whole ? t('minutes.delete.confirmDay') : t('minutes.delete.confirm')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- trash

export function TrashSection({ refresh, onRestored }: { refresh: unknown; onRestored: () => void }) {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => void minutesApi.trash().then(setItems, (e) => setError(errorText(e))), []);
  useEffect(load, [load, refresh]);

  const restore = async (id: string) => {
    setError(null);
    try {
      const r = await minutesApi.restore(id);
      const moved = r.versions.filter((v) => v.from !== v.to);
      setMessage([t('minutes.trash.restored'), ...moved.map((v) => t('minutes.trash.renumbered', { from: v.from, to: v.to }))].join(' '));
      load();
      onRestored();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <details className="mv-trash panel" style={{ padding: 12 }}>
      <summary>{t('minutes.trash.title')} · {items.length}</summary>
      <p className="small muted">{t('minutes.trash.note', { days: TRASH_DAYS })}</p>
      {items.length === 0 && <p className="small faint">{t('minutes.trash.empty')}</p>}
      {items.map((e) => (
        <div key={e.id} className="mv-trash-item">
          <span style={{ fontWeight: 600 }}>{dayLabel(e.date)}</span>
          <span className="small muted">
            {e.scope === 'day' ? t('minutes.trash.wholeDay') : t('minutes.trash.versions', { list: e.versions.join(', ') })} · {t('minutes.trash.left', { count: e.daysLeft })}
          </span>
          <span><button type="button" className="btn" onClick={() => void restore(e.id)}>{t('minutes.trash.restore')}</button></span>
        </div>
      ))}
      {message && <p className="small" style={{ color: 'var(--teal-ink)' }}>{message}</p>}
      {error && <div className="error">{error}</div>}
    </details>
  );
}

// ---------------------------------------------------------------- the whole day

function DecisionRow({ d }: { d: Decision & { version: number } }) {
  return (
    <div className="item">
      <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
        <span className="mono small muted">{d.ref}</span>
        <span>{d.text}</span>
        <span className="mv-tag">{t('minutes.day.fromVersion', { n: d.version })}</span>
      </span>
      <span className="dest">→ {d.dest}</span>
    </div>
  );
}

/** The minutes of the whole day: the latest decision of each activity, and the team chat text of the day. */
export function DayPanel({ day, onCopy, copied }: { day: DayView; onCopy: (text: string) => void; copied: boolean }) {
  const m = day.merged;
  const [error, setError] = useState<string | null>(null);
  const key = `ata:day-teams:${day.date}`;
  const running = useJobs(key, { failed: (message) => setError(message) });
  const [text, setText] = useState<string | null>(day.dayTeams && day.dayTeams.key === day.dayKey ? day.dayTeams.text : null);
  useEffect(() => setText(day.dayTeams && day.dayTeams.key === day.dayKey ? day.dayTeams.text : null), [day.dayTeams, day.dayKey]);

  const write = () => {
    setError(null);
    jobs.launch(key, { label: t('minutes.day.job'), busy: t('minutes.day.writing'), screen: { name: 'history' } }, async () => {
      const written = await api.teamsText(dayMinutes(m), coveredCards(m.covered));
      await minutesApi.saveDayTeams(day.date, day.dayKey, written);
      setText(written);
      return written;
    });
  };

  return (
    <>
      <section className="panel" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('minutes.day.title')} · {t('minutes.day.versions', { count: m.versions.length })}</h2>
        <p className="small muted">{t('minutes.day.note')}</p>
        <h3 className="section-title" style={{ marginTop: 8 }}>{t('minutes.day.decisions')} · {m.decisions.length}</h3>
        {!m.decisions.length && <p className="small faint">{t('minutes.day.noDecisions')}</p>}
        {m.decisions.map((d, i) => <DecisionRow key={i} d={d} />)}
        {m.superseded.length > 0 && (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>{t('minutes.day.superseded')} · {m.superseded.length}</summary>
            {m.superseded.map((d, i) => <DecisionRow key={i} d={d} />)}
          </details>
        )}
        <h3 className="section-title" style={{ marginTop: 8 }}>{t('minutes.day.effects')} · {m.effects.length}</h3>
        {m.effects.map((e, i) => (
          <div key={i} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--line-2)' }} // i18n-ignore: CSS shorthand
          >
            <span className="badge-e3" /* i18n-ignore */>E3</span>
            <span style={{ flex: '1 1 220px' }}>{e.text}</span>
            <span className="mono faint">{e.repo} · {e.ref}</span>
            <span className="mv-tag">{t('minutes.day.fromVersion', { n: e.version })}</span>
          </div>
        ))}
        {m.unanswered.length > 0 && (
          <>
            <h3 className="section-title" style={{ marginTop: 8 }}>{t('minutes.day.unanswered')} · {m.unanswered.length}</h3>
            {m.unanswered.map((u) => (
              <div key={u.ref} className="item ask"><span className="mono small">{u.ref}</span><span className="small">{u.question}</span></div>
            ))}
          </>
        )}
        {day.repeated.length > 0 && (
          <>
            <h3 className="section-title" style={{ marginTop: 8 }}>{t('minutes.day.repeated')} · {day.repeated.length}</h3>
            {day.repeated.map((r) => (
              <div key={r.ref} className="item ask">
                <span className="mono small">{r.ref}</span>
                <span className="small">{r.question}</span>
                <span className="dest">{t('minutes.day.repeated.on', { dates: r.dates.join(', ') })} · {t(r.count === 1 ? 'minutes.day.repeated.days_one' : 'minutes.day.repeated.days_other', { count: r.count })}</span>
              </div>
            ))}
          </>
        )}
        <h3 className="section-title" style={{ marginTop: 8 }}>{t('minutes.day.covered')} · {m.covered.length}</h3>
        {m.covered.map((c) => (
          <div key={c.ref} className="row" style={{ gap: 10 }}>
            <span className="mono small muted">#{c.iid}</span>
            <span>{c.title}</span>
            {c.status !== 'new' && <span className="mv-tag">{t(c.status === 'unchanged' ? 'minutes.day.unchanged' : 'minutes.day.changed')}</span>}
          </div>
        ))}
      </section>

      <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
        <div className="row spread">
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('minutes.day.teams')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" style={{ minHeight: 44, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={running.length > 0} onClick={write}>
              {running.length > 0 && <span className="spinner" />} {text ? t('minutes.day.rewrite') : t('minutes.day.write')}
            </button>
            <button type="button" className="btn" style={{ minHeight: 44, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!text} onClick={() => text && onCopy(text)}>
              {copied ? t('minutes.copied') : t('minutes.copy')}
            </button>
          </div>
        </div>
        {text && <pre className="teams">{text}</pre>}
        {!text && running.length === 0 && <p className="small" style={{ color: 'var(--on-night-muted)' }}>{t('minutes.day.noText')}</p>}
        {error && <span className="small" style={{ color: 'var(--night-red)' }}>{error}</span>}
      </section>
    </>
  );
}

/** A past version, read-only: what it decided, queued, left open, and its team chat text. */
export function VersionPanel({ version, date, onCopy, copied, onChanged }: { version: VersionView; date: string; onCopy: (text: string) => void; copied: boolean; onChanged: () => void }) {
  const s = version.snapshot;
  const [error, setError] = useState<string | null>(null);
  const key = `ata:version-teams:${date}:${version.n}`;
  const running = useJobs(key, { failed: (message) => setError(message) });
  const write = () => {
    setError(null);
    jobs.launch(key, { label: t('minutes.version.job', { n: version.n }), busy: t('minutes.day.writing'), screen: { name: 'history' } }, async () => {
      const written = await api.teamsText(versionMinutes(version), coveredCards(s.covered));
      await minutesApi.saveVersionTeams(date, version.n, written);
      onChanged();
      return written;
    });
  };
  const w = (d: Decision) => version.written.find((x) => x.ref === d.ref && x.dest === d.dest && x.text === d.text);
  return (
    <>
      <section className="panel" style={{ padding: 20 }}>
        <div className="row spread">
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('minutes.diff.title')}</h2>
        </div>
        <ChangeSummary diff={version.diff} />
      </section>
      <section className="panel" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('minutes.day.decisions')} · {s.decisions.length}</h2>
        {!s.decisions.length && <p className="small faint">{t('minutes.day.noDecisions')}</p>}
        {s.decisions.map((d, i) => {
          const written = w(d);
          return (
            <div key={i} className="item">
              <span className="row" style={{ gap: 10, alignItems: 'baseline' }}><span className="mono small muted">{d.ref}</span><span>{d.text}</span></span>
              <span className="dest">→ {d.dest}</span>
              <span className="small" style={{ color: written?.ok ? 'var(--teal-ink)' : 'var(--faint)' }}>{written ? (written.ok ? t('minutes.written.ok') : written.detail) : t('minutes.written.no')}</span>
            </div>
          );
        })}
        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{t('minutes.day.effects')} · {s.effects.length}</h2>
        {s.effects.map((e, i) => (
          <div key={i} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--line-2)' }} // i18n-ignore: CSS shorthand
          >
            <span className="badge-e3" /* i18n-ignore */>E3</span><span style={{ flex: '1 1 220px' }}>{e.text}</span><span className="mono faint">{e.repo} · {e.ref}</span>
          </div>
        ))}
        {s.unanswered.length > 0 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{t('minutes.day.unanswered')} · {s.unanswered.length}</h2>
            {s.unanswered.map((u) => <div key={u.ref} className="item ask"><span className="mono small">{u.ref}</span><span className="small">{u.question}</span></div>)}
          </>
        )}
      </section>
      <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
        <div className="row spread">
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('minutes.version.teams', { n: version.n })}</h2>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" style={{ minHeight: 44, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={running.length > 0} onClick={write}>
              {running.length > 0 && <span className="spinner" />} {version.teams ? t('minutes.day.rewrite') : t('minutes.day.write')}
            </button>
            <button type="button" className="btn" style={{ minHeight: 44, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!version.teams} onClick={() => version.teams && onCopy(version.teams)}>
              {copied ? t('minutes.copied') : t('minutes.copy')}
            </button>
          </div>
        </div>
        {version.teams && <pre className="teams">{version.teams}</pre>}
        {!version.teams && running.length === 0 && <p className="small" style={{ color: 'var(--on-night-muted)' }}>{t('minutes.version.noText')}</p>}
        {error && <span className="small" style={{ color: 'var(--night-red)' }}>{error}</span>}
      </section>
    </>
  );
}
