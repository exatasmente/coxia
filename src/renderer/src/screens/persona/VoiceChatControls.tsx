import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { Voice } from '../../../../shared/types';
import { unlockAudio } from '../../audio';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { useIsPhone } from '../../useIsPhone';
import type { Player } from '../../voice/playback';
import { useVoiceGate } from '../../voice/useVoiceGate';
import { useVoiceSession } from '../../voice/useVoiceSession';
import { type VoiceGate, mayRecord, offersSettings } from '../../voice/voiceGate';
import type { LoopLabel } from '../../voice/voiceLoop';
import { agentName } from '../cycle/names';
import { HandsFreeIcon, MicIcon, VoiceModeIcon } from './navIcons';
import './voice-mode.css';

// The voice controls in the persona's box: talk (press, speak, press again or go quiet to send), hands-free (it listens again after each answer) and voice mode.
// They are always drawn; with the voice off or not installed a tap says so and points to the voice settings, and nothing records or downloads.

interface Props {
  thread: string;
  persona: AgentDef;
  player: Player;
  voice: Voice | null;
  onSettings: () => void;
  onVoiceMode: () => void;
}

/** The word of a session's state, for the visual and the screen reader. */
export function stateText(t: ReturnType<typeof useT>, label: LoopLabel): string {
  switch (label) {
    case 'listening':
      return t('ui.voice.mode.state.listening');
    case 'thinking':
      return t('ui.voice.mode.state.thinking');
    case 'speaking':
      return t('ui.voice.mode.state.speaking');
    case 'muted':
      return t('ui.voice.mode.state.muted');
    case 'paused':
      return t('ui.voice.mode.state.paused');
    default:
      return t('ui.voice.mode.state.ready');
  }
}

/** What a gate that cannot record says. */
export function gateMessage(t: ReturnType<typeof useT>, gate: VoiceGate): string {
  switch (gate) {
    case 'off':
      return t('ui.voice.chat.off');
    case 'missing':
      return t('ui.voice.chat.missing');
    case 'web-off':
      return t('ui.voice.chat.webOff');
    case 'insecure':
      return t('ui.voice.mic.insecure');
    case 'unsupported':
      return t('ui.voice.mic.unsupported');
    default:
      return '';
  }
}

/** The note of a gate that cannot record, with the way to the voice settings where they can be changed. */
export function GateNote({ gate, onSettings, onClose }: { gate: VoiceGate; onSettings: () => void; onClose?: () => void }) {
  const t = useT();
  return (
    <div className="voice-note" role="status">
      <span>{gateMessage(t, gate)}</span>
      <span className="voice-note-actions">
        {offersSettings(gate) && (
          <button type="button" className="btn btn-dark" onClick={onSettings}>
            {t('ui.voice.chat.openSettings')}
          </button>
        )}
        {onClose && (
          <button type="button" className="btn" onClick={onClose}>
            {t('ui.voice.chat.dismiss')}
          </button>
        )}
      </span>
    </div>
  );
}

export function VoiceChatControls({ thread, persona, player, voice, onSettings, onVoiceMode }: Props) {
  const t = useT();
  const gate = useVoiceGate();
  const phone = useIsPhone();
  const [note, setNote] = useState(false);
  const session = useVoiceSession({ thread, player, voice, who: persona.id, pauseWhenHidden: isWeb() });
  const name = agentName([persona], persona.id);
  const { phase, handsFree } = session.loop;
  const listening = phase === 'listening';

  // Every control passes the gate first: a voice that cannot record only shows the note.
  const guarded = (fn: () => void) => () => {
    if (!mayRecord(gate)) {
      setNote(gate !== 'loading');
      return;
    }
    setNote(false);
    unlockAudio();
    fn();
  };

  const talk = guarded(() => {
    if (phase === 'listening') session.send({ type: 'send' });
    else if (phase === 'speaking' || phase === 'thinking') session.send({ type: 'interrupt' });
    else if (phase === 'paused') session.send({ type: 'resume' });
    else if (phase === 'idle') session.send({ type: 'start', handsFree: false });
  });
  const toggleHandsFree = guarded(() => session.send(handsFree ? { type: 'stop' } : { type: 'start', handsFree: true }));
  const openMode = guarded(() => {
    session.send({ type: 'stop' });
    onVoiceMode();
  });

  const talkLabel = listening ? t('ui.voice.chat.micStop') : t('ui.voice.chat.mic', { agent: name });
  // On the paired phone, with the voice ready, voice mode is the main way in.
  const modeMain = isWeb() && phone && mayRecord(gate);

  return (
    <span className="voice-controls">
      {note && <GateNote gate={gate} onSettings={onSettings} onClose={() => setNote(false)} />}
      {session.error && (
        <span className="voice-note voice-note-error" role="alert">
          {session.error}
        </span>
      )}
      {phase === 'paused' && (
        <span className="voice-note" role="status">
          {t('ui.voice.mode.resume')}
        </span>
      )}
      <button type="button" className={`btn icon-btn cy-inline-btn ${listening ? 'voice-on' : ''}`} aria-pressed={listening} aria-label={talkLabel} title={talkLabel} onClick={talk}>
        {phase === 'transcribing' ? <span className="spinner" aria-hidden="true" /> : <MicIcon />}
      </button>
      <button
        type="button"
        className={`btn icon-btn cy-inline-btn ${handsFree ? 'voice-on' : ''}`}
        aria-pressed={handsFree}
        aria-label={handsFree ? t('ui.voice.chat.handsFreeOn') : t('ui.voice.chat.handsFree')}
        title={handsFree ? t('ui.voice.chat.handsFreeOn') : t('ui.voice.chat.handsFree')}
        onClick={toggleHandsFree}
      >
        <HandsFreeIcon />
      </button>
      <button type="button" className={`btn icon-btn cy-inline-btn ${modeMain ? 'btn-dark' : ''}`} aria-label={t('ui.voice.chat.mode')} title={t('ui.voice.chat.mode')} onClick={openMode}>
        <VoiceModeIcon />
      </button>
      <span className="sr-only" aria-live="polite">
        {phase === 'idle' ? '' : stateText(t, session.label)}
      </span>
    </span>
  );
}
