import { useCallback, useEffect, useRef, useState } from 'react';
import type { Improvement, Retro, RetroItem } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { type usePlayer, useTalk } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { AgentActivity } from '../AgentActivity';
import { useCycle } from '../cycleApi';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { intlLocale, t, useT, useVoiceEnabled } from '../i18n';

function improvementEntry(m: Improvement): string {
  return [
    `### N. ${m.title}`,
    '',
    t('ui.retro.entry.dimension', { value: m.dimension }),
    '',
    t('ui.retro.entry.problem', { value: m.problem }),
    '',
    t('ui.retro.entry.proposal', { value: m.proposal }),
    '',
  ].join('\n');
}

function Items({ title, items, tone }: { title: string; items: RetroItem[]; tone: string }) {
  const t = useT();
  return (
    <section className="panel" style={{ padding: 18, gap: 8 }}>
      <h2 className="section-title">{title} · {items.length}</h2>
      {!items.length && <p className="small faint">{t('ui.retro.nothing')}</p>}
      {items.map((i) => (
        <div
          key={i.title}
          className="item"
          style={{ borderLeft: `3px solid ${tone}` }} // i18n-ignore: CSS shorthand
        >
          <span style={{ fontWeight: 600 }}>{i.title}</span>
          <span className="small muted">{i.evidence}</span>
        </div>
      ))}
    </section>
  );
}

export function RetroScreen({ ceremony: c, player, go }: { ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const t = useT();
  const [retro, setRetro] = useState<Retro | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const spoken = useRef<string | null>(null);
  const voice = c.voices?.moderator ?? null;

  useEffect(() => {
    api.latestRetro().then((r) => {
      setRetro((prev) => prev ?? r);
      setLoaded(true);
    });
  }, []);

  // Main keeps the retro; a job that finished while this screen was closed is applied as it would have been.
  const running = useJobs<Retro>('retro:', {
    done: (r, job, late) => {
      setRetro(r);
      setLoaded(true);
      const last = r.talk[r.talk.length - 1];
      if (!late && job.key === 'retro:ask' && voice && last && !last.me) void player.say(last.speech ?? last.text, voice, 'retro').catch(() => undefined);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running);

  useEffect(() => {
    if (!retro || !voice || spoken.current === retro.createdAt) return;
    spoken.current = retro.createdAt;
    void player.say(retro.speech, voice, 'retro').catch(() => undefined);
  }, [retro, voice, player]);

  const act = (op: string, label: string, busy: string, fn: () => Promise<Retro>) => {
    setError(null);
    jobs.launch(`retro:${op}`, { label, busy, screen: { name: 'retro' } }, fn);
  };

  const ask = useCallback(
    async (text: string) => {
      if (retro) act('ask', t('ui.retro.job.askLabel'), t('ui.retro.job.askBusy'), () => api.askRetro(retro.id, text));
    },
    [retro],
  );
  const voiceOn = useVoiceEnabled();
  // The IMPROVEMENTS.md convention and the gate quizzes belong to the SDD cycle; any other cycle gets the neutral wording.
  const sddCycle = useCycle()?.templateId === 'sdd';
  const talk = useTalk(player, ask, setError);

  const copy = async (what: string, text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const week = retro ? t('ui.retro.range', { from: new Date(retro.from).toLocaleDateString(intlLocale()), to: new Date(retro.to).toLocaleDateString(intlLocale()) }) : '';

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header
          className="panel-dark hero"
          style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }} // i18n-ignore: CSS shorthand
        >
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label={t('ui.retro.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-teal)', fontWeight: 600 }}>{week ? t('ui.retro.headingWeek', { week }) : t('ui.retro.heading')}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{t('ui.retro.tagline')}</div>
          </div>
          <Presence recording={talk.recording} thinking={!!busy || talk.transcribing} on={!!player.speaking || talk.recording} color={talk.recording ? 'var(--rec-blue)' : 'var(--teal-bright)'} level={talk.level} small />
          {retro && voiceOn && (
            <button type="button" className={`btn ${talk.recording ? 'btn-rec' : ''}`} style={talk.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy || talk.transcribing} onClick={() => void talk.talk()}>
              <MicIcon /> {talk.recording ? t('ui.retro.talk.send') : t('ui.retro.talk.start')}
            </button>
          )}
          <button type="button" className="btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!!busy} onClick={() => act('prepare', t('ui.retro.job.prepareLabel'), t('ui.retro.job.prepareBusy'), () => api.prepareRetro())}>
            {retro ? t('ui.retro.rebuild') : t('ui.retro.build')}
          </button>
        </header>
        {error && <div className="error">{error}</div>}
        {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
        {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}
        {loaded && !retro && !busy && (
          <p className="small muted">
            {t(sddCycle ? 'ui.retro.intro' : 'ui.retro.introPlain')}
          </p>
        )}

        {retro && (
          <>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <p style={{ lineHeight: 1.6 }}>{retro.speech}</p>
              <div className="row" style={{ gap: 10 }}>
                {retro.numbers.map((n) => (
                  <div
                    key={n.label}
                    className="panel"
                    style={{ padding: '10px 14px', gap: 0, minWidth: 120 }} // i18n-ignore: CSS shorthand
                  >
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{n.value}</div>
                    <div className="small muted">{n.label}</div>
                  </div>
                ))}
              </div>
            </section>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }} // i18n-ignore: CSS grid
            >
              <Items title={t('ui.retro.worked')} items={retro.worked} tone="var(--teal)" />
              <Items title={t('ui.retro.stuck')} items={retro.stuck} tone="var(--warn)" />
              <Items title={t('ui.retro.rework')} items={retro.rework} tone="var(--red)" />
            </div>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.retro.improvements.title')}</h2>
              <p className="small muted">{t(sddCycle ? 'ui.retro.improvements.hint' : 'ui.retro.improvements.hintPlain')}</p>
              {retro.improvements.map((m) => (
                <div key={m.title} className="item">
                  <div className="row spread">
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => void copy(m.title, improvementEntry(m))}>{copied === m.title ? t('ui.retro.copied') : t('ui.retro.copyEntry')}</button>
                  </div>
                  <span className="small muted">{m.dimension}</span>
                  <span className="small"><b>{t('ui.retro.problem')}</b> {m.problem}</span>
                  <span className="small"><b>{t('ui.retro.proposal')}</b> {m.proposal}</span>
                </div>
              ))}
              <ContinueInClaude sessionId={retro.sessionId} />
            </section>
            <section className="panel" style={{ padding: 20, gap: 10 }}>
              <h2 className="section-title">{t('ui.retro.talk.title')}</h2>
              {retro.talk.map((m, i) => (
                <Bubble key={i} m={m} who={m.me ? t('ui.retro.talk.me') : t('ui.retro.talk.moderator')} voice={voice} player={player} speaker="retro" />
              ))}
              <form className="row composer" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) ask(draft.trim()); setDraft(''); }}>
                <input className="text-input" placeholder={t('ui.retro.talk.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('ui.retro.talk.aria')} />
                <button type="submit" className="btn btn-dark" disabled={!draft.trim() || !!busy}>{t('ui.retro.send')}</button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
