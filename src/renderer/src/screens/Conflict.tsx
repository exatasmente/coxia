import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { transcribeAudio, type usePlayer, useRecorder } from '../audio';
import type { Ceremony } from '../ceremony';
import { busyText, jobs, useJobs } from '../useJobs';
import { AgentActivity } from '../AgentActivity';
import { ConflictResolver } from './ConflictResolver';
import { ContinueInClaude } from './ContinueInClaude';
import { BackIcon, MicIcon } from './icons';
import { Bubble } from './Bubble';
import { Presence } from './Avatar';
import { tv } from '../i18n';
import { useVoiceEnabled } from '../i18n';
import { voiceEnabled } from '../../../shared/i18n';

const OPENING = 'Explique o conflito: o que cada lado mudou, por que conflita e a resolução que você propõe, com o que testar depois.';

export function Conflict({
  action,
  ceremony: c,
  player,
  go,
}: { action: ReleaseAction | undefined; ceremony: Ceremony; player: ReturnType<typeof usePlayer>; go: (s: Screen) => void }) {
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const voiceOn = useVoiceEnabled();
  const rec = useRecorder(() => void talkRef.current());
  const opened = useRef(false);
  const voice = c.voices?.agents[2] ?? null;

  // The updated action reaches the app through the actions event; the job only carries the busy state and the spoken answer.
  const ask = useCallback(
    (question: string) => {
      if (!action) return;
      setError(null);
      jobs.launch(`conflict:${action.id}:ask`, { label: `Conflito da ${action.issue}`, busy: 'O agente está lendo os dois lados do conflito…', screen: { name: 'conflict', id: action.id } }, () => api.conflictAsk(action.id, question));
    },
    [action],
  );

  useEffect(() => {
    if (opened.current || !action) return;
    opened.current = true;
    if (!action.msgs.length && !action.sessionId && !jobs.get(`conflict:${action.id}:ask`)) ask(OPENING);
  }, [action, ask]);

  const running = useJobs<ReleaseAction>(action ? `conflict:${action.id}:` : null, {
    done: (updated, _job, late) => {
      const last = updated.msgs[updated.msgs.length - 1];
      if (!late && voice && last && !last.me) void player.say(last.speech ?? last.text, voice, 'conflito').catch(() => undefined);
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
      if (text) ask(text);
    } catch (e) {
      setBusy(null);
      setError(`Falha na transcrição: ${errorText(e)}`);
    }
  }, [rec, player, ask]);

  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !voiceEnabled() || e.repeat || (e.target as HTMLElement).closest('input, textarea, button, select, a')) return;
      e.preventDefault();
      void talkRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!action) {
    return (
      <div className="page"><div className="wrap">
        <div className="error">Conflito não encontrado.</div>
        <div><button type="button" className="btn" onClick={() => go({ name: 'actions' })}>Voltar</button></div>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 18 }}>
        <header className="panel-dark hero" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 20px', borderRadius: 18 }}>
          <button type="button" className="btn icon-btn" style={{ background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} aria-label="Voltar" onClick={() => go({ name: 'actions' })}>
            <BackIcon />
          </button>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="small" style={{ color: 'var(--night-amber)', fontWeight: 600 }}>Conflito · #{action.issue} · release {action.release}</div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{action.issueTitle}</div>
          </div>
          <Presence recording={rec.recording} thinking={!!busy} on={!!player.speaking || rec.recording} color={rec.recording ? 'var(--rec-blue)' : 'var(--night-orange)'} level={rec.level} small />
          {voiceOn && (
            <button type="button" className={`btn ${rec.recording ? 'btn-rec' : ''}`} style={rec.recording ? undefined : { background: 'transparent', color: 'var(--night-teal)', borderColor: 'var(--teal-bright)' }} disabled={!!busy} onClick={() => void talk()}>
              <MicIcon /> {rec.recording ? 'Enviar fala' : 'Falar (espaço)'}
            </button>
          )}
        </header>

        <ConflictResolver action={action} />

        <div className="cols deep-layout">
          <aside className="panel deep-sources" style={{ flex: '1 1 260px', maxWidth: 320, minWidth: 250, gap: 10 }}>
            <h2 className="section-title">Em conflito</h2>
            {action.mrs.map((m) => (
              <a key={m.ref} className="item mono small" href={m.url} target="_blank" rel="noreferrer">{m.ref} · {m.branch} · {m.behind} atrás</a>
            ))}
            {action.files.map((f) => <div key={f} className="item mono" style={{ fontSize: 12, wordBreak: 'break-all', borderColor: 'var(--red-line)', background: 'var(--red-faint)' }}>{f}</div>)}
          </aside>

          <main className="panel deep-main" style={{ flex: '3 1 480px', minWidth: 0, padding: '18px 20px', gap: 14 }} aria-live="polite">
            <h2 className="section-title">Conversa</h2>
            {action.msgs.map((m, i) => (
              <Bubble key={i} m={m} who={m.me ? 'Você' : 'Agente'} voice={voice} player={player} speaker="conflito" />
            ))}
            {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
            {busy && <AgentActivity jobId={running[0]?.key} since={running[0]?.startedAt} />}
            {error && <div className="error">{error}</div>}
            <form
              className="row composer"
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

          <aside className="deep-side" style={{ flex: '1 1 320px', maxWidth: 400, minWidth: 290, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="panel">
              <h2 className="section-title">{tv('call.after')}</h2>
              <p className="small" style={{ lineHeight: 1.5 }}>
                Concordou com a resolução? Resolva acima, na worktree temporária (merge, nunca rebase; push sem force só com o seu “sim”), ou continue no Claude Code, nesta mesma sessão.
              </p>
              <ContinueInClaude sessionId={action.sessionId} />
              <button type="button" className="btn" disabled={action.state !== 'pending'} onClick={() => void api.skipAction(action.id).then(() => go({ name: 'actions' }))}>
                {action.state === 'pending' ? (action.resolve ? 'Tratei fora (remove a worktree)' : 'Marcar como tratado') : 'Tratado'}
              </button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
