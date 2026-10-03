import { useCallback, useEffect, useRef, useState } from 'react';
import { teamsKey } from '../../../shared/minutes';
import { diffVersions, previousOf, snapshotOf } from '../../../shared/minutesVersions';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import type { Ceremony } from '../ceremony';
import { jobs, useJobs } from '../useJobs';
import { SquadScope } from './cycle/SquadPicker';
import { ContinueInClaude } from './ContinueInClaude';
import { EfeitoStatus } from './EfeitoStatus';
import { ChangeSummary, DayPanel, DeleteSheet, type MinutesView, VersionPanel, VersionSwitcher, versionTitle } from './MinutesParts';
import { intlLocale, t, tNodes, tv, useT, useTv } from '../i18n';
import { type Which, useDay } from '../minutesApi';

function effectsPrompt(effects: Ceremony['effects']): string {
  return [t('ui.ata.prompt.effects'), ...effects.map((e, i) => `${i + 1}. ${e.ref} (${e.repo}): ${e.text}`)].join('\n');
}

function effectPrompt(e: Ceremony['effects'][number]): string {
  return t('ui.ata.prompt.effect', { ref: e.ref, repo: e.repo, text: e.text });
}

export function Ata({ ceremony: c, go }: { ceremony: Ceremony; go: (s: Screen) => void }) {
  const t = useT();
  const tv = useTv();
  const m = c.minutes;
  const [selected, setSelected] = useState<boolean[]>(() => m.decisions.map(() => true));
  const { teams, setTeams, saveResult: result, setSaveResult: setResult } = c;
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'teams' | 'effects' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const asked = useRef(false);

  // The minutes are versions of the day: this screen shows the call being held (or just held) and lets the person read the others.
  const date = c.snapshot.id.slice(0, 10);
  const { day, reload } = useDay(date, `${c.snapshot.id}:${!!c.saveResult}:${c.snapshot.endedAt}`);
  const currentN = day?.versions.find((v) => v.ceremonyId === c.snapshot.id)?.n ?? null;
  const [sel, setSel] = useState<'current' | MinutesView>('current');
  const [deleting, setDeleting] = useState<Which | null>(null);
  const [copiedOther, setCopiedOther] = useState(false);
  const liveNow = !!c.startedAt && !c.callEnded;
  // The version's registration happens with the first save of the call, a moment after it starts.
  useEffect(() => {
    if (!c.startedAt || !day || currentN !== null) return;
    const timer = setTimeout(() => void reload(), 900);
    return () => clearTimeout(timer);
  }, [c.startedAt, day, currentN, reload]);
  const shownView: MinutesView = sel === 'current' ? { kind: 'version', n: currentN ?? -1 } : sel;
  const others = day?.versions.filter((v) => v.n !== currentN) ?? [];
  const liveDiff = day ? diffVersions(previousOf(day.versions, currentN ?? Number.MAX_SAFE_INTEGER), snapshotOf(c.snapshot)) : null;
  const picked = sel !== 'current' && sel.kind === 'version' ? day?.versions.find((v) => v.n === sel.n) : undefined;
  const deleteTarget: Which | null = sel === 'current' ? (currentN !== null ? [currentN] : null) : sel.kind === 'version' ? [sel.n] : 'all';
  const deleteBlocked = (sel === 'current' && liveNow) || !!picked?.live || (sel !== 'current' && sel.kind === 'day' && (liveNow || !!day?.versions.some((v) => v.live)));

  const key = teamsKey(c.snapshot);
  const current = !!teams && c.teamsKey === key;

  // The jobs write the text and the saved result into the ceremony store themselves, so they land even if this screen is gone by then.
  const loadTeams = useCallback(() => {
    setTeamsError(null);
    setTeams(null, null);
    jobs.launch('ata:teams', { label: t('ui.ata.job.teamsLabel'), busy: t('ui.ata.writing'), screen: { name: 'ata' } }, async () => {
      const text = await api.teamsText(m, c.cards?.cards ?? []);
      setTeams(text, key);
      return text;
    });
  }, [m, c.cards, key]);

  // The text is written again only when decisions, effects or cards changed since it was written.
  useEffect(() => {
    if (asked.current || current || jobs.get('ata:teams')) return;
    asked.current = true;
    loadTeams();
  }, [loadTeams, current]);

  const running = useJobs('ata:', {
    failed: (message, job) => (job.key === 'ata:save' ? setSaveError(message) : setTeamsError(message)),
  });
  const saving = running.some((j) => j.key === 'ata:save');

  const copy = async (what: 'teams' | 'effects', text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const save = () => {
    setSaveError(null);
    const idx = selected.flatMap((on, i) => (on ? [i] : []));
    jobs.launch('ata:save', { label: t('ui.ata.job.saveLabel'), busy: t('ui.ata.job.saveBusy'), screen: { name: 'ata' } }, async () => {
      const saved = await api.saveMinutes(m, teams ?? '', idx, c.snapshot.id);
      setResult(saved);
      return saved;
    });
  };

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const writtenFor = (i: number) => (result ? result.written.find((w) => w.ref === m.decisions[i].ref && w.dest === m.decisions[i].dest) : undefined);

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1240, gap: 24 }}>
        <header className="row spread" style={{ alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 14 }}>
              <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => go({ name: 'today' })}>{t('ui.ata.backToday')}</button>
              {!c.callEnded && c.startedAt && <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => go({ name: 'call' })}>{tv('call.back')}</button>}
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 700 }}>{t('ui.ata.title')}</h1>
            {currentN !== null && <div className="small" style={{ fontWeight: 600 }}>{versionTitle(currentN, date)}</div>}
            <div><SquadScope squad={m.squad} /></div>
            <div className="muted">
              {t((c.cards?.cards.length ?? 0) === 1 ? 'ui.ata.subtitleOne' : 'ui.ata.subtitleOther', {
                date: new Date(m.startedAt).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }),
                start: fmt(m.startedAt),
                end: fmt(m.endedAt),
                count: c.cards?.cards.length ?? 0,
              })}
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {[
              [m.decisions.length, 'ui.ata.stat.decisions'],
              [m.effects.length, 'ui.ata.stat.effects'],
              [m.unanswered.length, 'ui.ata.stat.unanswered'],
            ].map(([n, label]) => (
              <div
                key={label}
                className="panel"
                style={{ padding: '12px 16px', minWidth: 110, gap: 0 }} // i18n-ignore: CSS shorthand
              >
                <div style={{ fontSize: 26, fontWeight: 700 }}>{n}</div>
                <div className="small muted">{t(label as string)}</div>
              </div>
            ))}
          </div>
        </header>

        {day && day.versions.length > 0 && (
          <div className="row spread" style={{ gap: 12 }}>
            <VersionSwitcher versions={day.versions} selected={shownView} withDay onSelect={(v) => setSel(v.kind === 'version' && v.n === currentN ? 'current' : v)} />
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" disabled={!deleteTarget || deleteBlocked} title={deleteBlocked ? tv('minutes.delete.liveHint') : undefined} onClick={() => deleteTarget && setDeleting(deleteTarget)}>
                {sel !== 'current' && sel.kind === 'day' ? t('minutes.delete.day') : t('minutes.delete.version')}
              </button>
              {(sel === 'current' || sel.kind === 'version') && day.versions.length > 1 && (
                <button type="button" className="btn" disabled={liveNow || day.versions.some((v) => v.live)} title={liveNow ? tv('minutes.delete.liveHint') : undefined} onClick={() => setDeleting('all')}>{t('minutes.delete.day')}</button>
              )}
            </div>
          </div>
        )}
        {deleteBlocked && <p className="small muted">{tv('minutes.delete.liveHint')}</p>}
        {deleting && day && (
          <DeleteSheet
            date={date}
            which={deleting}
            onClose={() => setDeleting(null)}
            onDone={(entry) => {
              setDeleting(null);
              setSel('current');
              void reload();
              // The ceremony itself starts over through the event the deletion broadcasts.
              if (entry.ceremonyIds.includes(c.snapshot.id)) go({ name: 'today' });
            }}
          />
        )}

        {sel !== 'current' && sel.kind === 'day' && day && (
          <DayPanel day={day} copied={copiedOther} onCopy={(text) => void api.copy(text).then(() => { setCopiedOther(true); setTimeout(() => setCopiedOther(false), 2000); })} />
        )}
        {picked && day && <VersionPanel version={picked} date={date} copied={copiedOther} onChanged={() => void reload()} onCopy={(text) => void api.copy(text).then(() => { setCopiedOther(true); setTimeout(() => setCopiedOther(false), 2000); })} />}
        {sel !== 'current' && sel.kind === 'version' && <p className="small muted">{t('minutes.ata.readOnly')} <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => go({ name: 'history' })}>{t('minutes.ata.openHistory')}</button></p>}

        {sel === 'current' && (
        <div className="cols" style={{ gap: 20 }}>
          <div style={{ flex: '3 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {liveDiff && liveDiff.base !== null && (
              <section className="panel" style={{ padding: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('minutes.diff.title')}</h2>
                <ChangeSummary diff={liveDiff} />
              </section>
            )}
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <div className="row spread">
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.ata.decisions.title')}</h2>
                  <p className="small muted" style={{ marginTop: 4 }}>{t('ui.ata.decisions.hint')}</p>
                </div>
                <button type="button" className="btn btn-dark" disabled={saving || !!result} onClick={() => save()}>
                  {saving ? <span className="spinner" /> : null} {result ? t('ui.ata.save.done') : t('ui.ata.save.action')}
                </button>
              </div>
              {!m.decisions.length && <p className="small faint">{t('ui.ata.decisions.empty')}</p>}
              {m.decisions.map((d, i) => {
                const w = writtenFor(i);
                return (
                  <label key={`${d.ref}-${i}`} className={`check-row ${w?.ok ? 'saved' : ''}`}>
                    <input type="checkbox" checked={selected[i] ?? true} disabled={!!result} onChange={() => setSelected((s) => s.map((v, j) => (j === i ? !v : v)))} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
                      <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                        <span className="mono small muted">{d.ref}</span>
                        <span style={{ lineHeight: 1.45 }}>{d.text}</span>
                      </span>
                      <span className="dest">→ {d.dest}</span>
                      {w && <span className="small" style={{ color: w.ok ? 'var(--teal-ink)' : 'var(--amber-ink)' }}>{w.ok && w.duplicateOf === undefined ? t('ui.ata.decision.saved') : w.detail}</span>}
                    </span>
                  </label>
                );
              })}
              {result && <p className="small muted">{tNodes('ui.ata.savedAt', { path: <span className="mono">{result.ataPath}</span> })}</p>}
              {saveError && <div className="error">{saveError}</div>}
            </section>

            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <div className="row spread">
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.ata.effects.title')}</h2>
                  <p className="small muted" style={{ marginTop: 4 }}>{t('ui.ata.effects.hint')}</p>
                </div>
                <button type="button" className="btn" style={{ background: 'var(--warn-solid)', color: 'var(--white)', borderColor: 'var(--warn-solid)' }} disabled={!m.effects.length} onClick={() => void copy('effects', effectsPrompt(m.effects))}>
                  {copied === 'effects' ? t('ui.ata.copied') : t('ui.ata.effects.copy')}
                </button>
              </div>
              {!m.effects.length && <p className="small faint">{t('ui.ata.effects.empty')}</p>}
              {m.effects.map((e, i) => (
                <div
                  key={`${e.ref}-${i}`}
                  className="row"
                  style={{ padding: '12px 0', borderTop: '1px solid var(--line-2)' }} // i18n-ignore: CSS shorthand
                >
                  <span className="badge-e3">{'E3'}</span>
                  <span style={{ flex: '1 1 260px' }}>{e.text}</span>
                  <span className="mono faint">{e.repo} · {e.ref}</span>
                  <EfeitoStatus effect={e} ceremonyId={c.snapshot.id} />
                  {c.turns[e.ref]?.sessionId ?? c.deep[e.ref]?.sessionId ? (
                    <ContinueInClaude sessionId={c.turns[e.ref]?.sessionId ?? c.deep[e.ref]?.sessionId} prompt={effectPrompt(e)} label={t('ui.ata.effect.run')} role={c.turns[e.ref]?.sessionId ? 'turn' : 'deep'} />
                  ) : (
                    <button type="button" className="btn" title={t('ui.ata.effect.noSession')} onClick={() => void api.copy(effectPrompt(e))}>{t('ui.ata.effect.copyRequest')}</button>
                  )}
                </div>
              ))}
            </section>

            {m.unanswered.length > 0 && (
              <section className="panel" style={{ padding: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.ata.unanswered.title')}</h2>
                {m.unanswered.map((u) => (
                  <div key={u.ref} className="item ask">
                    <div className="mono" style={{ fontSize: 12, color: 'var(--blue-ink)' }}>{u.ref}</div>
                    <div className="small">{u.question}</div>
                  </div>
                ))}
              </section>
            )}
          </div>

          <div style={{ flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
              <div className="row spread">
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.ata.teams.title')}</h2>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!teams} onClick={() => loadTeams()}>
                    {t('ui.ata.teams.rewrite')}
                  </button>
                  <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!teams} onClick={() => teams && void copy('teams', teams)}>
                    {copied === 'teams' ? t('ui.ata.copied') : t('ui.ata.copy')}
                  </button>
                </div>
              </div>
              {teams && <pre className="teams">{teams}</pre>}
              {!teams && !teamsError && <div className="row small" style={{ color: 'var(--on-night-muted)' }}><span className="spinner" /> {t('ui.ata.writing')}</div>}
              {teamsError && (
                <div className="row">
                  <span className="small" style={{ color: 'var(--night-red)' }}>{teamsError}</span>
                  <button type="button" className="btn" onClick={() => loadTeams()}>{t('ui.ata.retry')}</button>
                </div>
              )}
              <p className="small" style={{ color: 'var(--on-night-muted)' }}>{t('ui.ata.teams.note')}</p>
            </section>

            <section className="panel" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.ata.transcript')}</h2>
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {m.transcript.map((line, i) => (
                  <div key={i} className="log-line">
                    <span className="at">{line.at}</span>
                    <span className="who">{line.who}</span>
                    <span className="text">{line.text}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
