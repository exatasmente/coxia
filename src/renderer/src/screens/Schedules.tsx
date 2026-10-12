import { useEffect, useState } from 'react';
import type { ThreadSummary } from '../../../shared/forum';
import type { Recurrence, Schedule, SchedulesView } from '../../../shared/schedules';
import type { Screen } from '../App';
import { errorText } from '../api';
import { HOME } from '../home';
import { intlLocale, t, useT } from '../i18n';
import { schedulesApi } from '../schedulesApi';
import { forumApi } from './cycle/forumApi';
import { BackIcon } from './icons';

// The schedules that wake the persona: the person's list of the same schedules the persona manages with its tools, the switch of the scheduler for this session of the
// app, and a form to make or change one.

const DAYS = [0, 1, 2, 3, 4, 5, 6];
// 2024-01-07 was a Sunday: the weekday names come from the locale, not from the catalogs.
const dayName = (d: number): string => new Date(2024, 0, 7 + d).toLocaleDateString(intlLocale(), { weekday: 'short' });
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');

export function describeRecurrence(r: Recurrence): string {
  if (r.kind === 'every') return t('ui.schedules.every', { count: r.minutes });
  if (r.kind === 'daily') return t('ui.schedules.daily', { time: r.time, days: r.days.map(dayName).join(', ') });
  return t('ui.schedules.once', { at: when(r.at) });
}

/** The values of the form, as typed. */
interface Draft {
  prompt: string;
  kind: Recurrence['kind'];
  minutes: string;
  time: string;
  days: number[];
  at: string;
  workdaysOnly: boolean;
  thread: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** A date as the `datetime-local` field takes it, in local time. */
const localInput = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function draftOf(s: Schedule | null, thread: string): Draft {
  const r = s?.recurrence;
  return {
    prompt: s?.prompt ?? '',
    kind: r?.kind ?? 'every',
    minutes: r?.kind === 'every' ? String(r.minutes) : '60',
    time: r?.kind === 'daily' ? r.time : '09:00',
    days: r?.kind === 'daily' ? r.days : [1, 2, 3, 4, 5],
    at: r?.kind === 'once' ? localInput(new Date(r.at)) : localInput(new Date(Date.now() + 3_600_000)),
    workdaysOnly: s?.workdaysOnly ?? false,
    thread: s?.thread ?? thread,
  };
}

function recurrenceOf(d: Draft): Recurrence {
  if (d.kind === 'every') return { kind: 'every', minutes: Number(d.minutes) };
  if (d.kind === 'daily') return { kind: 'daily', time: d.time, days: d.days };
  return { kind: 'once', at: new Date(d.at).toISOString() };
}

function ScheduleForm({ initial, threads, onSave, onCancel }: { initial: Draft; threads: ThreadSummary[]; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      await onSave(d);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" style={{ padding: 20, gap: 12 }} aria-label={t('ui.schedules.form')}>
      <label className="small muted" htmlFor="schedule-prompt">{t('ui.schedules.prompt')}</label>
      <textarea id="schedule-prompt" className="text-input" rows={3} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      <div className="row" style={{ gap: 12 }}>
        <label className="small muted" htmlFor="schedule-kind">{t('ui.schedules.kind')}</label>
        <select id="schedule-kind" className="text-input" value={d.kind} onChange={(e) => set({ kind: e.target.value as Recurrence['kind'] })}>
          <option value="every">{t('ui.schedules.kind.every')}</option>
          <option value="daily">{t('ui.schedules.kind.daily')}</option>
          <option value="once">{t('ui.schedules.kind.once')}</option>
        </select>
        {d.kind === 'every' && <input aria-label={t('ui.schedules.minutes')} className="text-input" type="number" min={1} value={d.minutes} onChange={(e) => set({ minutes: e.target.value })} />}
        {d.kind === 'daily' && <input aria-label={t('ui.schedules.time')} className="text-input" type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} />}
        {d.kind === 'once' && <input aria-label={t('ui.schedules.at')} className="text-input" type="datetime-local" value={d.at} onChange={(e) => set({ at: e.target.value })} />}
      </div>
      {d.kind === 'daily' && (
        <div className="row" style={{ gap: 10 }} role="group" aria-label={t('ui.schedules.days')}>
          {DAYS.map((day) => (
            <label key={day} className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={d.days.includes(day)} onChange={(e) => set({ days: e.target.checked ? [...d.days, day].sort() : d.days.filter((x) => x !== day) })} />
              {dayName(day)}
            </label>
          ))}
        </div>
      )}
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={d.workdaysOnly} onChange={(e) => set({ workdaysOnly: e.target.checked })} />
        {t('ui.schedules.workdaysOnly')}
      </label>
      <div className="row" style={{ gap: 12 }}>
        <label className="small muted" htmlFor="schedule-thread">{t('ui.schedules.thread')}</label>
        <select id="schedule-thread" className="text-input" value={d.thread} onChange={(e) => set({ thread: e.target.value })}>
          {threads.map((th) => <option key={th.id} value={th.id}>{th.title}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-accent" disabled={busy || !d.prompt.trim() || !d.thread} onClick={() => void save()}>
          {busy ? <span className="spinner" /> : null} {t('ui.schedules.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>{t('ui.schedules.cancel')}</button>
      </div>
    </section>
  );
}

export function SchedulesScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [view, setView] = useState<SchedulesView | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void schedulesApi.list().then(setView, (e) => setError(errorText(e)));
    // The conversations a schedule may answer in: not a run's thread, which is the runner's.
    void forumApi.list().then((list) => setThreads(list.filter((th) => th.kind !== 'run')), () => undefined);
    return schedulesApi.onChanged(setView);
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setView(await schedulesApi.list());
    } catch (e) {
      setError(errorText(e));
    }
  };

  const defaultThread = threads.find((th) => th.kind === 'agent')?.id ?? threads[0]?.id ?? '';
  const saveDraft = (current: Schedule | null) => async (d: Draft) => {
    const body = { prompt: d.prompt, recurrence: recurrenceOf(d), workdaysOnly: d.workdaysOnly, thread: d.thread };
    await act(() => (current ? schedulesApi.update(current.id, body) : schedulesApi.create(body)));
    setEditing(null);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.nav.backToday')} onClick={() => go(HOME)}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.schedules.title')}</h1>
          </div>
          {view && (
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" role="switch" aria-checked={view.enabled} checked={view.enabled} onChange={(e) => void act(() => schedulesApi.setEnabled(e.target.checked))} />
              {view.enabled ? t('ui.schedules.enabled') : t('ui.schedules.disabled')}
            </label>
          )}
        </header>
        <p className="small faint">{t('ui.schedules.intro')}</p>

        {error && <div className="error" role="alert">{error}</div>}
        {!view && !error && <div className="row faint"><span className="spinner" /> {t('ui.health.loading')}</div>}

        {view && editing === null && (
          <div className="row">
            <button type="button" className="btn btn-accent" onClick={() => setEditing('new')}>{t('ui.schedules.new')}</button>
          </div>
        )}
        {editing !== null && <ScheduleForm initial={draftOf(editing === 'new' ? null : editing, defaultThread)} threads={threads} onSave={saveDraft(editing === 'new' ? null : editing)} onCancel={() => setEditing(null)} />}

        {view && !view.schedules.length && <p className="small faint">{t('ui.schedules.empty')}</p>}
        {view?.schedules.map((s) => (
          <section key={s.id} className="panel" style={{ padding: 16, gap: 8 }}>
            <div className="row spread">
              <strong>{describeRecurrence(s.recurrence)}{s.workdaysOnly ? ` · ${t('ui.schedules.workdaysOnly')}` : ''}</strong>
              <span className="small faint">{s.paused ? t('ui.schedules.paused') : t('ui.schedules.next', { at: when(s.nextRun) })}</span>
            </div>
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{s.prompt}</div>
            <div className="small faint">
              {t('ui.schedules.where', { thread: threads.find((th) => th.id === s.thread)?.title ?? s.thread })} · {t('ui.schedules.by', { who: s.createdBy === 'user' ? t('ui.schedules.byPerson') : s.createdBy, at: when(s.updatedAt) })}
              {s.lastRun ? ` · ${t('ui.schedules.last', { at: when(s.lastRun) })}` : ''}
              {s.lastError ? ` · ${t('ui.schedules.lastError')}` : ''}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => void act(() => schedulesApi.update(s.id, { paused: !s.paused }))}>{s.paused ? t('ui.schedules.resume') : t('ui.schedules.pause')}</button>
              <button type="button" className="btn" onClick={() => setEditing(s)}>{t('ui.schedules.edit')}</button>
              {removing === s.id ? (
                <button type="button" className="btn" onClick={() => void act(() => schedulesApi.remove(s.id)).then(() => setRemoving(null))}>{t('ui.schedules.removeConfirm')}</button>
              ) : (
                <button type="button" className="btn" onClick={() => setRemoving(s.id)}>{t('ui.schedules.remove')}</button>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
