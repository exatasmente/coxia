import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { transcribeAudio, type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { AgentActivity } from '../AgentActivity';
import { ConflictResolver } from './ConflictResolver';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { useT, useTv, useVoiceEnabled } from '../i18n';
import { voiceEnabled } from '../../../shared/i18n';

const HEADER_STYLE: CSSProperties = { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }; // i18n-ignore: CSS value
const MAIN_STYLE: CSSProperties = { flex: '3 1 480px', minWidth: 0, padding: '18px 20px', gap: 14 }; // i18n-ignore: CSS value
const CONFLICT_FILE_STYLE: CSSProperties = { fontSize: 12, wordBreak: 'break-all', borderColor: 'var(--red-line)', background: 'var(--red-faint)' };

export function Conflict({
  action,
  ceremony: c,
  player,
  go,
}: { action: ReleaseAction | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const t = useT();
  const tv = useTv();
  const voiceOn = useVoiceEnabled();
  const rec = useRecorder(() => void talkRef.current());
  const opened = useRef(false);
  const voice = c.voices?.agents[2] ?? null;

  // The updated action reaches the app through the actions event; the job only carries the busy state and the spoken answer.
  const ask = useCallback(
    (question: string) => {
      if (!action) return;
      setError(null);
      jobs.launch(`conflict:${action.id}:ask`, { label: t('ui.conflict.job.label', { issue: action.issue }), busy: t('ui.conflict.busy.reading'), screen: { name: 'conflict', id: action.id } }, () => api.conflictAsk(action.id, question));
    },
    [action],
  );

  useEffect(() => {
    if (opened.current || !action) return;
    opened.current = true;
    if (!action.msgs.length && !action.sessionId && !jobs.get(`conflict:${action.id}:ask`)) ask(t('ui.conflict.opening'));
  }, [action, ask]);

  const running = useJobs<ReleaseAction>(action ? `conflict:${action.id}:` : null, {
    done: (updated, _job, late) => {
      const last = updated.msgs[updated.msgs.length - 1];
      if (!late && voice && last && !last.me) void player.say(last.speech ?? last.text, voice, 'conflito').catch(() => undefined);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running, localBusy);

  const talk = useCallback(async () => {
    if (player.speaking) player.stop();
    if (!rec.recording) {
      try {
        await rec.start();
      } catch (e) {
        setError(t('ui.conflict.error.mic', { error: errorText(e) }));
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio) return;
    setBusy(t('ui.conflict.busy.transcribing'));
    try {
      const text = await transcribeAudio(audio);
      setBusy(null);
      if (text) ask(text);
    } catch (e) {
      setBusy(null);
      setError(t('ui.conflict.error.transcription', { error: errorText(e) }));
    }
  }, [rec, player, ask]);

  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !voiceEnabled() || e.repeat || (e.target as HTMLElement).closest('input, textarea, button, select, a')) return; // i18n-ignore: CSS selector
      e.preventDefault();
      void talkRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!action) {
    return (
      <div className="page"><div className="wrap">
        <div className="error">{t('ui.conflict.notFound')}</div>
        <div><button type="button" className="btn" onClick={() => go({ name: 'actions' })}>{t('ui.conflict.back')}</button></div>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="panel-dark hero" style={HEADER_STYLE}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.conflict.back')} onClick={() => go({ name: 'actions' })}>
            <BackIcon />
          </button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-amber)', fontWeight: 600 }}>{t('ui.conflict.header', { issue: action.issue, release: action.release ?? '' })}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{action.issueTitle}</div>
          </div>
          <Presence recording={rec.recording} thinking={!!busy} on={!!player.speaking || rec.recording} color={rec.recording ? 'var(--rec-blue)' : 'var(--night-orange)'} level={rec.level} small />
          {voiceOn && (
            <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy} onClick={() => void talk()}>
              <MicIcon /> {rec.recording ? t('ui.conflict.mic.send') : t('ui.conflict.mic.talk')}
            </button>
          )}
        </header>

        <ConflictResolver action={action} />

        <div className="cols deep-layout">
          <aside className="panel deep-sources" style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 250, gap: 10 }}>
            <h2 className="section-title">{t('ui.conflict.inConflict')}</h2>
            {action.mrs.map((m) => (
              <a key={m.ref} className="item mono small" href={m.url} target="_blank" rel="noreferrer">{t('ui.conflict.mr', { ref: m.ref, branch: m.branch, behind: m.behind })}</a>
            ))}
            {action.files.map((f) => <div key={f} className="item mono" style={CONFLICT_FILE_STYLE}>{f}</div>)}
          </aside>

          <main className="panel deep-main" style={MAIN_STYLE} aria-live="polite">
            <h2 className="section-title">{t('ui.conflict.talk')}</h2>
            {action.msgs.map((m, i) => (
              <Bubble key={i} m={m} who={m.me ? t('ui.conflict.who.you') : t('ui.conflict.who.agent')} voice={voice} player={player} speaker="conflito" />
            ))}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}
            {error && <div className="error">{error}</div>}
            <form
              className="row composer"
              style={{ flexWrap: 'nowrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() && !busy) void ask(draft.trim());
                setDraft('');
              }}
            >
              <input className="text-input" placeholder={t('ui.conflict.draft.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.conflict.draft.aria')} />
              <button type="submit" className="btn btn-dark" disabled={!!busy || !draft.trim()}>{t('ui.conflict.draft.submit')}</button>
            </form>
          </main>

          <aside className="deep-side" style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 290, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="panel">
              <h2 className="section-title">{tv('call.after')}</h2>
              <p className="small" style={{ lineHeight: 1.5 }}>
                {t('ui.conflict.after')}
              </p>
              <ContinueInClaude sessionId={action.sessionId} />
              <button type="button" className="btn" disabled={action.state !== 'pending'} onClick={() => void api.skipAction(action.id).then(() => go({ name: 'actions' }))}>
                {action.state === 'pending' ? (action.resolve ? t('ui.conflict.skip.handledOutside') : t('ui.conflict.skip.markHandled')) : t('ui.conflict.skip.handled')}
              </button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
