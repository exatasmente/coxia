import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, GateOption, GateView } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Wave } from './Wave';

const LETTERS = ['A', 'B', 'C', 'D'];

function spokenQuestion(n: number, text: string, options: string[]): string {
  return `Pergunta ${n}. ${text} ${options.map((o, i) => `${LETTERS[i]}: ${o}.`).join(' ')}`;
}

export function Gate({
  card,
  ceremony: c,
  player,
  go,
}: { card: Card | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [options, setOptions] = useState<GateOption[] | null>(null);
  const [gate, setGate] = useState<GateView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmInsert, setConfirmInsert] = useState(false);
  const rec = useRecorder(() => void talkRef.current());
  const spokenFor = useRef<string | null>(null);
  const voice = c.voices?.moderator ?? null;

  useEffect(() => {
    if (card) api.gateOptions(card).then(setOptions, (e) => setError(errorText(e)));
  }, [card]);

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
    if (current >= 0) parts.push(spokenQuestion(current + 1, round.questions[current].text, round.questions[current].options));
    else parts.push(round.verdict === 'assertivo' ? 'Quiz assertivo: todas certas.' : 'Quiz não assertivo. Vamos fechar a lacuna antes do gate.');
    void player.say(parts.join(' '), voice, 'Moderador').catch(() => undefined);
  }, [gate, round, current, voice, player]);

  const act = async (label: string, fn: () => Promise<GateView>) => {
    setBusy(label);
    setError(null);
    try {
      setGate(await fn());
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  const answer = useCallback(
    (input: { choice?: number; text?: string }) => {
      if (!gate || current < 0) return;
      player.stop();
      void act(input.text ? 'Avaliando a resposta…' : 'Registrando…', () => api.answerGate(gate.id, current, input));
    },
    [gate, current, player],
  );

  const talk = useCallback(async () => {
    if (player.speaking) player.stop();
    if (!rec.recording) {
      try {
        await rec.start();
      } catch (e) {
        setError(`Microfone indisponível: ${errorText(e)}`);
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio || !gate) return;
    setBusy('Transcrevendo…');
    try {
      const text = (await api.transcribe(audio)).trim();
      setBusy(null);
      if (!text) return;
      if (!roundDone) answer({ text });
      else await act('O agente está lendo a seção com você…', () => api.explainGate(gate.id, text));
    } catch (e) {
      setBusy(null);
      setError(`Falha na transcrição: ${errorText(e)}`);
    }
  }, [rec, player, gate, roundDone, answer]);

  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, button')) return;
      e.preventDefault();
      void talkRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!card) {
    return (
      <div className="page"><div className="wrap">
        <div className="error">Atividade não encontrada.</div>
        <div><button type="button" className="btn" onClick={() => go({ name: 'today' })}>Voltar</button></div>
      </div></div>
    );
  }

  const lastAfterTwo = gate && gate.rounds.length >= 2 && round?.verdict === 'não assertivo';

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1180, gap: 18 }}>
        <header className="panel-dark" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: '#F9FAFB', borderColor: '#374151' }} aria-label="Voltar" onClick={() => go({ name: 'today' })}>
            <BackIcon />
          </button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: '#93C5FD', fontWeight: 600 }}>
              {gate ? `Gate ${gate.gate} · ${gate.label} · rodada ${gate.rounds.length}` : 'Gate com quiz'} · #{card.iid}
            </div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Wave on={!!player.speaking || rec.recording} color={rec.recording ? '#60A5FA' : '#93C5FD'} level={rec.level} small />
          {gate && (
            <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: '#99F6E4', borderColor: '#2DD4BF' }} disabled={!!busy} onClick={() => void talk()}>
              <MicIcon /> {rec.recording ? 'Enviar fala' : roundDone ? 'Perguntar (espaço)' : 'Responder (espaço)'}
            </button>
          )}
        </header>
        {error && <div className="error">{error}</div>}

        {!gate && (
          <section className="panel" style={{ padding: 20, gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Qual gate?</h2>
            <p className="small muted">O agente lê o artefato, faz o Resumo do gate e até 3 perguntas de consequência. A aprovação continua sendo a sua frase no chat do Claude Code.</p>
            {!options && <span className="spinner" />}
            {options?.length === 0 && <p className="small faint">Esta atividade não tem Investigation, RFC, Spec Funcional, Findings nem Plan no .specs.</p>}
            <div className="row">
              {options?.map((o) => (
                <button key={o.gate} type="button" className="btn btn-dark" disabled={!!busy} onClick={() => void act('O agente está lendo o artefato e montando o quiz…', () => api.startGate(card, o.gate))}>
                  Gate {o.gate} — {o.label}
                </button>
              ))}
            </div>
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
          </section>
        )}

        {gate && round && (
          <>
            <section className="panel" style={{ padding: 20, gap: 8 }}>
              <h2 className="section-title">Resumo do gate</h2>
              <p style={{ lineHeight: 1.6 }}>{gate.summary}</p>
              <span className="mono faint" style={{ wordBreak: 'break-all' }}>{gate.artifact.replace(/^.*\/\.specs\//, '.specs/')}</span>
            </section>

            {round.questions.map((q, i) => {
              const active = i === current;
              return (
                <section key={`${gate.rounds.length}-${i}`} className="panel" style={{ padding: 20, gap: 10, border: active ? '2px solid var(--blue)' : undefined, opacity: !q.answer && !active ? 0.6 : 1 }}>
                  <div className="row spread">
                    <span className="section-title">Pergunta {i + 1} · {q.kind}</span>
                    {roundDone && q.answer && (
                      <span className={`badge ${q.answer.correct ? 'badge-now' : 'badge-block'}`}>{q.answer.correct ? 'certa' : 'errada'}</span>
                    )}
                    {!roundDone && q.answer && <span className="badge badge-quiet">respondida</span>}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4 }}>{q.text}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
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
                          style={right ? { borderColor: 'var(--teal)', borderWidth: 2 } : chosen && roundDone ? { borderColor: 'var(--red)', borderWidth: 2, background: '#FEF2F2' } : undefined}
                        >
                          <span style={{ fontWeight: 600 }}>{LETTERS[oi]})</span> {o}
                        </button>
                      );
                    })}
                  </div>
                  {q.answer?.other && <div className="item"><span className="small">Sua resposta: “{q.answer.other}”</span>{q.answer.comment && <span className="small muted">{q.answer.comment}</span>}</div>}
                  {roundDone && q.explanation && (
                    <div className="item" style={{ background: q.answer?.correct ? 'var(--teal-soft)' : 'var(--amber-soft)', borderColor: q.answer?.correct ? '#99F6E4' : 'var(--amber-line)' }}>
                      <span className="small">{q.explanation}</span>
                      <span className="dest">→ {q.section}</span>
                    </div>
                  )}
                  {active && (
                    <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) answer({ text: draft.trim() }); setDraft(''); }}>
                      <input className="text-input" placeholder="Ou responda com as suas palavras (é avaliado, não aceito direto)" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Resposta livre" />
                      <button type="submit" className="btn" disabled={!draft.trim() || !!busy}>Responder</button>
                    </form>
                  )}
                </section>
              );
            })}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}

            {roundDone && (
              <section className="panel" style={{ padding: 20, gap: 12, borderColor: round.verdict === 'assertivo' ? '#99F6E4' : 'var(--amber-line)' }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>{round.verdict === 'assertivo' ? 'Quiz assertivo' : 'Não assertivo: ciclo de consolidação'}</h2>
                {round.verdict === 'assertivo' ? (
                  <p className="small" style={{ lineHeight: 1.5 }}>
                    O gate abre com a sua frase no chat do Claude Code ({gate.gate === 1 ? '“investigation aprovada, crie o Plan” ou “RFC aprovada, avance”' : '“plan aprovado, execute T01”'}). Grave o registro e continue na sessão.
                  </p>
                ) : (
                  <>
                    <p className="small" style={{ lineHeight: 1.5 }}>
                      Não é nota: é sinal de que o material não ensinou. 1) A seção está citada em cada pergunta errada. 2) Leitura assistida: pergunte por voz ou por texto. 3) Recurso visual para a seção. 4) Nova rodada com perguntas novas.
                    </p>
                    {gate.talk.map((m, i) => (
                      <div key={i} className={`bubble-row ${m.me ? 'me' : ''}`}>
                        <div className="bubble"><div className="who">{m.me ? 'Você' : 'Agente'} · {m.at}</div><div style={{ lineHeight: 1.5 }}>{m.text}</div></div>
                      </div>
                    ))}
                    <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void act('O agente está lendo a seção com você…', () => api.explainGate(gate.id, draft.trim())); setDraft(''); }}>
                      <input className="text-input" placeholder="Pergunte sobre o ponto que escapou" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Pergunta de leitura assistida" />
                      <button type="submit" className="btn" disabled={!draft.trim() || !!busy}>Perguntar</button>
                    </form>
                    {round.visual ? (
                      <div className="item">
                        <span className="small">{round.visual.description} → <span className="mono">{round.visual.heading}</span></span>
                        <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#F7F7F8', padding: 10, borderRadius: 8 }}>{round.visual.mermaid}</pre>
                        {round.visual.inserted ? (
                          <span className="small" style={{ color: 'var(--teal-ink)' }}>Inserido no artefato.</span>
                        ) : confirmInsert ? (
                          <div className="row">
                            <button type="button" className="btn btn-red" disabled={!!busy} onClick={() => void act('Inserindo…', () => api.insertGateVisual(gate.id)).then(() => setConfirmInsert(false))}>Confirmar: escrever no {gate.label}</button>
                            <button type="button" className="btn" onClick={() => setConfirmInsert(false)}>Cancelar</button>
                          </div>
                        ) : (
                          <button type="button" className="btn" onClick={() => setConfirmInsert(true)}>Inserir no artefato</button>
                        )}
                      </div>
                    ) : (
                      <button type="button" className="btn" disabled={!!busy} onClick={() => void act('O agente está desenhando o recurso visual…', () => api.visualGate(gate.id))}>Gerar recurso visual</button>
                    )}
                    {lastAfterTwo && (
                      <div className="item" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber-line)' }}>
                        <span className="small">Duas rodadas erradas: o problema é o material. Reescreva a seção (no Claude Code) e recomece o quiz; se ainda falhar, você decide entre risco aceito no Registro do Plan ou voltar a F1/F2.</span>
                      </div>
                    )}
                    <button type="button" className="btn btn-dark" disabled={!!busy} onClick={() => void act('O agente está montando a nova rodada…', () => api.newGateRound(gate.id))}>Nova rodada sobre o ponto</button>
                  </>
                )}
                <div className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
                  <button type="button" className="btn" disabled={!!gate.recorded || !!busy} onClick={() => void act('Gravando…', () => api.recordGate(gate.id))}>
                    {gate.recorded ? 'Gravado no GATE_QUIZ.md' : 'Gravar no GATE_QUIZ.md'}
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
