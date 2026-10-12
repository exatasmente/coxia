import { useEffect, useRef, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { agentThreadId } from '../../../../shared/forum';
import type { Voice } from '../../../../shared/types';
import type { Screen } from '../../App';
import { unlockAudio } from '../../audio';
import { isIos } from '../../audioSession';
import { HOME } from '../../home';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import type { Player } from '../../voice/playback';
import { isVoiceShortcut } from '../../voice/shortcut';
import { useVoiceGate } from '../../voice/useVoiceGate';
import { useVoiceSession } from '../../voice/useVoiceSession';
import { mayRecord } from '../../voice/voiceGate';
import { Presence } from '../Avatar';
import { agentName } from '../cycle/names';
import { GateNote, stateText } from './VoiceChatControls';
import './voice-mode.css';

// Voice mode: a screen of its own for a spoken conversation with the persona. Not a ceremony: no agenda, just talking, hands-free until the person ends it. What is said
// and answered goes to the persona's chat, so leaving shows the whole exchange there, transcribed.

/** Ctrl+Shift+M (Cmd+Shift+M on a Mac) opens voice mode from any screen and leaves it when it is open. Not bound in a paired browser, nor without a persona. */
export function useVoiceShortcut(current: Screen['name'], go: (s: Screen) => void, hasPersona: boolean) {
  useEffect(() => {
    if (!hasPersona) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isVoiceShortcut(e, isWeb())) return;
      e.preventDefault();
      unlockAudio();
      go(current === 'voice' ? HOME : { name: 'voice' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, go, hasPersona]);
}

interface Props {
  persona: AgentDef;
  player: Player;
  voice: Voice | null;
  go: (s: Screen) => void;
}

interface WakeLockLike {
  release(): Promise<void>;
}

export function VoiceModeScreen({ persona, player, voice, go }: Props) {
  const t = useT();
  const gate = useVoiceGate();
  const name = agentName([persona], persona.id);
  const session = useVoiceSession({ thread: agentThreadId(persona.id), player, voice, who: persona.id, pauseWhenHidden: isWeb() });
  const [captions, setCaptions] = useState(true);
  const started = useRef(false);
  const { phase, muted } = session.loop;
  const paused = phase === 'paused';

  // Hands-free from the moment it opens, once the gate lets it record.
  useEffect(() => {
    if (started.current || !mayRecord(gate)) return;
    started.current = true;
    session.send({ type: 'start', handsFree: true });
  }, [gate, session]);

  // The screen stays on while the conversation runs, where the browser offers it; released when paused or left.
  useEffect(() => {
    if (paused) return;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } };
    let lock: WakeLockLike | null = null;
    let live = true;
    nav.wakeLock?.request('screen').then(
      (l) => {
        if (live) lock = l;
        else void l.release().catch(() => undefined);
      },
      () => undefined,
    );
    return () => {
      live = false;
      void lock?.release().catch(() => undefined);
    };
  }, [paused]);

  const end = () => {
    session.send({ type: 'end' });
    go(HOME);
  };
  const ready = mayRecord(gate);
  const listening = phase === 'listening';
  const speaking = phase === 'speaking';

  return (
    <main className="voice-mode" aria-label={t('ui.voice.mode.title', { agent: name })}>
      <h1 className="voice-mode-title">{t('ui.voice.mode.title', { agent: name })}</h1>
      <div className="voice-mode-stage">
        <Presence
          on={speaking || listening}
          recording={listening}
          thinking={phase === 'thinking' || phase === 'transcribing'}
          color={listening ? 'var(--rec-blue)' : 'var(--night-violet)'}
          level={session.level}
        />
      </div>
      <p className={`voice-mode-state ${listening ? 'voice-mode-state-mic' : ''}`} role="status" aria-live="polite">
        {stateText(t, session.label)}
      </p>
      {!ready && gate !== 'loading' && <GateNote gate={gate} onSettings={() => go({ name: 'settings' })} />}
      {session.error && (
        <p className="voice-note voice-note-error voice-mode-error" role="alert">
          {session.error}
        </p>
      )}
      {captions && (session.heard || session.caption) && (
        <div className="voice-mode-captions" aria-label={t('ui.voice.mode.captions')}>
          {session.heard && (
            <p>
              <span className="voice-mode-who">{t('ui.voice.mode.you')}</span> {session.heard}
            </p>
          )}
          {session.caption && (
            <p>
              <span className="voice-mode-who">{name}</span> {session.caption}
            </p>
          )}
        </div>
      )}
      <div className="voice-mode-controls">
        {paused && (
          <button type="button" className="btn btn-dark" onClick={() => session.send({ type: 'resume' })}>
            {t('ui.voice.mode.resume')}
          </button>
        )}
        {ready && phase === 'idle' && !muted && (
          <button type="button" className="btn btn-dark" onClick={() => session.send({ type: 'start', handsFree: true })}>
            {t('ui.voice.mode.start')}
          </button>
        )}
        {/* iOS has no barge-in: talking over the persona is a tap there */}
        {speaking && (isIos() || muted) && (
          <button type="button" className="btn" onClick={() => session.send({ type: 'interrupt' })}>
            {t('ui.voice.mode.interrupt')}
          </button>
        )}
        <button type="button" className="btn" aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>
          {t('ui.voice.mode.captions')}
        </button>
        <button type="button" className="btn" aria-pressed={muted} disabled={!ready} onClick={() => session.send({ type: muted ? 'unmute' : 'mute' })}>
          {muted ? t('ui.voice.mode.unmute') : t('ui.voice.mode.mute')}
        </button>
        <button type="button" className="btn voice-mode-end" onClick={end}>
          {t('ui.voice.mode.end')}
        </button>
      </div>
    </main>
  );
}
