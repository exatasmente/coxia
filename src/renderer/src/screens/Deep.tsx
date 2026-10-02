import { useCallback, useEffect, useRef, useState } from 'react';
import { destination } from '../../../shared/destination';
import type { Card, DeepAnswer, DeepState } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText, shortRef } from '../api';
import { transcribeAudio, type usePlayer, useRecorder } from '../audio';
import { type Ceremony, EMPTY_DEEP } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';

const OPENING = 'Explique o bloqueio desta atividade, o que você leu para chegar nisso e o que precisa de mim para destravar.';

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function Deep({
  ceremony: c,
  player,
  go,
  refName,
  back,
  passedCard,
}: {
  ceremony: Ceremony;
  player: ReturnType<typeof usePlayer>;
  go: (s: Screen) => void;
  refName: string;
  back: 'today' | 'call';
  passedCard?: Card;
}) {
  const card = c.cards?.cards.find((x) => x.ref === refName) ?? passedCard;
  const { sessionId, msgs, sources, options, pick, saved } = c.deep[refName] ?? EMPTY_DEEP;
  const { updateDeep } = c;
  const update = useCallback((change: (d: DeepState) => DeepState) => updateDeep(refName, change), [updateDeep, refName]);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rec = useRecorder(() => void talkRef.current());
  const opened = useRef(false);
  const session = useRef(sessionId);
  session.current = sessionId;

  // The answer is written into the ceremony store by the job itself, so it lands even if this screen is gone by then.
  const ask = useCallback(
    (question: string, shown = true) => {
      if (!card) return;
      const key = `deep:${card.ref}:ask`;
      if (jobs.get(key)?.status === 'running') return;
      setError(null);
      if (shown) update((d) => ({ ...d, msgs: [...d.msgs, { me: true, text: question, at: now() }] }));
      jobs.launch(key, { label: `Conversa da ${card.iid}`, busy: 'O agente está lendo e investigando…', screen: { name: 'deep', ref: card.ref, back, card } }, async () => {
        const r = await api.deepAsk(card, question, session.current);
        update((d) => ({
          ...d,
          sessionId: r.sessionId,
          sources: [...new Set([...d.sources, ...r.sources])],
          msgs: [...d.msgs, { me: false, text: r.text, speech: r.speech, at: now() }],
        }));
        return r;
      });
    },
    [card, update, back],
  );

  // A conversation already on disk is resumed as is; only a new one starts with the opening question.
  useEffect(() => {
    if (opened.current || !card) return;
    opened.current = true;
    if (!msgs.length && !sessionId && !jobs.get(`deep:${card.ref}:ask`)) ask(OPENING, false);
  }, [card, ask, msgs.length, sessionId]);

  const running = useJobs<DeepAnswer>(`deep:${refName}:`, {
    done: (r, job, late) => {
      const voice = c.voiceOf(refName);
      if (!late && job.key.endsWith(':ask') && voice) void player.say(r.speech, voice, refName).catch(() => undefined);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running, localBusy);

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
    if (!audio) return;
    setBusy('Transcrevendo…');
    try {
      const text = await transcribeAudio(audio);
      setBusy(null);
      if (text) await ask(text);
    } catch (e) {
      setBusy(null);
      setError(`Falha na transcrição: ${errorText(e)}`);
    }
  }, [rec, player, ask]);

  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, button, select, a')) return;
      e.preventDefault();
      void talkRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const propose = () => {
    if (!card || !sessionId) return;
    setError(null);
    jobs.launch(`deep:${card.ref}:options`, { label: `Saídas da ${card.iid}`, busy: 'O agente está montando as saídas…', screen: { name: 'deep', ref: card.ref, back, card } }, async () => {
      const opts = await api.deepOptions(card, sessionId);
      update((d) => ({ ...d, options: opts, pick: Math.max(0, opts.findIndex((o) => o.recommended)), saved: false }));
      return opts;
    });
  };

  if (!card) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="error">Atividade {refName} não está nos cartões de hoje.</div>
          <div><button type="button" className="btn" onClick={() => go({ name: back })}>Voltar</button></div>
        </div>
      </div>
    );
  }

  const chosen = pick !== null && options ? options[pick] : null;
  const target = card.spec?.planFile ? 'spec' : 'ata';

  const keep = () => {
    if (!chosen) return;
    c.addDecision({ ref: card.ref, text: chosen.decision, target, dest: destination(card, target) });
    if (chosen.effect) c.addEffect({ ref: card.ref, text: chosen.effect, repo: card.mrs[0]?.split('!')[0] ?? card.ref.split('#')[0] });
    c.markAnswered(card.ref);
    update((d) => ({ ...d, saved: true }));
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="panel-dark hero" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label="Voltar" onClick={() => go({ name: back })}>
            <BackIcon />
          </button>
          <div className="chip" style={{ width: 48, height: 48, borderRadius: 14, fontSize: 18, background: c.colorOf(card.ref) }}>{shortRef(card.ref)}</div>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-amber)', fontWeight: 600 }}>Desbloqueio · #{card.iid}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Presence recording={rec.recording} thinking={!!busy} on={!!player.speaking || rec.recording} color={rec.recording ? 'var(--rec-blue)' : 'var(--night-orange)'} level={rec.level} small />
          <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy} onClick={() => void talk()}>
            <MicIcon /> {rec.recording ? 'Enviar fala' : 'Falar (espaço)'}
          </button>
          <ContinueInClaude sessionId={sessionId} dark />
          <button type="button" className="btn btn-red" onClick={() => go({ name: back })}>Encerrar</button>
        </header>

        <div className="cols deep-layout">
          <aside className="panel deep-sources" style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 250, gap: 12 }}>
            <h2 className="section-title">O que o agente leu</h2>
            {card.blockers.map((b) => (
              <div key={b} className="item" style={{ borderColor: 'var(--red-line)', background: 'var(--red-faint)' }}>
                <div className="small" style={{ color: 'var(--red-ink)' }}>{b}</div>
              </div>
            ))}
            {card.spec && (
              <div className="item">
                <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{card.spec.folder.replace(/^.*\/\.specs\//, '.specs/')}</div>
                <div className="small muted">{card.spec.phase}</div>
              </div>
            )}
            {sources.map((s) => (
              <div key={s} className="item">
                <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{s.replace(/^\/home\/[^/]+\/projects\//, '')}</div>
              </div>
            ))}
            {!sources.length && <p className="faint">As leituras do agente aparecem aqui.</p>}
          </aside>

          <main className="panel deep-main" style={{ flex: '3 1 480px', minWidth: 0, padding: '18px 20px', gap: 14 }} aria-live="polite">
            <div className="row spread">
              <h2 className="section-title">Conversa</h2>
              <span className="faint">transcrição ao vivo</span>
            </div>
            {msgs.map((m, i) => (
              <Bubble key={i} m={m} who={m.me ? 'Você' : `Agente #${card.iid}`} voice={c.voiceOf(card.ref)} player={player} speaker={card.ref} />
            ))}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {error && <div className="error">{error}</div>}
            <form
              className="row composer"
              style={{ flexWrap: 'nowrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() && !busy) ask(draft.trim());
                setDraft('');
              }}
            >
              <input className="text-input" placeholder="Ou digite a pergunta" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Pergunta para o agente" />
              <button type="submit" className="btn btn-dark" disabled={!!busy || !draft.trim()}>Perguntar</button>
            </form>
          </main>

          <aside className="deep-side" style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 290, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="panel">
              <h2 className="section-title">Saídas possíveis</h2>
              {!options && (
                <>
                  <p className="small faint">Quando a conversa tiver contexto suficiente, peça ao agente de 2 a 3 saídas com as consequências.</p>
                  <button type="button" className="btn btn-dark" disabled={!sessionId || !!busy} onClick={() => propose()}>Propor saídas</button>
                </>
              )}
              {options?.map((o, i) => (
                <button key={o.title} type="button" className={`option ${pick === i ? 'on' : ''}`} aria-pressed={pick === i} onClick={() => update((d) => ({ ...d, pick: i, saved: false }))}>
                  <span className="row spread" style={{ alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{String.fromCharCode(65 + i)}. {o.title}</span>
                    {o.recommended && <span className="badge" style={{ background: 'var(--chip-teal-bg)', color: 'var(--chip-teal-ink)', fontSize: 11 }}>recomendada</span>}
                  </span>
                  <span className="small muted" style={{ display: 'block', marginTop: 6, lineHeight: 1.45 }}>{o.consequence}</span>
                  <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--red-ink)', marginTop: 6 }}>{o.effect ? `E3 · ${o.effect}` : 'sem efeito'}</span>
                </button>
              ))}
              {options && <button type="button" className="btn" disabled={!!busy} onClick={() => propose()}>Propor de novo</button>}
            </section>
            {chosen && (
              <section className="panel" style={{ border: saved ? '2px solid var(--teal)' : undefined }}>
                <h2 className="section-title">Vai para a ata</h2>
                <div className="small" style={{ lineHeight: 1.5 }}>{chosen.decision}</div>
                <div className="dest">→ {destination(card, target)}</div>
                <button type="button" className={`btn ${saved ? 'btn-on' : 'btn-dark'}`} disabled={saved} onClick={keep}>
                  {saved ? 'Na ata' : 'Levar para a ata'}
                </button>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
