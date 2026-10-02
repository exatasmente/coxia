import { useCallback, useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import { api, clock, errorText, plural, shortRef } from '../api';
import { type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, ClockIcon, MicIcon, NextIcon, StopIcon } from './icons';
import { Wave } from './Wave';

type Phase = 'intro' | 'preparing' | 'speaking' | 'idle' | 'listening' | 'transcribing' | 'thinking' | 'ended';

const MODERATOR_COLOR = '#12161C';
const ME_COLOR = '#1D4ED8';

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, '').trim();
}

export function Call({ ceremony: c, player, go }: { ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const cards = c.cards?.cards ?? [];
  const idx = c.callIdx;
  const card = idx >= 0 ? cards[idx] : null;
  const turn = card ? c.turns[card.ref] : undefined;
  const [phase, setPhase] = useState<Phase>(c.callEnded ? 'ended' : idx >= 0 ? 'idle' : 'intro');
  const [turnStart, setTurnStart] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRecorder(() => void talkRef.current());
  const runId = useRef(0);
  const latest = useRef(c);
  latest.current = c;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Moderator opening, once per ceremony.
  useEffect(() => {
    if (idx >= 0 || c.callEnded) return;
    const id = ++runId.current;
    c.start();
    const blocked = cards.filter((x) => x.blockers.length).length;
    const text = `Bom dia. São ${cards.length} atividades, ${blocked} com bloqueio. Começo pelas bloqueadas. Para responder, aperte espaço, fale e aperte de novo.`;
    void (async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (runId.current !== id) return;
      latest.current.addLog('Moderador', text, MODERATOR_COLOR);
      if (latest.current.voices) await player.say(text, latest.current.voices.moderator, 'Moderador').catch(() => undefined);
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
      let t: Awaited<ReturnType<Ceremony['getTurn']>>;
      try {
        t = await latest.current.getTurn(card);
      } catch (e) {
        if (runId.current === id) {
          setError(`O agente da #${card.iid} falhou: ${errorText(e)}`);
          setPhase('idle');
        }
        return;
      }
      if (runId.current !== id) return;
      const cc = latest.current;
      cc.markSpoken(card.ref);
      cc.addLog(`#${card.iid}`, t.speech, cc.colorOf(card.ref));
      setTurnStart(Date.now());
      setPhase('speaking');
      const voice = cc.voiceOf(card.ref);
      if (voice) await player.say(t.speech, voice, card.ref).catch(() => undefined);
      if (runId.current === id) setPhase('idle');
    })();
  }, [card?.ref]);

  const finish = useCallback(async () => {
    runId.current++;
    player.stop();
    const cc = latest.current;
    cc.end();
    setPhase('ended');
    const text = `Fim da pauta. Ficaram ${plural(cc.decisions.length, 'decisão', 'decisões')} e ${plural(cc.effects.length, 'ação', 'ações')} na fila. Vou montar a ata.`;
    cc.addLog('Moderador', text, MODERATOR_COLOR);
    if (cc.voices) await player.say(text, cc.voices.moderator, 'Moderador').catch(() => undefined);
  }, [player]);

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
        setError(`Microfone indisponível: ${errorText(e)}`);
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio) return;
    setPhase('transcribing');
    let text = '';
    try {
      text = (await api.transcribe(audio)).trim();
    } catch (e) {
      setError(`Falha na transcrição: ${errorText(e)}`);
      setPhase('idle');
      return;
    }
    if (!text) {
      setHint('Não entendi. Aperte espaço e fale de novo.');
      setPhase('idle');
      return;
    }
    const cc = latest.current;
    cc.addLog('Você', text, ME_COLOR);
    const cmd = normalize(text);
    if (/^(proximo|pula|passa|segue)\b/.test(cmd)) return next();
    if (/\b(encerra|encerrar|termina|terminar)\b/.test(cmd)) return void finish();
    if (card && /\b(aprofunda|aprofundar|desbloqueio|desbloquear)\b/.test(cmd)) return go({ name: 'deep', ref: card.ref, back: 'call' });
    if (!card || !turn) {
      setPhase('idle');
      return;
    }
    setPhase('thinking');
    try {
      const r = await api.reply(card, turn, text);
      cc.addLog(`#${card.iid}`, r.ack, cc.colorOf(card.ref));
      if (r.decision) cc.addDecision(r.decision);
      if (r.effect) cc.addEffect(r.effect);
      cc.markAnswered(card.ref);
      if (r.needsDeepDive) setHint('O agente sugere aprofundar esta atividade. Diga "aprofunda" ou use o botão.');
      setPhase('speaking');
      const voice = cc.voiceOf(card.ref);
      if (voice) await player.say(r.ack, voice, card.ref).catch(() => undefined);
    } catch (e) {
      setError(`O agente não conseguiu responder: ${errorText(e)}`);
    }
    setPhase('idle');
  }, [card, turn, rec, player, next, finish, go]);

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

  const secs = Math.floor((now - turnStart) / 1000);
  const over = secs > 30;
  const busy = phase === 'transcribing' || phase === 'thinking';
  const speakingWho = player.speaking;
  const pending = cards
    .slice(0, idx + 1)
    .filter((x) => c.turns[x.ref]?.question && !c.answered[x.ref])
    .map((x) => ({ ref: x.ref, iid: x.iid, question: c.turns[x.ref]?.question as string }));
  const speakerLabel =
    phase === 'listening' ? 'Você está falando' :
    phase === 'transcribing' ? 'Transcrevendo…' :
    phase === 'thinking' ? 'Agente pensando…' :
    phase === 'preparing' ? 'Agente lendo o cartão…' :
    speakingWho === 'Moderador' ? 'Moderador falando' :
    speakingWho && card ? `Agente #${card.iid} falando` : 'Aguardando você';

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Pré-daily</h1>
            <span className="pill" style={{ background: '#CCFBF1', color: 'var(--teal-ink)', borderColor: '#CCFBF1', fontWeight: 600 }}>
              <span className="live-dot" />{phase === 'ended' ? 'Encerrada' : 'Ao vivo'} · {clock(c.startedAt ?? now, now)}
            </span>
            <span className="muted small">{phase === 'ended' ? 'Pauta concluída' : idx >= 0 ? `Atividade ${idx + 1} de ${cards.length}` : 'Abertura'}</span>
          </div>
          <button type="button" className="btn btn-red" onClick={() => { if (phase !== 'ended') c.end(); go({ name: 'ata' }); }}>
            <StopIcon /> Encerrar e gerar ata
          </button>
        </header>

        <div className="cols call-layout">
          <aside className="panel call-queue" style={{ flex: '1 1 240px', maxWidth: 300, minWidth: 240, gap: 6 }}>
            <h2 className="section-title" style={{ marginBottom: 8 }}>Pauta</h2>
            {cards.map((x, i) => {
              const done = i < idx || phase === 'ended';
              const nowItem = i === idx && phase !== 'ended';
              const q = c.turns[x.ref]?.question;
              return (
                <div key={x.ref} className={`queue-item ${nowItem ? 'now' : ''} ${done ? 'done' : ''}`}>
                  <div className="chip chip-sm" style={{ background: c.colorOf(x.ref) }}>{shortRef(x.ref)}</div>
                  <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>#{x.iid}</div>
                    <div className="t">{x.title}</div>
                  </div>
                  <span className={`badge ${nowItem ? 'badge-now' : q && !done ? 'badge-ask' : 'badge-quiet'}`} style={{ fontSize: 11 }}>
                    {nowItem ? 'agora' : done ? 'feito' : q ? 'pergunta' : 'na fila'}
                  </span>
                </div>
              );
            })}
          </aside>

          <main className="call-main" style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel-dark">
              {phase === 'ended' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 4px' }}>
                  <div className="small" style={{ color: '#99F6E4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fim da pauta</div>
                  <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.3 }}>
                    {plural(c.decisions.length, 'decisão', 'decisões')}, {plural(c.effects.length, 'efeito', 'efeitos')} na fila e {plural(c.minutes.unanswered.length, 'pergunta', 'perguntas')} sem resposta.
                  </div>
                  <div><button type="button" className="btn btn-accent" onClick={() => go({ name: 'ata' })}>Gerar ata</button></div>
                </div>
              ) : (
                <>
                  <div className="row spread" style={{ alignItems: 'center' }}>
                    {card ? (
                      <div className="row" style={{ gap: 16, flexWrap: 'nowrap', minWidth: 0 }}>
                        <div className="chip chip-lg" style={{ background: c.colorOf(card.ref), boxShadow: speakingWho === card.ref ? '0 0 0 6px rgba(45,212,191,0.25)' : 'none' }}>
                          {shortRef(card.ref)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                            <span className="mono" style={{ color: '#9CA3AF' }}>#{card.iid}</span>
                            <span className="small" style={{ color: '#9CA3AF' }}>{[card.stage, card.spec?.phase].filter(Boolean).join(' · ')}</span>
                          </div>
                          <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.25 }}>{card.title}</div>
                          <div className="small" style={{ color: '#9CA3AF', marginTop: 4 }}>
                            {card.mrs.join(' · ') || 'sem MR'} · voz {c.voiceOf(card.ref)?.label}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="row" style={{ gap: 16 }}>
                        <div className="chip chip-lg" style={{ background: '#374151' }}>M</div>
                        <div>
                          <div className="small" style={{ color: '#9CA3AF' }}>Moderador · voz {c.voices?.moderator.label}</div>
                          <div style={{ fontSize: 21, fontWeight: 600 }}>Abertura da pré-daily</div>
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
                    <Wave on={!!speakingWho || rec.recording} color={rec.recording ? '#60A5FA' : '#2DD4BF'} level={rec.level} />
                    <span className={`speaker ${rec.recording ? 'me' : !speakingWho && !busy && phase !== 'preparing' ? 'idle' : ''}`}>{speakerLabel}</span>
                  </div>

                  {card && (
                    <div className="quad">
                      <div>
                        <div className="lbl">Andou</div>
                        <div>{turn?.did ?? <span className="spinner" />}</div>
                      </div>
                      <div>
                        <div className="lbl">Próximo</div>
                        <div>{turn?.next ?? <span className="spinner" />}</div>
                      </div>
                      <div className={turn?.blocker ? 'block' : ''}>
                        <div className="lbl">Bloqueio</div>
                        <div>{turn ? turn.blocker ?? 'Sem bloqueio.' : <span className="spinner" />}</div>
                      </div>
                      <div className={turn?.question && !c.answered[card.ref] ? 'ask' : ''}>
                        <div className="lbl">Para você</div>
                        <div>{turn ? (turn.question ? (c.answered[card.ref] ? `Respondida: ${turn.question}` : turn.question) : 'Nada para decidir.') : <span className="spinner" />}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {phase !== 'ended' && (
              <div className="row" role="toolbar" aria-label="Controles da call">
                <button type="button" className={`btn ${rec.recording ? 'btn-rec' : 'btn-blue'}`} disabled={busy || phase === 'intro'} onClick={() => void talk()}>
                  <MicIcon />
                  {rec.recording ? 'Enviar fala (espaço)' : phase === 'transcribing' ? 'Transcrevendo…' : phase === 'thinking' ? 'Pensando…' : 'Falar (espaço)'}
                </button>
                <button type="button" className="btn" disabled={!speakingWho} onClick={() => player.stop()}>Interromper</button>
                <button type="button" className="btn btn-amber" disabled={!card} onClick={() => card && go({ name: 'deep', ref: card.ref, back: 'call' })}>Aprofundar</button>
                <ContinueInClaude sessionId={turn?.sessionId} />
                <span className="grow" />
                <button type="button" className="btn btn-dark" disabled={phase === 'intro' || busy || rec.recording} onClick={next}>
                  {idx >= cards.length - 1 ? 'Fechar pauta' : 'Próximo agente'} <NextIcon />
                </button>
              </div>
            )}
            {hint && <div className="item ask small">{hint}</div>}
            {error && <div className="error">{error}</div>}

            <section className="panel" aria-live="polite" style={{ gap: 4 }}>
              <div className="row spread" style={{ marginBottom: 6 }}>
                <h2 className="section-title">Transcrição</h2>
                <span className="faint">whisper local · últimas falas</span>
              </div>
              {c.log.slice(-8).map((l, i) => (
                <div key={`${l.at}-${i}`} className="log-line">
                  <span className="at">{l.at}</span>
                  <span className="who" style={{ color: l.color }}>{l.who}</span>
                  <span className="text">{l.text}</span>
                </div>
              ))}
            </section>
          </main>

          <aside className="call-side" style={{ flex: '1 1 300px', maxWidth: 360, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="panel">
              <h2 className="section-title">Pendente de você · {pending.length}</h2>
              {!pending.length && <p className="small faint">Nenhuma pergunta em aberto.</p>}
              {pending.map((p) => (
                <div key={p.ref} className="item ask">
                  <div className="mono" style={{ fontSize: 12, color: 'var(--blue-ink)' }}>#{p.iid}</div>
                  <div className="small">{p.question}</div>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2 className="section-title">Decisões · {c.decisions.length}</h2>
              {!c.decisions.length && <p className="small faint">Responda a um agente e a decisão aparece aqui, com o lugar onde vai ser gravada.</p>}
              {c.decisions.map((d, i) => (
                <div key={`${d.ref}-${i}`} className="item">
                  <div className="small">{d.text}</div>
                  <div className="dest">→ {d.dest}</div>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="row spread">
                <h2 className="section-title">Fila de efeitos · {c.effects.length}</h2>
                <span className="badge-e3">E3</span>
              </div>
              {c.effects.map((e, i) => (
                <div key={`${e.ref}-${i}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', padding: '10px 0', borderTop: '1px solid var(--line-2)' }}>
                  <ClockIcon />
                  <div>
                    <div className="small">{e.text}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{e.repo} · {e.ref}</div>
                  </div>
                </div>
              ))}
              <p className="faint" style={{ fontSize: 12, lineHeight: 1.45 }}>Nada daqui roda na call. Cada item vai para o Claude Code e espera o seu “sim”.</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
