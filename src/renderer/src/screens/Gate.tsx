import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Card, GateOption, GateView } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { transcribeAudio, type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { AgentActivity } from '../AgentActivity';
import { Bubble } from './Bubble';
import { FixHeard } from './FixHeard';
import { ContinueInClaude } from './ContinueInClaude';
import { Diagram } from './Diagram';
import { BackIcon, MicIcon } from './icons';
import { Presence } from './Avatar';
import { useT, useTv, useVoiceEnabled } from '../i18n';
import { type Translate, voiceEnabled } from '../../../shared/i18n';

const LETTERS = ['A', 'B', 'C', 'D'];

const HEADER_STYLE: CSSProperties = { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }; // i18n-ignore: CSS value
const ACTIVE_BORDER = '2px solid var(--blue)'; // i18n-ignore: CSS value
const OPTIONS_GRID = 'repeat(auto-fit, minmax(240px, 1fr))'; // i18n-ignore: CSS value
const DIVIDER = '1px solid var(--line-2)'; // i18n-ignore: CSS value

const RESUME_MS = 12 * 3600_000;
const resumeKey = (ref: string): string => `cerimonias.gate.${ref}`;

// A quiz in progress is picked up again when the screen is reopened; a recorded one is done.
function rememberGate(ref: string, gate: GateView): void {
  try {
    if (gate.recorded) localStorage.removeItem(resumeKey(ref));
    else localStorage.setItem(resumeKey(ref), JSON.stringify({ id: gate.id, at: Date.now() }));
  } catch {}
}

function rememberedGate(ref: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(resumeKey(ref)) ?? 'null') as { id?: unknown; at?: unknown } | null;
    return saved && typeof saved.id === 'string' && typeof saved.at === 'number' && Date.now() - saved.at < RESUME_MS ? saved.id : null;
  } catch {
    return null;
  }
}

function spokenQuestion(t: Translate, n: number, text: string, options: string[]): string {
  return t('ui.gate.spoken.question', { n, text, options: options.map((o, i) => `${LETTERS[i]}: ${o}.`).join(' ') });
}

export function Gate({
  card,
  ceremony: c,
  player,
  go,
}: { card: Card | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [options, setOptions] = useState<GateOption[] | null>(null);
  const [gate, setGate] = useState<GateView | null>(null);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmInsert, setConfirmInsert] = useState(false);
  const t = useT();
  const tv = useTv();
  const voiceOn = useVoiceEnabled();
  const rec = useRecorder(() => void talkRef.current());
  const spokenFor = useRef<string | null>(null);
  const voice = c.voices?.moderator ?? null;

  useEffect(() => {
    if (card) api.gateOptions(card).then(setOptions, (e) => setError(errorText(e)));
  }, [card]);

  // The quiz lives in main: the finished job is applied as it would have been, and what main saved is read back for the rest.
  const running = useJobs<GateView>(card ? `gate:${card.ref}:` : null, {
    done: (view) => {
      if (card) rememberGate(card.ref, view);
      setGate(view);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running, localBusy);
  const ref = card?.ref;
  useEffect(() => {
    const id = ref ? rememberedGate(ref) : null;
    if (id) void api.getGate(id).then((g) => g && setGate((prev) => prev ?? g), () => undefined);
  }, [ref]);

  const round = gate ? gate.rounds[gate.rounds.length - 1] : null;
  const current = round ? round.questions.findIndex((q) => !q.answer) : -1;
  const roundDone = !!round && current < 0;

  // Reads the summary once, then each question as it comes up.
  useEffect(() => {
    if (!gate || !round || !voice) return;
    const key = `${gate.id}:${gate.rounds.length}:${current}`;
    if (spokenFor.current === key) return;
    spokenFor.current = key;
    const parts: string[] = [];
    if (gate.rounds.length === 1 && current === 0) parts.push(gate.summary);
    if (current >= 0) parts.push(spokenQuestion(t, current + 1, round.questions[current].text, round.questions[current].options));
    else parts.push(round.verdict === 'assertivo' ? t('ui.gate.spoken.assertive') : t('ui.gate.spoken.notAssertive'));
    void player.say(parts.join(' '), voice, 'Moderador').catch(() => undefined); // i18n-ignore: speaker id
  }, [gate, round, current, voice, player]);

  const act = (op: string, label: string, busyLabel: string, fn: () => Promise<GateView>) => {
    if (!card) return;
    setError(null);
    jobs.launch(`gate:${card.ref}:${op}`, { label, busy: busyLabel, screen: { name: 'gate', ref: card.ref, card } }, fn);
  };

  const answer = useCallback(
    (input: { choice?: number; text?: string }) => {
      if (!gate || current < 0) return;
      player.stop();
      act(`answer:${gate.rounds.length}:${current}`, t('ui.gate.job.answer', { iid: card?.iid ?? '' }), input.text ? t('ui.gate.busy.assess') : t('ui.gate.busy.register'), () => api.answerGate(gate.id, current, input));
    },
    [gate, current, player, card],
  );

  const talk = useCallback(async () => {
    if (player.speaking) player.stop();
    if (!rec.recording) {
      try {
        await rec.start();
      } catch (e) {
        setError(t('ui.gate.error.mic', { error: errorText(e) }));
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio || !gate) return;
    setBusy(t('ui.gate.busy.transcribing'));
    try {
      const text = await transcribeAudio(audio);
      setBusy(null);
      if (!text) return;
      if (!roundDone) answer({ text });
      else act('explain', t('ui.gate.job.explain', { iid: card?.iid ?? '' }), t('ui.gate.busy.read'), () => api.explainGate(gate.id, text));
    } catch (e) {
      setBusy(null);
      setError(t('ui.gate.error.transcription', { error: errorText(e) }));
    }
  }, [rec, player, gate, roundDone, answer]);

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

  if (!card) {
    return (
      <div className="page"><div className="wrap">
        <div className="error">{t('ui.gate.notFound')}</div>
        <div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>{t('ui.gate.back')}</button></div>
      </div></div>
    );
  }

  const lastAfterTwo = gate && gate.rounds.length >= 2 && round?.verdict === 'não assertivo';

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark hero" style={HEADER_STYLE}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.gate.back')} onClick={() => go({ name: 'today' })}>
            <BackIcon />
          </button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-blue)', fontWeight: 600 }}>
              {gate ? t('ui.gate.header.gate', { gate: gate.gate, label: gate.label, round: gate.rounds.length }) : t('ui.gate.header.quiz')} · #{card.iid}
            </div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={rec.recording} thinking={!!busy} on={!!player.speaking || rec.recording} color={rec.recording ? 'var(--rec-blue)' : 'var(--night-blue)'} level={rec.level} small />
          {gate && voiceOn && (
            <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy} onClick={() => void talk()}>
              <MicIcon /> {rec.recording ? t('ui.gate.mic.send') : roundDone ? t('ui.gate.mic.ask') : t('ui.gate.mic.answer')}
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}

        {!gate && (
          <section className="panel" style={{ padding: 20, gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.gate.pick.title')}</h2>
            <p className="small muted">{t('ui.gate.pick.intro')}</p>
            {!options && <span className="spinner" />}
            {options?.length === 0 && <p className="small faint">{t('ui.gate.empty')}</p>}
            <div className="row">
              {options?.map((o) => (
                <button key={o.gate} type="button" className="btn btn-dark" disabled={!!busy} onClick={() => act(`start:${o.gate}`, t('ui.gate.job.start', { gate: o.gate, iid: card.iid }), t('ui.gate.busy.start'), () => api.startGate(card, o.gate))}>
                  {t('ui.gate.pick.option', { gate: o.gate, label: o.label })}
                </button>
              ))}
            </div>
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}
          </section>
        )}

        {gate && round && (
          <>
            <section className="panel" style={{ padding: 20, gap: 8 }}>
              <h2 className="section-title">{t('ui.gate.summary')}</h2>
              <p style={{ lineHeight: 1.6 }}>{gate.summary}</p>
              <span className="mono faint" style={{ wordBreak: 'break-all' }}>{gate.artifact.replace(/^.*\/\.specs\//, '.specs/')}</span>
            </section>

            {round.questions.map((q, i) => {
              const active = i === current;
              return (
                <section key={`${gate.rounds.length}-${i}`} className="panel" style={{ padding: 20, gap: 10, border: active ? ACTIVE_BORDER : undefined, opacity: !q.answer && !active ? 0.6 : 1 }}>
                  <div className="row spread">
                    <span className="section-title">{t('ui.gate.question.title', { n: i + 1, kind: q.kind })}</span>
                    {roundDone && q.answer && (
                      <span className={`badge ${q.answer.correct ? 'badge-now' : 'badge-block'}`}>{q.answer.correct ? t('ui.gate.question.correct') : t('ui.gate.question.wrong')}</span>
                    )}
                    {!roundDone && q.answer && <span className="badge badge-quiet">{t('ui.gate.question.answered')}</span>}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4 }}>{q.text}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: OPTIONS_GRID, gap: 8 }}>
                    {q.options.map((o, oi) => {
                      const chosen = q.answer?.choice === oi;
                      const right = roundDone && q.correct === oi;
                      return (
                        <button
                          key={oi}
                          type="button"
                          className={`option ${chosen ? 'on' : ''}`}
                          disabled={!active || !!busy}
                          onClick={() => answer({ choice: oi })}
                          style={right ? { borderColor: 'var(--teal)', borderWidth: 2 } : chosen && roundDone ? { borderColor: 'var(--red)', borderWidth: 2, background: 'var(--red-faint)' } : undefined}
                        >
                          <span style={{ fontWeight: 600 }}>{LETTERS[oi]})</span> {o}
                        </button>
                      );
                    })}
                  </div>
                  {q.answer?.other && <div className="item"><span className="small">{t('ui.gate.yourAnswer', { answer: q.answer.other })}</span><FixHeard text={q.answer.other} />{q.answer.comment && <span className="small muted">{q.answer.comment}</span>}</div>}
                  {roundDone && q.explanation && (
                    <div className="item" style={{ background: q.answer?.correct ? 'var(--teal-soft)' : 'var(--amber-soft)', borderColor: q.answer?.correct ? 'var(--teal-line)' : 'var(--amber-line)' }}>
                      <span className="small">{q.explanation}</span>
                      <span className="dest">→ {q.section}</span>
                    </div>
                  )}
                  {active && (
                    <form className="row composer" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) answer({ text: draft.trim() }); setDraft(''); }}>
                      <input className="text-input" placeholder={t('ui.gate.free.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.gate.free.aria')} />
                      <button type="submit" className="btn" disabled={!draft.trim() || !!busy}>{t('ui.gate.free.submit')}</button>
                    </form>
                  )}
                </section>
              );
            })}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}

            {roundDone && (
              <section className="panel" style={{ padding: 20, gap: 12, borderColor: round.verdict === 'assertivo' ? 'var(--teal-line)' : 'var(--amber-line)' }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>{round.verdict === 'assertivo' ? t('ui.gate.verdict.assertive') : t('ui.gate.consolidation.title')}</h2>
                {round.verdict === 'assertivo' ? (
                  <p className="small" style={{ lineHeight: 1.5 }}>
                    {t('ui.gate.verdict.assertive.intro', { phrase: gate.gate === 1 ? t('ui.gate.verdict.phrase.gate1') : t('ui.gate.verdict.phrase.gate2') })}
                  </p>
                ) : (
                  <>
                    <p className="small" style={{ lineHeight: 1.5 }}>
                      {t('ui.gate.consolidation.intro', { ask: tv('gate.assisted.ask') })}
                    </p>
                    {gate.talk.map((m, i) => (
                      <Bubble key={i} m={m} who={m.me ? t('ui.gate.who.you') : t('ui.gate.who.agent')} voice={voice} player={player} speaker="gate" />
                    ))}
                    <form className="row composer" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) act('explain', t('ui.gate.job.explain', { iid: card.iid }), t('ui.gate.busy.read'), () => api.explainGate(gate.id, draft.trim())); setDraft(''); }}>
                      <input className="text-input" placeholder={t('ui.gate.explain.draftPlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.gate.explain.aria')} />
                      <button type="submit" className="btn" disabled={!draft.trim() || !!busy}>{t('ui.gate.explain.submit')}</button>
                    </form>
                    {round.visual ? (
                      <div className="item">
                        <span className="small">{round.visual.description} → <span className="mono">{round.visual.heading}</span></span>
                        <Diagram code={round.visual.mermaid} title={round.visual.description} />
                        {round.visual.inserted ? (
                          <span className="small" style={{ color: 'var(--teal-ink)' }}>{t('ui.gate.inserted')}</span>
                        ) : confirmInsert ? (
                          <div className="row">
                            <button type="button" className="btn btn-red" disabled={!!busy} onClick={() => { setConfirmInsert(false); act('insert', t('ui.gate.job.insert', { iid: card.iid }), t('ui.gate.busy.insert'), () => api.insertGateVisual(gate.id)); }}>{t('ui.gate.confirmInsert', { label: gate.label })}</button>
                            <button type="button" className="btn" onClick={() => setConfirmInsert(false)}>{t('ui.gate.cancel')}</button>
                          </div>
                        ) : (
                          <button type="button" className="btn" onClick={() => setConfirmInsert(true)}>{t('ui.gate.insert')}</button>
                        )}
                      </div>
                    ) : (
                      <button type="button" className="btn" disabled={!!busy} onClick={() => act('visual', t('ui.gate.job.visual', { iid: card.iid }), t('ui.gate.busy.draw'), () => api.visualGate(gate.id))}>{t('ui.gate.visual.generate')}</button>
                    )}
                    {lastAfterTwo && (
                      <div className="item" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber-line)' }}>
                        <span className="small">{t('ui.gate.lastAfterTwo')}</span>
                      </div>
                    )}
                    <button type="button" className="btn btn-dark" disabled={!!busy} onClick={() => act('round', t('ui.gate.job.round', { iid: card.iid }), t('ui.gate.busy.round'), () => api.newGateRound(gate.id))}>{t('ui.gate.newRound')}</button>
                  </>
                )}
                <div className="row" style={{ borderTop: DIVIDER, paddingTop: 12 }}>
                  <button type="button" className="btn" disabled={!!gate.recorded || !!busy} onClick={() => act('record', t('ui.gate.job.record', { iid: card.iid }), t('ui.gate.busy.record'), () => api.recordGate(gate.id))}>
                    {gate.recorded ? t('ui.gate.recorded') : t('ui.gate.record')}
                  </button>
                  <span className="mono faint" style={{ wordBreak: 'break-all' }}>{gate.quizFile.replace(/^.*\/\.specs\//, '.specs/')}</span>
                  <span className="grow" />
                  <ContinueInClaude sessionId={gate.sessionId} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
