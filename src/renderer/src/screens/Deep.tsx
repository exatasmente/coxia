import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { destination } from '../../../shared/destination';
import type { Card, DeepAnswer, DeepState } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText, shortRef } from '../api';
import { transcribeAudio, type usePlayer, useRecorder } from '../audio';
import { type Ceremony, EMPTY_DEEP } from '../ceremony';
import { destinationLabels, useCycle } from '../cycleApi';
import { busyText, jobs, useJobs } from '../useJobs';
import { AgentActivity } from '../AgentActivity';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { ResolveConflict } from './ResolveConflict';
import { conflictMrs } from '../dashboard';
import { intlLocale, useT, useVoiceEnabled } from '../i18n';
import { voiceEnabled } from '../../../shared/i18n';

const HEADER_STYLE: CSSProperties = { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }; // i18n-ignore: CSS value
const MAIN_STYLE: CSSProperties = { flex: '3 1 480px', minWidth: 0, padding: '18px 20px', gap: 14 }; // i18n-ignore: CSS value
const SAVED_BORDER = '2px solid var(--teal)'; // i18n-ignore: CSS value

function now(): string {
  return new Date().toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function Deep({
  ceremony: c,
  player,
  go,
  refName,
  back,
  passedCard,
}: {
  ceremony: Ceremony;
  player: ReturnType<typeof usePlayer>;
  go: (s: Screen) => void;
  refName: string;
  back: 'today' | 'call';
  passedCard?: Card;
}) {
  const t = useT();
  const card = c.cards?.cards.find((x) => x.ref === refName) ?? passedCard;
  const cycle = useCycle();
  const { sessionId, msgs, sources, options, pick, saved } = c.deep[refName] ?? EMPTY_DEEP;
  const { updateDeep } = c;
  const update = useCallback((change: (d: DeepState) => DeepState) => updateDeep(refName, change), [updateDeep, refName]);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const voiceOn = useVoiceEnabled();
  const rec = useRecorder(() => void talkRef.current());
  const opened = useRef(false);
  const session = useRef(sessionId);
  session.current = sessionId;

  // The answer is written into the ceremony store by the job itself, so it lands even if this screen is gone by then.
  const ask = useCallback(
    (question: string, shown = true) => {
      if (!card) return;
      const key = `deep:${card.ref}:ask`;
      if (jobs.get(key)?.status === 'running') return;
      setError(null);
      if (shown) update((d) => ({ ...d, msgs: [...d.msgs, { me: true, text: question, at: now() }] }));
      jobs.launch(key, { label: t('ui.deep.job.ask', { iid: card.iid }), busy: t('ui.deep.busy.ask'), screen: { name: 'deep', ref: card.ref, back, card } }, async () => {
        const r = await api.deepAsk(card, question, session.current);
        update((d) => ({
          ...d,
          sessionId: r.sessionId,
          sources: [...new Set([...d.sources, ...r.sources])],
          msgs: [...d.msgs, { me: false, text: r.text, speech: r.speech, at: now(), ...(r.partial ? { partial: true } : {}) }],
        }));
        return r;
      });
    },
    [card, update, back, t],
  );

  // A conversation already on disk is resumed as is; only a new one starts with the opening question.
  useEffect(() => {
    if (opened.current || !card) return;
    opened.current = true;
    if (!msgs.length && !sessionId && !jobs.get(`deep:${card.ref}:ask`)) ask(t('ui.deep.opening'), false);
  }, [card, ask, msgs.length, sessionId]);

  const running = useJobs<DeepAnswer>(`deep:${refName}:`, {
    done: (r, job, late) => {
      const voice = c.voiceOf(refName);
      if (!late && job.key.endsWith(':ask') && voice) void player.say(r.speech, voice, refName).catch(() => undefined);
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
        setError(t('ui.voice.micUnavailable', { error: errorText(e) }));
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio) return;
    setBusy(t('ui.voice.transcribing'));
    try {
      const text = await transcribeAudio(audio);
      setBusy(null);
      if (text) await ask(text);
    } catch (e) {
      setBusy(null);
      setError(t('ui.voice.transcribeFailed', { error: errorText(e) }));
    }
  }, [rec, player, ask, t]);

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

  const propose = () => {
    if (!card || !sessionId) return;
    setError(null);
    jobs.launch(`deep:${card.ref}:options`, { label: t('ui.deep.job.options', { iid: card.iid }), busy: t('ui.deep.busy.options'), screen: { name: 'deep', ref: card.ref, back, card } }, async () => {
      const opts = await api.deepOptions(card, sessionId);
      update((d) => ({ ...d, options: opts, pick: Math.max(0, opts.findIndex((o) => o.recommended)), saved: false }));
      return opts;
    });
  };

  if (!card) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="error">{t('ui.deep.notFound', { ref: refName })}</div>
          <div><button type="button" className="btn" onClick={() => go({ name: back })}>{t('ui.deep.back')}</button></div>
        </div>
      </div>
    );
  }

  const chosen = pick !== null && options ? options[pick] : null;
  const target = card.spec?.planFile ? 'spec' : 'ata';

  const keep = () => {
    if (!chosen) return;
    c.addDecision({ ref: card.ref, text: chosen.decision, target, dest: destination(card, target, destinationLabels(cycle)) });
    if (chosen.effect) c.addEffect({ ref: card.ref, text: chosen.effect, repo: card.mrs[0]?.split(/[!#]/)[0] ?? card.ref.split('#')[0] });
    c.markAnswered(card.ref);
    update((d) => ({ ...d, saved: true }));
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="panel-dark hero" style={HEADER_STYLE}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.deep.back')} onClick={() => go({ name: back })}>
            <BackIcon />
          </button>
          <div className="chip" style={{ width: 48, height: 48, borderRadius: 14, fontSize: 18, background: c.colorOf(card.ref) }}>{shortRef(card.ref)}</div>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-amber)', fontWeight: 600 }}>{t('ui.deep.title', { iid: card.iid })}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={rec.recording} thinking={!!busy} on={!!player.speaking || rec.recording} color={rec.recording ? 'var(--rec-blue)' : 'var(--night-orange)'} level={rec.level} small />
          {voiceOn && (
            <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy} onClick={() => void talk()}>
              <MicIcon /> {rec.recording ? t('ui.deep.sendSpeech') : t('ui.voice.speakSpace')}
            </button>
          )}
          <ContinueInClaude sessionId={sessionId} dark />
          <button type="button" className="btn btn-red" onClick={() => go({ name: back })}>{t('ui.deep.end')}</button>
        </header>

        <div className="cols deep-layout">
          <aside className="panel deep-sources" style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 250, gap: 12 }}>
            <h2 className="section-title">{t('ui.deep.read')}</h2>
            {card.blockers.map((b) => (
              <div key={b} className="item" style={{ borderColor: 'var(--red-line)', background: 'var(--red-faint)' }}>
                <div className="small" style={{ color: 'var(--red-ink)' }}>{b}</div>
              </div>
            ))}
            {card.spec && (
              <div className="item">
                <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{card.spec.folder.replace(/^.*\/\.specs\//, '.specs/')}</div>
                <div className="small muted">{card.spec.phase}</div>
              </div>
            )}
            {sources.map((s) => (
              <div key={s} className="item">
                <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{s.replace(/^\/home\/[^/]+\/projects\//, '')}</div>
              </div>
            ))}
            {!sources.length && <p className="faint">{t('ui.deep.readEmpty')}</p>}
          </aside>

          <main className="panel deep-main" style={MAIN_STYLE} aria-live="polite">
            <div className="row spread">
              <h2 className="section-title">{t('ui.deep.conversation')}</h2>
              <span className="faint">{t('ui.deep.liveTranscript')}</span>
            </div>
            {msgs.map((m, i) => (
              <Bubble key={i} m={m} who={m.me ? t('ui.bubble.me') : t('ui.nowPlaying.who.agent', { iid: card.iid })} voice={c.voiceOf(card.ref)} player={player} speaker={card.ref} />
            ))}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}
            {error && <div className="error">{error}</div>}
            <form
              className="row composer"
              style={{ flexWrap: 'nowrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() && !busy) ask(draft.trim());
                setDraft('');
              }}
            >
              <input className="text-input" placeholder={t('ui.deep.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.deep.questionLabel')} />
              <button type="submit" className="btn btn-dark" disabled={!!busy || !draft.trim()}>{t('ui.deep.ask')}</button>
            </form>
          </main>

          <aside className="deep-side" style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 290, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {conflictMrs(card).length > 0 && (
              <section className="panel">
                <h2 className="section-title">{t('ui.deep.conflict')}</h2>
                <p className="small faint">{t('ui.deep.conflictNote')}</p>
                <ResolveConflict card={card} go={go} place="deep" />
              </section>
            )}
            <section className="panel">
              <h2 className="section-title">{t('ui.deep.options')}</h2>
              {!options && (
                <>
                  <p className="small faint">{t('ui.deep.optionsHint')}</p>
                  <button type="button" className="btn btn-dark" disabled={!sessionId || !!busy} onClick={() => propose()}>{t('ui.deep.propose')}</button>
                </>
              )}
              {options?.map((o, i) => (
                <button key={o.title} type="button" className={`option ${pick === i ? 'on' : ''}`} aria-pressed={pick === i} onClick={() => update((d) => ({ ...d, pick: i, saved: false }))}>
                  <span className="row spread" style={{ alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{String.fromCharCode(65 + i)}. {o.title}</span>
                    {o.recommended && <span className="badge" style={{ background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-ink)', fontSize: 11 }}>{t('ui.deep.recommended')}</span>}
                  </span>
                  <span className="small muted" style={{ display: 'block', marginTop: 6, lineHeight: 1.45 }}>{o.consequence}</span>
                  <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--red-ink)', marginTop: 6 }}>{o.effect ? `E3 · ${o.effect}` : t('ui.deep.noEffect')}</span>
                </button>
              ))}
              {options && <button type="button" className="btn" disabled={!!busy} onClick={() => propose()}>{t('ui.deep.proposeAgain')}</button>}
            </section>
            {chosen && (
              <section className="panel" style={{ border: saved ? SAVED_BORDER : undefined }}>
                <h2 className="section-title">{t('ui.deep.goesToMinutes')}</h2>
                <div className="small" style={{ lineHeight: 1.5 }}>{chosen.decision}</div>
                <div className="dest">→ {destination(card, target, destinationLabels(cycle))}</div>
                <button type="button" className={`btn ${saved ? 'btn-on' : 'btn-dark'}`} disabled={saved} onClick={keep}>
                  {saved ? t('ui.deep.inMinutes') : t('ui.deep.addToMinutes')}
                </button>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
