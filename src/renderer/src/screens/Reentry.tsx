import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../../shared/types';
import type { Reentry as ReentryData, ReentryClass, ReentryPhase } from '../../../shared/feedback';
import type { Screen } from '../App';
import { type usePlayer, useTalk } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { feedbackApi } from '../feedbackApi';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { intlLocale, useT, useTv, useVoiceEnabled } from '../i18n';

const CLASS_LABEL: Record<ReentryClass, string> = {
  'defeito-novo': 'ui.reentry.class.newDefect',
  'causa-diferente': 'ui.reentry.class.differentCause',
  'so-plano': 'ui.reentry.class.planOnly',
  ambiente: 'ui.reentry.class.environment',
};

const PHASE_LABEL: Record<ReentryPhase, string> = {
  F1: 'ui.reentry.phase.f1',
  F3: 'ui.reentry.phase.f3',
  F4: 'ui.reentry.phase.f4',
  nenhuma: 'ui.reentry.phase.none',
};

const HEADER_STYLE: CSSProperties = { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }; // i18n-ignore: CSS value

// What each background job says while it runs; the label ends with the activity number.
const JOBS = {
  prepare: { label: 'ui.reentry.job.prepare', busy: 'ui.reentry.busy.prepare' },
  reprepare: { label: 'ui.reentry.job.prepare', busy: 'ui.reentry.busy.reprepare' },
  ask: { label: 'ui.reentry.job.ask', busy: 'ui.reentry.busy.ask' },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Reentry({ card, ceremony: c, player, go }: { card: Card | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const t = useT();
  const tv = useTv();
  const [re, setRe] = useState<ReentryData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const spoken = useRef<string | null>(null);
  const started = useRef(false);
  const failedAtOpen = useRef(false);
  const reRef = useRef<ReentryData | null>(null);
  reRef.current = re;
  const voice = c.voices?.agents[3] ?? c.voices?.agents[0] ?? null;

  const act = (op: 'prepare' | 'ask', kind: keyof typeof JOBS, fn: () => Promise<ReentryData>) => {
    if (!card) return;
    setError(null);
    jobs.launch(`reentry:${card.ref}:${op}`, { label: t(JOBS[kind].label, { iid: card.iid }), busy: t(JOBS[kind].busy), screen: { name: 'reentry', ref: card.ref, card } }, fn);
  };

  // Main keeps the call; a job that finished while this screen was closed is applied as it would have been.
  const running = useJobs<ReentryData>(card ? `reentry:${card.ref}:` : null, {
    done: (r, job, late) => {
      setRe(r);
      setLoaded(true);
      const last = r.talk[r.talk.length - 1];
      if (!late && job.key.endsWith(':ask') && voice && last && !last.me) void player.say(last.speech ?? last.text, voice, 'reentrada').catch(() => undefined);
    },
    failed: (message) => {
      failedAtOpen.current = true;
      setError(message);
    },
  });
  const busy = busyText(running);

  // A saved call opens as it was; a new one starts by itself, since the notification already asked for it.
  useEffect(() => {
    if (!card || started.current) return;
    started.current = true;
    void feedbackApi.getReentry(card.iid).then((saved) => {
      setRe((prev) => prev ?? saved);
      setLoaded(true);
      if (!saved && !reRef.current && !failedAtOpen.current && !jobs.get(`reentry:${card.ref}:prepare`)) act('prepare', 'prepare', () => feedbackApi.prepareReentry(card));
    });
  }, [card]);

  useEffect(() => {
    if (!re || !voice || spoken.current === re.createdAt) return;
    spoken.current = re.createdAt;
    void player.say(re.speech, voice, 'reentrada').catch(() => undefined);
  }, [re, voice, player]);

  const ask = useCallback(
    async (text: string) => {
      if (card) act('ask', 'ask', () => feedbackApi.askReentry(card.iid, text));
    },
    [card],
  );
  const voiceOn = useVoiceEnabled();
  const talk = useTalk(player, ask, setError);

  if (!card) {
    return <div className="page"><div className="wrap"><div className="error">{t('ui.reentry.notFound')}</div><div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>{t('ui.reentry.back')}</button></div></div></div>;
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark hero" style={HEADER_STYLE}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.reentry.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-amber)', fontWeight: 600 }}>{t('ui.reentry.title', { iid: card.iid })}{card.stage ? ` · ${card.stage}` : ''}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={talk.recording} thinking={!!busy || talk.transcribing} on={!!player.speaking || talk.recording} color={talk.recording ? 'var(--rec-blue)' : 'var(--night-orange)'} small />
          {re && voiceOn && (
            <button type="button" className={`btn ${talk.recording ? 'btn-rec' : ''}`} style={talk.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy || talk.transcribing} onClick={() => void talk.talk()}>
              <MicIcon /> {talk.recording ? t('ui.reentry.sendQuestion') : t('ui.reentry.askSpace')}
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}
        {(busy && !re) && <div className="row faint"><span className="spinner" /> {busy}</div>}
        {loaded && !re && !busy && (
          <div><button type="button" className="btn btn-dark" onClick={() => act('prepare', 'prepare', () => feedbackApi.prepareReentry(card))}>{t('ui.reentry.retry')}</button></div>
        )}

        {re && (
          <div className="cols" style={{ gap: 18 }}>
            <main style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel" style={{ padding: 20, gap: 10 }}>
                <h2 className="section-title">{t('ui.reentry.found')}</h2>
                <p style={{ lineHeight: 1.6 }}>{re.found}</p>
                {re.notes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {re.notes.map((n) => (
                      <a key={n.id} className="item" href={n.url} target="_blank" rel="noreferrer">
                        <span className="mono faint">{n.where} · {when(n.at)}</span>
                        <span className="small" style={{ lineHeight: 1.45 }}>{n.excerpt}</span>
                      </a>
                    ))}
                  </div>
                )}
              </section>
              <section className="panel" style={{ padding: 20, gap: 10 }}>
                <div className="row" style={{ gap: 10 }}>
                  <h2 className="section-title">{t('ui.reentry.classification')}</h2>
                  <span className={`badge ${re.classification === 'ambiente' ? 'badge-quiet' : 'badge-block'}`}>{t(CLASS_LABEL[re.classification])}</span>
                </div>
                <p className="small" style={{ lineHeight: 1.5 }}>{re.why}</p>
                <h2 className="section-title" style={{ marginTop: 6 }}>{t('ui.reentry.reentersAt')}</h2>
                <p style={{ fontWeight: 600 }}>{t(PHASE_LABEL[re.phase])}</p>
                <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.45 }}>
                  {re.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <p className="faint">{t('ui.reentry.cycleNote')}</p>
              </section>
            </main>
            <aside style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">{t('ui.reentry.questions')}</h2>
                {re.talk.map((m, i) => (
                  <Bubble key={i} m={m} who={m.me ? t('ui.bubble.me') : t('ui.bubble.agent')} voice={voice} player={player} speaker="reentrada" />
                ))}
                {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
                <form className="row composer" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !busy) ask(draft.trim()); setDraft(''); }}>
                  <input className="text-input" placeholder={t('ui.reentry.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.reentry.questionLabel')} />
                  <button type="submit" className="btn btn-dark" disabled={!draft.trim() || !!busy}>{t('ui.reentry.ask')}</button>
                </form>
              </section>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">{tv('call.after')}</h2>
                <p className="small" style={{ lineHeight: 1.5 }}>{t('ui.reentry.continueNote')}</p>
                <ContinueInClaude sessionId={re.sessionId} />
                <button type="button" className="btn" disabled={!!busy} onClick={() => act('prepare', 'reprepare', () => feedbackApi.prepareReentry(card))}>{t('ui.reentry.prepareAgain')}</button>
                {card.mrPaths.length > 0 && <button type="button" className="btn" onClick={() => go({ name: 'discussions', ref: card.ref, card })}>{t('ui.reentry.seeDiscussions')}</button>}
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
