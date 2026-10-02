import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, QaHandoff as Qa } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { type usePlayer, useTalk } from '../audio';
import type { Ceremony } from '../ceremony';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Wave } from './Wave';

function checklistText(q: Qa): string {
  return [`QA Checklist — #${q.iid} ${q.title}`, '', ...q.checklist.flatMap((s) => [`${s.title}:`, ...s.items.map((i) => `- [ ] ${i}`), ''])].join('\n');
}

export function QaHandoff({ card, ceremony: c, player, go }: { card: Card | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [qa, setQa] = useState<Qa | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const spoken = useRef<string | null>(null);
  const voice = c.voices?.agents[1] ?? null;

  useEffect(() => {
    if (!card) return;
    api.getQa(card.iid).then((q) => {
      setQa(q);
      setLoaded(true);
    });
  }, [card]);

  useEffect(() => {
    if (!qa || !voice || spoken.current === qa.createdAt) return;
    spoken.current = qa.createdAt;
    void player.say(qa.speech, voice, 'qa').catch(() => undefined);
  }, [qa, voice, player]);

  const act = async (label: string, fn: () => Promise<Qa>, speakLast = false) => {
    setBusy(label);
    setError(null);
    try {
      const q = await fn();
      setQa(q);
      const last = q.talk[q.talk.length - 1];
      if (speakLast && voice && last && !last.me) void player.say(last.text, voice, 'qa').catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  const ask = useCallback(
    async (text: string) => {
      if (card) await act('O agente está respondendo…', () => api.askQa(card.iid, text), true);
    },
    [card],
  );
  const talk = useTalk(player, ask, setError);

  const copy = async (what: string, text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!card) {
    return <div className="page"><div className="wrap"><div className="error">Atividade não encontrada.</div><div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>Voltar</button></div></div></div>;
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label="Voltar" onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-violet)', fontWeight: 600 }}>Passagem para o QA · #{card.iid}{card.stage ? ` · ${card.stage}` : ''}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Wave on={!!player.speaking || talk.recording} color={talk.recording ? 'var(--rec-blue)' : 'var(--night-violet)'} level={talk.level} small />
          {qa && (
            <button type="button" className={`btn ${talk.recording ? 'btn-rec' : ''}`} style={talk.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy || talk.transcribing} onClick={() => void talk.talk()}>
              <MicIcon /> {talk.recording ? 'Enviar pergunta' : 'Perguntar (espaço)'}
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}

        {loaded && !qa && (
          <section className="panel" style={{ padding: 20, gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Preparar a passagem</h2>
            <p className="small muted" style={{ lineHeight: 1.5 }}>
              O agente lê o ISSUE_COMPLETION, o TEST_PLAN, o Plan, o diff do MR e a nota do QA na issue, e explica por voz o que mudou e o que testar. Sai daqui o checklist e o texto do Teams. Criar a branch de release, o comentário e o status continuam na skill qa-release-branch, no Claude Code, com “sim”.
            </p>
            <div><button type="button" className="btn btn-dark" disabled={!!busy} onClick={() => void act('O agente está lendo a atividade…', () => api.prepareQa(card))}>Preparar</button></div>
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
          </section>
        )}

        {qa && (
          <div className="cols" style={{ gap: 18 }}>
            <main style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel" style={{ padding: 20, gap: 10 }}>
                <h2 className="section-title">O que mudou</h2>
                <p style={{ lineHeight: 1.6 }}>{qa.changed}</p>
                <h2 className="section-title" style={{ marginTop: 6 }}>Ambiente</h2>
                <p className="small" style={{ lineHeight: 1.5 }}>{qa.environment}</p>
              </section>
              <section className="panel" style={{ padding: 20, gap: 12 }}>
                <div className="row spread">
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Checklist</h2>
                  <button type="button" className="btn" onClick={() => void copy('checklist', checklistText(qa))}>{copied === 'checklist' ? 'Copiado' : 'Copiar'}</button>
                </div>
                {qa.checklist.map((s) => (
                  <div key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <h3 className="section-title">{s.title}</h3>
                    {s.items.map((i) => <label key={i} className="row small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" style={{ marginTop: 3 }} /> <span style={{ lineHeight: 1.45 }}>{i}</span></label>)}
                  </div>
                ))}
                {qa.risks.length > 0 && (
                  <div className="item" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber-line)' }}>
                    <span className="section-title">Riscos</span>
                    {qa.risks.map((r) => <span key={r} className="small">{r}</span>)}
                  </div>
                )}
                <div className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
                  {confirmWrite ? (
                    <>
                      <button type="button" className="btn btn-red" onClick={() => void act('Gravando…', () => api.writeQaChecklist(qa.iid)).then(() => setConfirmWrite(false))}>
                        Confirmar: {qa.checklistExists ? 'substituir' : 'criar'} QA_CHECKLIST.md
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmWrite(false)}>Cancelar</button>
                    </>
                  ) : (
                    <button type="button" className="btn" onClick={() => setConfirmWrite(true)}>{qa.written ? 'Gravar de novo no .specs' : 'Gravar no .specs'}</button>
                  )}
                  <span className="mono faint" style={{ wordBreak: 'break-all' }}>{qa.checklistFile.replace(/^.*\/\.specs\//, '.specs/')}</span>
                </div>
              </section>
            </main>
            <aside style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
                <div className="row spread">
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Aviso no Teams</h2>
                  <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!qa.teams} onClick={() => void copy('teams', qa.teams)}>{copied === 'teams' ? 'Copiado' : 'Copiar'}</button>
                </div>
                {qa.teams ? <pre className="teams">{qa.teams}</pre> : <p className="small" style={{ color: 'var(--on-night-muted)' }}>Sem a nota do QA na issue ainda: o texto sai depois que a qa-release-branch criar a branch e o comentário.</p>}
                <p className="small" style={{ color: 'var(--on-night-muted)' }}>Você cola no Teams; nada é publicado daqui.</p>
              </section>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">Perguntas do QA</h2>
                {qa.talk.map((m, i) => (
                  <div key={i} className={`bubble-row ${m.me ? 'me' : ''}`}><div className="bubble"><div className="who">{m.me ? 'Pergunta' : 'Agente'} · {m.at}</div><div style={{ lineHeight: 1.5 }}>{m.text}</div></div></div>
                ))}
                {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
                <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void ask(draft.trim()); setDraft(''); }}>
                  <input className="text-input" placeholder="Ou digite a pergunta" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Pergunta" />
                  <button type="submit" className="btn btn-dark" disabled={!draft.trim() || !!busy}>Perguntar</button>
                </form>
              </section>
              <section className="panel" style={{ gap: 10 }}>
                <h2 className="section-title">Levar ao QA</h2>
                <p className="small" style={{ lineHeight: 1.5 }}>Branch de release, pipelines, comentário @qa.interno e status Ready for testing: skill qa-release-branch, no Claude Code, com “sim” por ação.</p>
                <ContinueInClaude sessionId={qa.sessionId} />
                <button type="button" className="btn" disabled={!!busy} onClick={() => void act('O agente está relendo a atividade…', () => api.prepareQa(card))}>Preparar de novo</button>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
