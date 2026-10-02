import { useCallback, useEffect, useRef, useState } from 'react';
import type { Improvement, Retro, RetroItem } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { type usePlayer, useTalk } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { AgentActivity } from '../AgentActivity';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { useVoiceEnabled } from '../i18n';

function improvementEntry(m: Improvement): string {
  return [`### N. ${m.title}`, '', `**Dimensão:** ${m.dimension}`, '', `**O problema hoje:** ${m.problem}`, '', `**O que seria:** ${m.proposal}`, ''].join('\n');
}

function Items({ title, items, tone }: { title: string; items: RetroItem[]; tone: string }) {
  return (
    <section className="panel" style={{ padding: 18, gap: 8 }}>
      <h2 className="section-title">{title} · {items.length}</h2>
      {!items.length && <p className="small faint">Nada.</p>}
      {items.map((i) => (
        <div key={i.title} className="item" style={{ borderLeft: `3px solid ${tone}` }}>
          <span style={{ fontWeight: 600 }}>{i.title}</span>
          <span className="small muted">{i.evidence}</span>
        </div>
      ))}
    </section>
  );
}

export function RetroScreen({ ceremony: c, player, go }: { ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
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
      if (retro) act('ask', 'Pergunta na retro', 'O moderador está pensando…', () => api.askRetro(retro.id, text));
    },
    [retro],
  );
  const voiceOn = useVoiceEnabled();
  const talk = useTalk(player, ask, setError);

  const copy = async (what: string, text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const week = retro ? `${new Date(retro.from).toLocaleDateString('pt-BR')} a ${new Date(retro.to).toLocaleDateString('pt-BR')}` : '';

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark hero" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label="Voltar" onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-teal)', fontWeight: 600 }}>Retro da semana{week ? ` · ${week}` : ''}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>Processo, não pessoas</div>
          </div>
          <Presence recording={talk.recording} thinking={!!busy || talk.transcribing} on={!!player.speaking || talk.recording} color={talk.recording ? 'var(--rec-blue)' : 'var(--teal-bright)'} level={talk.level} small />
          {retro && voiceOn && (
            <button type="button" className={`btn ${talk.recording ? 'btn-rec' : ''}`} style={talk.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy || talk.transcribing} onClick={() => void talk.talk()}>
              <MicIcon /> {talk.recording ? 'Enviar fala' : 'Falar (espaço)'}
            </button>
          )}
          <button type="button" className="btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!!busy} onClick={() => act('prepare', 'Retro da semana', 'O moderador está montando a retro da semana…', () => api.prepareRetro())}>
            {retro ? 'Montar de novo' : 'Montar a retro'}
          </button>
        </header>
        {error && <div className="error">{error}</div>}
        {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
        {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}
        {loaded && !retro && !busy && (
          <p className="small muted">
            A retro junta as cerimônias, decisões, ações de release, quizzes de gate e as mudanças no GitLab dos últimos 7 dias. O agente conduz; as melhorias saem no formato do IMPROVEMENTS.md para você levar pelo Claude Code.
          </p>
        )}

        {retro && (
          <>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <p style={{ lineHeight: 1.6 }}>{retro.speech}</p>
              <div className="row" style={{ gap: 10 }}>
                {retro.numbers.map((n) => (
                  <div key={n.label} className="panel" style={{ padding: '10px 14px', gap: 0, minWidth: 120 }}>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{n.value}</div>
                    <div className="small muted">{n.label}</div>
                  </div>
                ))}
              </div>
            </section>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <Items title="Funcionou" items={retro.worked} tone="var(--teal)" />
              <Items title="Travou" items={retro.stuck} tone="var(--warn)" />
              <Items title="Retrabalho" items={retro.rework} tone="var(--red)" />
            </div>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Melhorias propostas</h2>
              <p className="small muted">O IMPROVEMENTS.md é do time: copie a entrada e leve pelo Claude Code numa branch docs/&lt;slug&gt;.</p>
              {retro.improvements.map((m) => (
                <div key={m.title} className="item">
                  <div className="row spread">
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => void copy(m.title, improvementEntry(m))}>{copied === m.title ? 'Copiado' : 'Copiar entrada'}</button>
                  </div>
                  <span className="small muted">{m.dimension}</span>
                  <span className="small"><b>Problema:</b> {m.problem}</span>
                  <span className="small"><b>Proposta:</b> {m.proposal}</span>
                </div>
              ))}
              <ContinueInClaude sessionId={retro.sessionId} />
            </section>
            <section className="panel" style={{ padding: 20, gap: 10 }}>
              <h2 className="section-title">Conversa</h2>
              {retro.talk.map((m, i) => (
                <Bubble key={i} m={m} who={m.me ? 'Você' : 'Moderador'} voice={voice} player={player} speaker="retro" />
              ))}
              <form className="row composer" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) ask(draft.trim()); setDraft(''); }}>
                <input className="text-input" placeholder="Ou digite" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Fala na retro" />
                <button type="submit" className="btn btn-dark" disabled={!draft.trim() || !!busy}>Enviar</button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
