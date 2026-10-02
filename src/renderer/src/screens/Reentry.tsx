import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../../shared/types';
import type { Reentry as ReentryData, ReentryClass, ReentryPhase } from '../../../shared/feedback';
import type { Screen } from '../App';
import { errorText } from '../api';
import { type usePlayer, useTalk } from '../audio';
import type { Ceremony } from '../ceremony';
import { feedbackApi } from '../feedbackApi';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { RichText } from './Diagram';
import { Presence } from './Avatar';

const CLASS_LABEL: Record<ReentryClass, string> = {
  'defeito-novo': 'Defeito novo',
  'causa-diferente': 'Causa diferente da investigada',
  'so-plano': 'Só correção no Plan',
  ambiente: 'Ambiente',
};

const PHASE_LABEL: Record<ReentryPhase, string> = {
  F1: 'F1: nova investigação, com Gate 1 novo',
  F3: 'F3: emenda do Plan, com Gate 2 só do delta',
  F4: 'F4: mesmo Plan, só o delta',
  nenhuma: 'Nenhuma fase: corrigir o ambiente e pedir reteste',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Reentry({ card, ceremony: c, player, go }: { card: Card | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [re, setRe] = useState<ReentryData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const spoken = useRef<string | null>(null);
  const started = useRef(false);
  const voice = c.voices?.agents[3] ?? c.voices?.agents[0] ?? null;

  const act = useCallback(
    async (label: string, fn: () => Promise<ReentryData>, speakLast = false) => {
      setBusy(label);
      setError(null);
      try {
        const r = await fn();
        setRe(r);
        const last = r.talk[r.talk.length - 1];
        if (speakLast && voice && last && !last.me) void player.say(last.text, voice, 'reentrada').catch(() => undefined);
      } catch (e) {
        setError(errorText(e));
      }
      setBusy(null);
    },
    [voice, player],
  );

  // A saved call opens as it was; a new one starts by itself, since the notification already asked for it.
  useEffect(() => {
    if (!card || started.current) return;
    started.current = true;
    void feedbackApi.getReentry(card.iid).then((saved) => {
      setRe(saved);
      setLoaded(true);
      if (!saved) void act('O agente está lendo o comentário do QA e o spec…', () => feedbackApi.prepareReentry(card));
    });
  }, [card, act]);

  useEffect(() => {
    if (!re || !voice || spoken.current === re.createdAt) return;
    spoken.current = re.createdAt;
    void player.say(re.speech, voice, 'reentrada').catch(() => undefined);
  }, [re, voice, player]);

  const ask = useCallback(
    async (text: string) => {
      if (card) await act('O agente está respondendo…', () => feedbackApi.askReentry(card.iid, text), true);
    },
    [card, act],
  );
  const talk = useTalk(player, ask, setError);

  if (!card) {
    return <div className="page"><div className="wrap"><div className="error">Atividade não encontrada.</div><div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>Voltar</button></div></div></div>;
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label="Voltar" onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-amber)', fontWeight: 600 }}>Retorno do QA · #{card.iid}{card.stage ? ` · ${card.stage}` : ''}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={talk.recording} face={'var(--night-orange)'} on={!!player.speaking || talk.recording} color={talk.recording ? 'var(--rec-blue)' : 'var(--night-orange)'} small />
          {re && (
            <button type="button" className={`btn ${talk.recording ? 'btn-rec' : ''}`} style={talk.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy || talk.transcribing} onClick={() => void talk.talk()}>
              <MicIcon /> {talk.recording ? 'Enviar pergunta' : 'Perguntar (espaço)'}
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}
        {(busy && !re) && <div className="row faint"><span className="spinner" /> {busy}</div>}
        {loaded && !re && !busy && (
          <div><button type="button" className="btn btn-dark" onClick={() => void act('O agente está lendo o comentário do QA e o spec…', () => feedbackApi.prepareReentry(card))}>Tentar de novo</button></div>
        )}

        {re && (
          <div className="cols" style={{ gap: 18 }}>
            <main style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel" style={{ padding: 20, gap: 10 }}>
                <h2 className="section-title">O que o QA encontrou</h2>
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
                  <h2 className="section-title">Classificação</h2>
                  <span className={`badge ${re.classification === 'ambiente' ? 'badge-quiet' : 'badge-block'}`}>{CLASS_LABEL[re.classification]}</span>
                </div>
                <p className="small" style={{ lineHeight: 1.5 }}>{re.why}</p>
                <h2 className="section-title" style={{ marginTop: 6 }}>Reentra em</h2>
                <p style={{ fontWeight: 600 }}>{PHASE_LABEL[re.phase]}</p>
                <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.45 }}>
                  {re.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <p className="faint">Tabela de ciclos da skill agent-pipeline, seção 3. Mover status e label continua no Claude Code, com o seu “sim”.</p>
              </section>
            </main>
            <aside style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">Perguntas</h2>
                {re.talk.map((m, i) => (
                  <div key={i} className={`bubble-row ${m.me ? 'me' : ''}`}><div className="bubble"><div className="who">{m.me ? 'Você' : 'Agente'} · {m.at}</div><div style={{ lineHeight: 1.5 }}><RichText text={m.text} /></div></div></div>
                ))}
                {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
                <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !busy) void ask(draft.trim()); setDraft(''); }}>
                  <input className="text-input" placeholder="Ou digite a pergunta" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Pergunta" />
                  <button type="submit" className="btn btn-dark" disabled={!draft.trim() || !!busy}>Perguntar</button>
                </form>
              </section>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">Depois da call</h2>
                <p className="small" style={{ lineHeight: 1.5 }}>Seguir a reentrada é no Claude Code, nesta mesma sessão do agente.</p>
                <ContinueInClaude sessionId={re.sessionId} />
                <button type="button" className="btn" disabled={!!busy} onClick={() => void act('O agente está relendo o retorno…', () => feedbackApi.prepareReentry(card))}>Preparar de novo</button>
                {card.mrPaths.length > 0 && <button type="button" className="btn" onClick={() => go({ name: 'discussions', ref: card.ref, card })}>Ver discussões dos MRs</button>}
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
