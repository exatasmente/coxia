import { useCallback, useEffect, useRef, useState } from 'react';
import { destination } from '../../../shared/destination';
import type { DeepOption } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText, shortRef } from '../api';
import { type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { BackIcon, MicIcon } from './icons';
import { Wave } from './Wave';

type Msg = { me: boolean; text: string; at: string };

const OPENING = 'Explique o bloqueio desta atividade, o que você leu para chegar nisso e o que precisa de mim para destravar.';

export function Deep({
  ceremony: c,
  player,
  go,
  refName,
  back,
}: { ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void; refName: string; back: 'today' | 'call' }) {
  const card = c.cards?.cards.find((x) => x.ref === refName);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<DeepOption[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState('');
  const [started] = useState(Date.now());
  const rec = useRecorder();
  const opened = useRef(false);
  const time = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const ask = useCallback(
    async (question: string, shown = true) => {
      if (!card) return;
      setError(null);
      if (shown) setMsgs((m) => [...m, { me: true, text: question, at: time() }]);
      setBusy('O agente está lendo e investigando…');
      try {
        const r = await api.deepAsk(card, question, sessionId);
        setSessionId(r.sessionId);
        setSources((s) => [...new Set([...s, ...r.sources])]);
        setMsgs((m) => [...m, { me: false, text: r.speech, at: time() }]);
        setBusy(null);
        const voice = c.voiceOf(card.ref);
        if (voice) await player.say(r.speech, voice, card.ref).catch(() => undefined);
      } catch (e) {
        setError(errorText(e));
        setBusy(null);
      }
    },
    [card, sessionId, c, player],
  );

  useEffect(() => {
    if (opened.current || !card) return;
    opened.current = true;
    void ask(OPENING, false);
  }, [card, ask]);

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
      const text = (await api.transcribe(audio)).trim();
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
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, button')) return;
      e.preventDefault();
      void talkRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const propose = async () => {
    if (!card || !sessionId) return;
    setBusy('O agente está montando as saídas…');
    setError(null);
    try {
      const opts = await api.deepOptions(card, sessionId);
      setOptions(opts);
      setPick(Math.max(0, opts.findIndex((o) => o.recommended)));
      setSaved(false);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
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
    setSaved(true);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="panel-dark" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: '#F9FAFB', borderColor: '#374151' }} aria-label="Voltar" onClick={() => go({ name: back })}>
            <BackIcon />
          </button>
          <div className="chip" style={{ width: 48, height: 48, borderRadius: 14, fontSize: 18, background: c.colorOf(card.ref) }}>{shortRef(card.ref)}</div>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: '#FCD34D', fontWeight: 600 }}>Desbloqueio · #{card.iid}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{card.title}</div>
          </div>
          <Wave on={!!player.speaking || rec.recording} color={rec.recording ? '#60A5FA' : '#FDBA74'} small />
          <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: '#99F6E4', borderColor: '#2DD4BF' }} disabled={!!busy} onClick={() => void talk()}>
            <MicIcon /> {rec.recording ? 'Enviar fala' : 'Falar (espaço)'}
          </button>
          <button type="button" className="btn btn-red" onClick={() => go({ name: back })}>Encerrar</button>
        </header>

        <div className="cols">
          <aside className="panel" style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 250, gap: 12 }}>
            <h2 className="section-title">O que o agente leu</h2>
            {card.blockers.map((b) => (
              <div key={b} className="item" style={{ borderColor: '#FECACA', background: '#FEF2F2' }}>
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

          <main className="panel" style={{ flex: '3 1 480px', minWidth: 0, padding: '18px 20px', gap: 14 }} aria-live="polite">
            <div className="row spread">
              <h2 className="section-title">Conversa</h2>
              <span className="faint">transcrição ao vivo</span>
            </div>
            {msgs.map((m, i) => (
              <div key={i} className={`bubble-row ${m.me ? 'me' : ''}`}>
                <div className="bubble">
                  <div className="who">{m.me ? 'Você' : `Agente #${card.iid}`} · {m.at}</div>
                  <div style={{ lineHeight: 1.5 }}>{m.text}</div>
                </div>
              </div>
            ))}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {error && <div className="error">{error}</div>}
            <form
              className="row"
              style={{ flexWrap: 'nowrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() && !busy) void ask(draft.trim());
                setDraft('');
              }}
            >
              <input className="text-input" placeholder="Ou digite a pergunta" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Pergunta para o agente" />
              <button type="submit" className="btn btn-dark" disabled={!!busy || !draft.trim()}>Perguntar</button>
            </form>
          </main>

          <aside style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 290, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="panel">
              <h2 className="section-title">Saídas possíveis</h2>
              {!options && (
                <>
                  <p className="small faint">Quando a conversa tiver contexto suficiente, peça ao agente de 2 a 3 saídas com as consequências.</p>
                  <button type="button" className="btn btn-dark" disabled={!sessionId || !!busy} onClick={() => void propose()}>Propor saídas</button>
                </>
              )}
              {options?.map((o, i) => (
                <button key={o.title} type="button" className={`option ${pick === i ? 'on' : ''}`} aria-pressed={pick === i} onClick={() => { setPick(i); setSaved(false); }}>
                  <span className="row spread" style={{ alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{String.fromCharCode(65 + i)}. {o.title}</span>
                    {o.recommended && <span className="badge" style={{ background: '#CCFBF1', color: 'var(--teal-ink)', fontSize: 11 }}>recomendada</span>}
                  </span>
                  <span className="small muted" style={{ display: 'block', marginTop: 6, lineHeight: 1.45 }}>{o.consequence}</span>
                  <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--red-ink)', marginTop: 6 }}>{o.effect ? `E3 · ${o.effect}` : 'sem efeito'}</span>
                </button>
              ))}
              {options && <button type="button" className="btn" disabled={!!busy} onClick={() => void propose()}>Propor de novo</button>}
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
