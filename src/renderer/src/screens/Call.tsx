import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Voice } from '../../../shared/types';
import type { Screen } from '../App';
import { AgentActivity } from '../AgentActivity';
import { api, clock, errorText, shortRef } from '../api';
import { transcribeAudio, type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { ReplayButton } from './Bubble';
import { ContinueInClaude } from './ContinueInClaude';
import { FixHeard } from './FixHeard';
import { SquadScope } from './cycle/SquadPicker';
import { BackIcon, ClockIcon, MicIcon, NextIcon, StopIcon } from './icons';
import { Presence } from './Avatar';
import { tv, useT, useVoiceEnabled } from '../i18n';
import { clockOf } from '../../../shared/sameDay';
import { CATALOGS, getLanguage, voiceEnabled } from '../../../shared/i18n';
import { useDay } from '../minutesApi';
import { versionTitle } from './MinutesParts';

type Phase = 'intro' | 'preparing' | 'speaking' | 'idle' | 'listening' | 'transcribing' | 'thinking' | 'ended';

const MODERATOR_COLOR = 'var(--ink)';
const ME_COLOR = 'var(--blue)';
// The id the player and Gate use for the moderator's voice; never shown (NowPlaying names it).
const MODERATOR = 'Moderador'; // i18n-ignore: speaker id
const PANEL_STYLE = { display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 4px' } as const; // i18n-ignore: CSS value
const EFFECT_BORDER = '1px solid var(--line-2)'; // i18n-ignore: CSS value
const GLOW = '0 0 0 6px var(--glow)'; // i18n-ignore: CSS value

// The log keeps the speaker's name as it was written when the line was said, so a line is recognized in either language.
const WHO_MODERATOR = 'ui.call.who.moderator';
const WHO_ME = 'ui.call.who.me';
const isWho = (who: string, key: string): boolean => who === CATALOGS['pt-BR'][key] || who === CATALOGS.en[key];

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, '').trim();
}

export function Call({ ceremony: c, player, go }: { ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const t = useT();
  const cards = c.cards?.cards ?? [];
  const idx = c.callIdx;
  const card = idx >= 0 ? cards[idx] : null;
  const turn = card ? c.turns[card.ref] : undefined;
  const [phase, setPhase] = useState<Phase>(c.callEnded ? 'ended' : idx >= 0 ? 'idle' : 'intro');
  const [turnStart, setTurnStart] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // follow-up replies the agent offered after the last answer, per card
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});
  const voiceOn = useVoiceEnabled();
  const date = c.snapshot.id.slice(0, 10);
  const { day } = useDay(date, c.startedAt);
  const versionN = day?.versions.find((v) => v.ceremonyId === c.snapshot.id)?.n ?? null;
  const rec = useRecorder(() => void talkRef.current());
  const runId = useRef(0);
  const latest = useRef(c);
  latest.current = c;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Moderator opening, once per ceremony.
  useEffect(() => {
    if (idx >= 0 || c.callEnded) return;
    const id = ++runId.current;
    c.start();
    const blocked = cards.filter((x) => x.blockers.length).length;
    const left = latest.current.cards?.rest?.length ?? 0;
    const text = [tv('call.opening', { total: cards.length, blocked }), left ? t('ui.call.leftOut', { count: left }) : ''].filter(Boolean).join(' ');
    void (async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (runId.current !== id) return;
      latest.current.addLog(t(WHO_MODERATOR), text, MODERATOR_COLOR);
      if (latest.current.voices) await player.say(text, latest.current.voices.moderator, MODERATOR).catch(() => undefined);
      if (runId.current === id) latest.current.setCallIdx(0);
    })();
  }, []);

  // Each agent speaks once when its turn arrives.
  useEffect(() => {
    if (!card || c.callEnded) return;
    setHint(null);
    setError(null);
    if (latest.current.spoken[card.ref]) {
      setPhase('idle');
      return;
    }
    const id = ++runId.current;
    setTurnStart(Date.now());
    setPhase('preparing');
    void (async () => {
      let got: Awaited<ReturnType<Ceremony['getTurn']>>;
      try {
        got = await latest.current.getTurn(card);
      } catch (e) {
        if (runId.current === id) {
          setError(t('ui.call.agentFailed', { iid: card.iid, error: errorText(e) }));
          setPhase('idle');
        }
        return;
      }
      if (runId.current !== id) return;
      const cc = latest.current;
      cc.markSpoken(card.ref);
      cc.addLog(`#${card.iid}`, got.speech, cc.colorOf(card.ref));
      setTurnStart(Date.now());
      setPhase('speaking');
      const voice = cc.voiceOf(card.ref);
      if (voice) await player.say(got.speech, voice, card.ref).catch(() => undefined);
      if (runId.current === id) setPhase('idle');
    })();
  }, [card?.ref]);

  const finish = useCallback(async () => {
    runId.current++;
    player.stop();
    const cc = latest.current;
    cc.end();
    setPhase('ended');
    const text = t('ui.call.closing', { decisions: t('ui.call.count.decision', { count: cc.decisions.length }), actions: t('ui.call.count.action', { count: cc.effects.length }) });
    cc.addLog(t(WHO_MODERATOR), text, MODERATOR_COLOR);
    if (cc.voices) await player.say(text, cc.voices.moderator, MODERATOR).catch(() => undefined);
  }, [player, t]);

  // A card that did not change got a short turn; "aprofundar mesmo assim" asks the agent anyway, still told what was said before.
  const deepenSame = useCallback(async () => {
    if (!card) return;
    setError(null);
    runId.current++;
    const id = runId.current;
    player.stop();
    setPhase('preparing');
    try {
      const cc = latest.current;
      const t2 = await cc.getTurn(card, { deepen: true });
      if (runId.current !== id) return;
      cc.addLog(`#${card.iid}`, t2.speech, cc.colorOf(card.ref));
      setTurnStart(Date.now());
      setPhase('speaking');
      const voice = cc.voiceOf(card.ref);
      if (voice) await player.say(t2.speech, voice, card.ref).catch(() => undefined);
    } catch (e) {
      setError(t('ui.call.agentFailed', { iid: card.iid, error: errorText(e) }));
    }
    if (runId.current === id) setPhase('idle');
  }, [card, player]);

  const next = useCallback(() => {
    runId.current++;
    player.stop();
    if (idx >= cards.length - 1) void finish();
    else latest.current.setCallIdx(idx + 1);
  }, [idx, cards.length, finish, player]);

  const talk = useCallback(async () => {
    setHint(null);
    setError(null);
    if (player.speaking) player.stop();
    if (!rec.recording) {
      try {
        await rec.start();
        setPhase('listening');
      } catch (e) {
        setError(t('ui.voice.micUnavailable', { error: errorText(e) }));
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio) return;
    setPhase('transcribing');
    let text = '';
    try {
      text = await transcribeAudio(audio);
    } catch (e) {
      setError(t('ui.voice.transcribeFailed', { error: errorText(e) }));
      setPhase('idle');
      return;
    }
    if (!text) {
      setHint(t('ui.call.notUnderstood'));
      setPhase('idle');
      return;
    }
    await sendRef.current(text);
  }, [rec, player, t]);

  // Spoken, typed or tapped: every answer takes the same way.
  const send = useCallback(async (text: string) => {
    setHint(null);
    setError(null);
    if (player.speaking) player.stop();
    const cc = latest.current;
    cc.addLog(t(WHO_ME), text, ME_COLOR);
    const cmd = normalize(text);
    if (/^(proximo|pula|passa|segue|next|skip)\b/.test(cmd)) return next();
    if (/\b(encerra|encerrar|termina|terminar|finish|wrap up)\b|^end\b/.test(cmd)) return void finish();
    if (card && /\b(aprofunda|aprofundar|desbloqueio|desbloquear|deepen|unblock)\b/.test(cmd)) return go({ name: 'deep', ref: card.ref, back: 'call' });
    if (!card || !turn) {
      setPhase('idle');
      return;
    }
    setPhase('thinking');
    try {
      const r = await api.reply(card, turn, text);
      cc.addLog(`#${card.iid}`, r.ack, cc.colorOf(card.ref));
      if (r.decision) cc.addDecision(r.decision);
      if (r.priority) cc.addDecision(r.priority);
      if (r.effect) cc.addEffect(r.effect);
      cc.markAnswered(card.ref);
      setFollowUps((f) => ({ ...f, [card.ref]: r.options ?? [] }));
      if (r.needsDeepDive) setHint(t('ui.call.deepenHint'));
      setPhase('speaking');
      const voice = cc.voiceOf(card.ref);
      if (voice) await player.say(r.ack, voice, card.ref).catch(() => undefined);
    } catch (e) {
      setError(t('ui.call.replyFailed', { error: errorText(e) }));
    }
    setPhase('idle');
  }, [card, turn, player, next, finish, go, t]);
  const sendRef = useRef(send);
  sendRef.current = send;

  const offers = card ? (followUps[card.ref] ?? turn?.options ?? []) : [];
  const submitDraft = () => {
    const text = draft.trim();
    if (!text || phase === 'transcribing' || phase === 'thinking' || rec.recording) return;
    setDraft('');
    void send(text);
  };

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

  const secs = Math.floor((now - turnStart) / 1000);
  const over = secs > 30;
  const busy = phase === 'transcribing' || phase === 'thinking';
  const speakingWho = player.speaking;
  const leftOut = c.cards?.rest ?? [];
  const pending = cards
    .slice(0, idx + 1)
    .filter((x) => c.turns[x.ref]?.question && !c.answered[x.ref])
    .map((x) => ({ ref: x.ref, iid: x.iid, question: c.turns[x.ref]?.question as string }));
  const speakerLabel =
    phase === 'listening' ? t('ui.call.speaker.listening') :
    phase === 'transcribing' ? t('ui.voice.transcribing') :
    phase === 'thinking' ? t('ui.call.speaker.thinking') :
    phase === 'preparing' ? t('ui.call.speaker.preparing') :
    speakingWho === MODERATOR ? t('ui.call.speaker.moderator') :
    speakingWho ? t('ui.call.speaker.agent', { iid: cards.find((x) => x.ref === speakingWho)?.iid ?? card?.iid ?? '' }) : t('ui.call.speaker.waiting');
  const whoLabel = (who: string) => (isWho(who, WHO_MODERATOR) ? t(WHO_MODERATOR) : isWho(who, WHO_ME) ? t(WHO_ME) : who);

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.call.backToToday')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t('ui.call.title')}</h1>
            {versionN !== null && <span className="pill">{versionTitle(versionN, date)}</span>}
            {c.squad ? <SquadScope squad={c.squad} /> : null}
            <span className="pill" style={{ background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-ink)', borderColor: 'var(--chip-teal-bg)', fontWeight: 600 }}>
              <span className="live-dot" />{phase === 'ended' ? t('ui.call.ended') : t('ui.call.live')} · {clock(c.startedAt ?? now, now)}
            </span>
            <span className="muted small">{phase === 'ended' ? t('ui.call.agendaDone') : idx >= 0 ? t('ui.call.progress', { n: idx + 1, total: cards.length }) : t('ui.call.opening')}</span>
          </div>
          <button type="button" className="btn btn-red" onClick={() => { if (phase !== 'ended') c.end(); go({ name: 'ata' }); }}>
            <StopIcon /> {t('ui.call.endAndMinutes')}
          </button>
        </header>

        <div className="cols call-layout">
          <aside className="panel call-queue" style={{ flex: '1 1 240px', maxWidth: 300, minWidth: 240, gap: 6 }}>
            <h2 className="section-title" style={{ marginBottom: 8 }}>{t('ui.call.agenda')}</h2>
            {cards.map((x, i) => {
              const done = i < idx || phase === 'ended';
              const nowItem = i === idx && phase !== 'ended';
              const q = c.turns[x.ref]?.question;
              return (
                <div key={x.ref} className={`queue-item ${nowItem ? 'now' : ''} ${done ? 'done' : ''}`}>
                  <div className="chip chip-sm" style={{ background: c.colorOf(x.ref) }}>{shortRef(x.ref)}</div>
                  <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>#{x.iid}{x.priority ? ` · ${x.priority.label}` : ''}</div>
                    <div className="t">{x.title}</div>
                    {c.marks[x.ref]?.kind !== undefined && c.marks[x.ref].kind !== 'new' && c.marks[x.ref].since && (
                      <div className="small faint">{t(c.marks[x.ref].kind === 'unchanged' ? 'sameDay.mark.unchanged' : 'sameDay.mark.changed', { time: clockOf(c.marks[x.ref].since as string, getLanguage()) })}</div>
                    )}
                  </div>
                  <span className={`badge ${nowItem ? 'badge-now' : q && !done ? 'badge-ask' : 'badge-quiet'}`} style={{ fontSize: 11 }}>
                    {nowItem ? t('ui.call.queue.now') : done ? t('ui.call.queue.done') : q ? t('ui.call.queue.question') : t('ui.call.queue.queued')}
                  </span>
                </div>
              );
            })}
            {leftOut.length > 0 && (
              <>
                <h2 className="section-title" style={{ marginTop: 14, marginBottom: 2 }}>{t('ui.call.leftOutTitle', { n: leftOut.length })}</h2>
                <p className="small faint">{t('ui.call.leftOutHint')}</p>
                {leftOut.map((x) => (
                  <div key={x.ref} className="queue-item">
                    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>#{x.iid}{x.priority ? ` · ${x.priority.label}` : ''}</div>
                      <div className="t">{x.title}</div>
                    </div>
                    <button type="button" className="btn" aria-label={t('ui.call.bringInLabel', { iid: x.iid })} disabled={phase === 'ended' || phase === 'intro'} onClick={() => c.bringIn(x.ref)}>
                      {t('ui.call.bringIn')}
                    </button>
                  </div>
                ))}
              </>
            )}
          </aside>

          <main className="call-main" style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel-dark hero">
              {phase === 'ended' ? (
                <div style={PANEL_STYLE}>
                  <div className="small" style={{ color: 'var(--night-teal)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('ui.call.endOfAgenda')}</div>
                  <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.3 }}>
                    {t('ui.call.endedSummary', { decisions: t('ui.call.count.decision', { count: c.decisions.length }), effects: t('ui.call.count.effect', { count: c.effects.length }), questions: t('ui.call.count.question', { count: c.minutes.unanswered.length }) })}
                  </div>
                  {leftOut.length > 0 && <div className="small" style={{ color: 'var(--on-night-muted)' }}>{t('ui.call.leftOut', { count: leftOut.length })}</div>}
                  <div><button type="button" className="btn btn-accent" onClick={() => go({ name: 'ata' })}>{t('ui.call.generateMinutes')}</button></div>
                </div>
              ) : (
                <>
                  <div className="row spread" style={{ alignItems: 'center' }}>
                    {card ? (
                      <div className="row" style={{ gap: 16, flexWrap: 'nowrap', minWidth: 0 }}>
                        <div className="chip chip-lg" style={{ background: c.colorOf(card.ref), boxShadow: speakingWho === card.ref ? GLOW : 'none' }}>
                          {shortRef(card.ref)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                            <span className="mono" style={{ color: 'var(--on-night-muted)' }}>#{card.iid}</span>
                            <span className="small" style={{ color: 'var(--on-night-muted)' }}>{[card.stage, card.spec?.phase, card.priority && t('ui.call.priority', { label: card.priority.label }), card.milestone && t('ui.call.milestone', { milestone: card.milestone })].filter(Boolean).join(' · ')}</span>
                          </div>
                          <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.25 }}>{card.title}</div>
                          <div className="small" style={{ color: 'var(--on-night-muted)', marginTop: 4 }}>
                            {[card.mrs.join(' · ') || t('ui.call.noMr'), voiceOn && t('ui.call.voiceName', { label: c.voiceOf(card.ref)?.label ?? '' })].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="row" style={{ gap: 16 }}>
                        <div className="chip chip-lg" style={{ background: 'var(--night-line)' }}>{t(WHO_MODERATOR).charAt(0)}</div>
                        <div>
                          <div className="small" style={{ color: 'var(--on-night-muted)' }}>{[t(WHO_MODERATOR), voiceOn && t('ui.call.voiceName', { label: c.voices?.moderator.label ?? '' })].filter(Boolean).join(' · ')}</div>
                          <div style={{ fontSize: 21, fontWeight: 600 }}>{t('ui.call.moderatorOpening')}</div>
                        </div>
                      </div>
                    )}
                    {card && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <span className={`timer ${over ? 'over' : ''}`}>{clock(turnStart, now)} / 0:30</span>
                        <div className={`bar ${over ? 'over' : ''}`}><div style={{ width: `${Math.min(100, (secs / 30) * 100)}%` }} /></div>
                      </div>
                    )}
                  </div>

                  <div className="row" style={{ gap: 16, minHeight: 64, flexWrap: 'nowrap' }}>
                    <Presence recording={rec.recording} thinking={phase === 'preparing' || phase === 'thinking' || phase === 'transcribing'} on={!!speakingWho || rec.recording} color={rec.recording ? 'var(--rec-blue)' : 'var(--teal-bright)'} level={rec.level} />
                    <span className={`speaker ${rec.recording ? 'me' : !speakingWho && !busy && phase !== 'preparing' ? 'idle' : ''}`}>{speakerLabel}</span>
                  </div>

                  {card && (
                    <div className="quad">
                      <div>
                        <div className="lbl">{t('ui.call.did')}</div>
                        <div>{turn?.did ?? <span className="spinner" />}</div>
                      </div>
                      <div>
                        <div className="lbl">{t('ui.call.next')}</div>
                        <div>{turn?.next ?? <span className="spinner" />}</div>
                      </div>
                      <div className={turn?.blocker ? 'block' : ''}>
                        <div className="lbl">{t('ui.call.blocker')}</div>
                        <div>{turn ? turn.blocker ?? t('ui.call.noBlocker') : <span className="spinner" />}</div>
                      </div>
                      <div className={turn?.question && !c.answered[card.ref] ? 'ask' : ''}>
                        <div className="lbl">{t('ui.call.forYou')}</div>
                        <div>{turn ? (turn.question ? (c.answered[card.ref] ? t('ui.call.answered', { question: turn.question }) : turn.question) : t('ui.call.nothingToDecide')) : <span className="spinner" />}</div>
                      </div>
                    </div>
                  )}
                  {card && !turn && <AgentActivity jobId={`prep:${card.ref}`} />}
                </>
              )}
            </section>

            {turn?.sameDay && card && (
              <div className={`item small ${turn.sameDay.kind === 'changed' || turn.sameDay.deepened ? 'ask' : ''}`} role="note">
                <span>
                  {turn.sameDay.kind === 'changed'
                    ? t('sameDay.badge.changed', { time: clockOf(turn.sameDay.since, getLanguage()), changes: turn.sameDay.changes.join('; ') })
                    : t('sameDay.badge.unchanged', { time: clockOf(turn.sameDay.since, getLanguage()) })}
                </span>
                {turn.sameDay.kind === 'unchanged' && !turn.sameDay.deepened && (
                  <span><button type="button" className="btn" disabled={busy || phase === 'preparing'} onClick={() => void deepenSame()}>{t('sameDay.deepen')}</button></span>
                )}
              </div>
            )}
            {card && c.decisions.filter((d) => d.target === 'priority' && d.ref === card.ref).slice(-1).map((d) => (
              <div key={d.text} className="item small" role="status">
                <div>{d.text}</div>
                <div className="dest">→ {d.dest}</div>
              </div>
            ))}
            {hint && <div className="item ask small">{hint}</div>}
            {error && <div className="error">{error}</div>}

            <section className="panel" aria-live="polite" style={{ gap: 4 }}>
              <div className="row spread" style={{ marginBottom: 6 }}>
                <h2 className="section-title">{t('ui.call.transcript')}</h2>
                <span className="faint">{tv('call.transcript.note')}</span>
              </div>
              {c.log.slice(-8).map((l, i) => {
                const spoken = isWho(l.who, WHO_MODERATOR) ? { who: MODERATOR, voice: c.voices?.moderator } : (() => {
                  const x = cards.find((k) => `#${k.iid}` === l.who);
                  return x ? { who: x.ref, voice: c.voiceOf(x.ref) } : null;
                })();
                return (
                  <div key={`${l.at}-${i}`} className="log-line">
                    <span className="at">{l.at}</span>
                    <span className="who" style={{ '--c': l.color } as CSSProperties}>{whoLabel(l.who)}</span>
                    <span className="text">{l.text}{isWho(l.who, WHO_ME) && <FixHeard text={l.text} />}</span>
                    {voiceOn && spoken?.voice && (
                      <ReplayButton
                        playing={player.speaking === spoken.who && player.current === l}
                        label={t('ui.call.replay', { who: whoLabel(l.who) })}
                        onPlay={() => void player.say(l.text, spoken.voice as Voice, spoken.who, { force: true, item: l }).catch(() => undefined)}
                        onStop={() => player.stop()}
                      />
                    )}
                  </div>
                );
              })}
            </section>

            {phase !== 'ended' && (
              <div className="row composer call-controls" style={{ flexWrap: 'wrap' }} role="group" aria-label={tv('call.controls')}>
                {card && offers.length > 0 && (
                  <div className="call-offers" role="group" aria-label={t('ui.call.offersLabel')}>
                    <span className="small muted">{t('ui.call.offersTitle')}</span>
                    {offers.map((o) => (
                      <button key={o} type="button" className="btn call-offer" disabled={busy || rec.recording || phase === 'intro'} onClick={() => void send(o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  className="call-text"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitDraft();
                  }}
                >
                  <input
                    className="text-input"
                    placeholder={card ? tv('call.input.placeholder') : tv('call.input.placeholder.intro')}
                    aria-label={t('ui.call.textAnswer')}
                    value={draft}
                    disabled={phase === 'intro'}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button type="submit" className="btn btn-dark" aria-label={t('ui.call.send')} disabled={!draft.trim() || busy || rec.recording || phase === 'intro'}>
                    <span className="lbl">{t('ui.call.send')}</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="send-icon"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                </form>
                {voiceOn && (
                  <>
                    <button type="button" className={`btn ${rec.recording ? 'btn-rec' : 'btn-blue'}`} disabled={busy || phase === 'intro'} onClick={() => void talk()}>
                      <MicIcon />
                      <span className="lbl">{rec.recording ? t('ui.call.sendSpeechSpace') : phase === 'transcribing' ? t('ui.voice.transcribing') : phase === 'thinking' ? t('ui.call.thinking') : t('ui.voice.speakSpace')}</span>
                    </button>
                    <button type="button" className="btn" disabled={!speakingWho} onClick={() => player.stop()}>{t('ui.call.interrupt')}</button>
                  </>
                )}
                <button type="button" className="btn btn-amber" disabled={!card} onClick={() => card && go({ name: 'deep', ref: card.ref, back: 'call' })}>{t('ui.call.deepen')}</button>
                <ContinueInClaude sessionId={turn?.sessionId} />
                <span className="grow" />
                <button type="button" className="btn btn-dark" disabled={phase === 'intro' || busy || rec.recording} onClick={next}>
                  {idx >= cards.length - 1 ? t('ui.call.closeAgenda') : t('ui.call.nextAgent')} <NextIcon />
                </button>
              </div>
            )}
          </main>

          <aside className="call-side" style={{ flex: '1 1 300px', maxWidth: 360, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel">
              <h2 className="section-title">{t('ui.call.pending', { n: pending.length })}</h2>
              {!pending.length && <p className="small faint">{t('ui.call.noPending')}</p>}
              {pending.map((p) => (
                <div key={p.ref} className="item ask">
                  <div className="mono" style={{ fontSize: 12, color: 'var(--blue-ink)' }}>#{p.iid}</div>
                  <div className="small">{p.question}</div>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2 className="section-title">{t('ui.call.decisions', { n: c.decisions.length })}</h2>
              {!c.decisions.length && <p className="small faint">{t('ui.call.decisionsEmpty')}</p>}
              {c.decisions.map((d, i) => (
                <div key={`${d.ref}-${i}`} className="item">
                  <div className="small">{d.text}</div>
                  <div className="dest">→ {d.dest}</div>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="row spread">
                <h2 className="section-title">{t('ui.call.effectsQueue', { n: c.effects.length })}</h2>
                {/* i18n-ignore-next-line: effect level code */}
                <span className="badge-e3">E3</span>
              </div>
              {c.effects.map((e, i) => (
                <div key={`${e.ref}-${i}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', padding: '10px 0', borderTop: EFFECT_BORDER }}>
                  <ClockIcon />
                  <div>
                    <div className="small">{e.text}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{e.repo} · {e.ref}</div>
                  </div>
                </div>
              ))}
              <p className="faint" style={{ fontSize: 12, lineHeight: 1.45 }}>{tv('call.effectsNote')}</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
