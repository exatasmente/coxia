import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Card, QaHandoff as Qa } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { type usePlayer, useTalk } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { useT, useTv, useVoiceEnabled } from '../i18n';
import type { Translate } from '../../../shared/i18n';

const HEADER_STYLE: CSSProperties = { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }; // i18n-ignore: CSS value
const DIVIDER = '1px solid var(--line-2)'; // i18n-ignore: CSS value

function checklistText(t: Translate, q: Qa): string {
  return [t('ui.qa.checklistHeading', { iid: q.iid, title: q.title }), '', ...q.checklist.flatMap((s) => [`${s.title}:`, ...s.items.map((i) => `- [ ] ${i}`), ''])].join('\n');
}

export function QaHandoff({ card, ceremony: c, player, go }: { card: Card | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [qa, setQa] = useState<Qa | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const t = useT();
  const tv = useTv();
  const spoken = useRef<string | null>(null);
  const voice = c.voices?.agents[1] ?? null;

  useEffect(() => {
    if (!card) return;
    api.getQa(card.iid).then((q) => {
      setQa((prev) => prev ?? q);
      setLoaded(true);
    });
  }, [card]);

  // Main keeps the handoff; a job that finished while this screen was closed is applied as it would have been.
  const running = useJobs<Qa>(card ? `qa:${card.ref}:` : null, {
    done: (q, job, late) => {
      setQa(q);
      setLoaded(true);
      const last = q.talk[q.talk.length - 1];
      if (!late && job.key.endsWith(':ask') && voice && last && !last.me) void player.say(last.speech ?? last.text, voice, 'qa').catch(() => undefined);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running);

  useEffect(() => {
    if (!qa || !voice || spoken.current === qa.createdAt) return;
    spoken.current = qa.createdAt;
    void player.say(qa.speech, voice, 'qa').catch(() => undefined);
  }, [qa, voice, player]);

  const act = (op: string, label: string, busyLabel: string, fn: () => Promise<Qa>) => {
    if (!card) return;
    setError(null);
    jobs.launch(`qa:${card.ref}:${op}`, { label, busy: busyLabel, screen: { name: 'qa', ref: card.ref, card } }, fn);
  };

  const ask = useCallback(
    async (text: string) => {
      if (card) act('ask', t('ui.qa.job.ask', { iid: card.iid }), t('ui.qa.busy.answering'), () => api.askQa(card.iid, text));
    },
    [card],
  );
  const voiceOn = useVoiceEnabled();
  const talk = useTalk(player, ask, setError);

  const copy = async (what: string, text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!card) {
    return <div className="page"><div className="wrap"><div className="error">{t('ui.qa.notFound')}</div><div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>{t('ui.qa.back')}</button></div></div></div>;
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark hero" style={HEADER_STYLE}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.qa.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-violet)', fontWeight: 600 }}>{t('ui.qa.header', { iid: card.iid })}{card.stage ? ` · ${card.stage}` : ''}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={talk.recording} thinking={!!busy || talk.transcribing} on={!!player.speaking || talk.recording} color={talk.recording ? 'var(--rec-blue)' : 'var(--night-violet)'} level={talk.level} small />
          {qa && voiceOn && (
            <button type="button" className={`btn ${talk.recording ? 'btn-rec' : ''}`} style={talk.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy || talk.transcribing} onClick={() => void talk.talk()}>
              <MicIcon /> {talk.recording ? t('ui.qa.mic.send') : t('ui.qa.mic.ask')}
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}

        {loaded && !qa && (
          <section className="panel" style={{ padding: 20, gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.qa.prepare.title')}</h2>
            <p className="small muted" style={{ lineHeight: 1.5 }}>
              {t('ui.qa.prepare.intro', { by: tv('by.voice') })}
            </p>
            <div><button type="button" className="btn btn-dark" disabled={!!busy} onClick={() => act('prepare', t('ui.qa.job.prepare', { iid: card.iid }), t('ui.qa.busy.reading'), () => api.prepareQa(card))}>{t('ui.qa.prepare.button')}</button></div>
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
          </section>
        )}

        {qa && (
          <div className="cols" style={{ gap: 18 }}>
            <main style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel" style={{ padding: 20, gap: 10 }}>
                <h2 className="section-title">{t('ui.qa.changed')}</h2>
                <p style={{ lineHeight: 1.6 }}>{qa.changed}</p>
                <h2 className="section-title" style={{ marginTop: 6 }}>{t('ui.qa.environment')}</h2>
                <p className="small" style={{ lineHeight: 1.5 }}>{qa.environment}</p>
              </section>
              <section className="panel" style={{ padding: 20, gap: 12 }}>
                <div className="row spread">
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.qa.checklist')}</h2>
                  <button type="button" className="btn" onClick={() => void copy('checklist', checklistText(t, qa))}>{copied === 'checklist' ? t('ui.qa.copied') : t('ui.qa.copy')}</button>
                </div>
                {qa.checklist.map((s) => (
                  <div key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <h3 className="section-title">{s.title}</h3>
                    {s.items.map((i) => <label key={i} className="row small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" style={{ marginTop: 3 }} /> <span style={{ lineHeight: 1.45 }}>{i}</span></label>)}
                  </div>
                ))}
                {qa.risks.length > 0 && (
                  <div className="item" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber-line)' }}>
                    <span className="section-title">{t('ui.qa.risks')}</span>
                    {qa.risks.map((r) => <span key={r} className="small">{r}</span>)}
                  </div>
                )}
                <div className="row" style={{ borderTop: DIVIDER, paddingTop: 12 }}>
                  {confirmWrite ? (
                    <>
                      <button type="button" className="btn btn-red" onClick={() => { setConfirmWrite(false); act('write', t('ui.qa.job.write', { iid: card.iid }), t('ui.qa.busy.saving'), () => api.writeQaChecklist(qa.iid)); }}>
                        {qa.checklistExists ? t('ui.qa.write.confirmReplace') : t('ui.qa.write.confirmCreate')}
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmWrite(false)}>{t('ui.qa.cancel')}</button>
                    </>
                  ) : (
                    <button type="button" className="btn" onClick={() => setConfirmWrite(true)}>{qa.written ? t('ui.qa.write.again') : t('ui.qa.write.save')}</button>
                  )}
                  <span className="mono faint" style={{ wordBreak: 'break-all' }}>{qa.checklistFile.replace(/^.*\/\.specs\//, '.specs/')}</span>
                </div>
              </section>
            </main>
            <aside style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
                <div className="row spread">
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.qa.teams.title')}</h2>
                  <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!qa.teams} onClick={() => void copy('teams', qa.teams)}>{copied === 'teams' ? t('ui.qa.copied') : t('ui.qa.copy')}</button>
                </div>
                {qa.teams ? <pre className="teams">{qa.teams}</pre> : <p className="small" style={{ color: 'var(--on-night-muted)' }}>{t('ui.qa.teams.empty')}</p>}
                <p className="small" style={{ color: 'var(--on-night-muted)' }}>{t('ui.qa.teams.note')}</p>
              </section>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">{t('ui.qa.questions')}</h2>
                {qa.talk.map((m, i) => (
                  <Bubble key={i} m={m} who={m.me ? t('ui.qa.who.question') : t('ui.qa.who.agent')} voice={voice} player={player} speaker="qa" />
                ))}
                {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
                <form className="row composer" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) ask(draft.trim()); setDraft(''); }}>
                  <input className="text-input" placeholder={t('ui.qa.draft.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.qa.draft.aria')} />
                  <button type="submit" className="btn btn-dark" disabled={!draft.trim() || !!busy}>{t('ui.qa.draft.submit')}</button>
                </form>
              </section>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">{t('ui.qa.take.title')}</h2>
                <p className="small" style={{ lineHeight: 1.5 }}>{t('ui.qa.take.text')}</p>
                <ContinueInClaude sessionId={qa.sessionId} />
                <button type="button" className="btn" disabled={!!busy} onClick={() => act('prepare', t('ui.qa.job.prepare', { iid: card.iid }), t('ui.qa.busy.rereading'), () => api.prepareQa(card))}>{t('ui.qa.prepare.again')}</button>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
