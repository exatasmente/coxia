import { useCallback, useEffect, useRef, useState } from 'react';
import type { Voice } from '../../../shared/types';
import { t } from '../i18n';
import { forumApi } from '../screens/cycle/forumApi';
import { latencyLine, turnLatency, type TurnMarks } from './latency';
import { explainMicError } from './micSupport';
import { pausePolicy } from './pausePolicy';
import type { Player } from './playback';
import { transcribeAudio, useRecorder } from './recorder';
import { useVoiceTurns } from './useVoiceTurns';
import { type Effect, type LoopEvent, type LoopState, initialLoop, labelOf, loopStep } from './voiceLoop';

// A spoken conversation with the persona, for the chat's microphone and for voice mode: the state machine (voiceLoop.ts) driven by the real recorder, the
// transcription, the post (marked as spoken, so the persona answers for listening) and the player speaking the answer while it is written.

export interface VoiceSessionOptions {
  thread: string;
  player: Player;
  voice: Voice | null;
  /** Who speaks, for the player (the persona's id). */
  who: string;
  /** Pause when the page is hidden (a paired phone: a locked screen or another tab). */
  pauseWhenHidden?: boolean;
}

/** The message for a microphone that did not open: a refused permission and a missing microphone are said as such. */
export function micMessage(error: unknown): string {
  const kind = explainMicError(error);
  if (kind === 'denied') return t('ui.voice.mic.denied');
  if (kind === 'missing') return t('ui.voice.mic.missing');
  return t('ui.voice.micUnavailable', { error: error instanceof Error ? error.message : String(error) });
}

export function useVoiceSession({ thread, player, voice, who, pauseWhenHidden = false }: VoiceSessionOptions) {
  const [loop, setLoop] = useState<LoopState>(initialLoop);
  const state = useRef(loop);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState('');
  const said = useRef('');
  const turn = useRef<number | null>(null);
  const marks = useRef<TurnMarks>({});

  const dispatch = useRef<(e: LoopEvent) => void>(() => undefined);

  const turns = useVoiceTurns(thread, player, voice, who, {
    started: (to) => {
      if (to === turn.current) marks.current.firstText ??= performance.now();
    },
    done: (to) => {
      if (to === turn.current) dispatch.current({ type: 'answered' });
    },
  });

  const bargeOn = !loop.muted && (loop.phase === 'speaking' || loop.phase === 'thinking');
  const rec = useRecorder((info) => dispatch.current(info.reason === 'barge' ? { type: 'bargeIn' } : { type: 'silence', heard: info.heard }), { barge: bargeOn });

  const run = (effect: Effect): void => {
    switch (effect) {
      case 'listen':
        setError(null);
        rec.start({ autoStop: true }).catch((e: unknown) => {
          setError(micMessage(e));
          dispatch.current({ type: 'failed' });
        });
        return;
      case 'discard':
        void rec.stop();
        return;
      case 'transcribe':
        marks.current = { speechEnd: performance.now() };
        void (async () => {
          try {
            const audio = await rec.stop();
            const text = audio ? (await transcribeAudio(audio)).trim() : '';
            marks.current.transcribed = performance.now();
            said.current = text;
            if (text) setHeard(text);
            dispatch.current({ type: 'transcribed', text });
          } catch (e) {
            setError(t('ui.voice.transcribeFailed', { error: e instanceof Error ? e.message : String(e) }));
            dispatch.current({ type: 'failed' });
          }
        })();
        return;
      case 'post':
        void forumApi.post(thread, said.current, 'voice').then(
          (m) => {
            marks.current.posted = performance.now();
            turn.current = m.seq;
            turns.mark(m.seq);
          },
          (e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
            dispatch.current({ type: 'failed' });
          },
        );
        return;
      case 'silence':
        turns.silence();
        player.stop();
        return;
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  dispatch.current = (event: LoopEvent) => {
    const step = loopStep(state.current, event);
    state.current = step.state;
    setLoop(step.state);
    for (const effect of step.effects) runRef.current(effect);
  };

  // The first word played: the end of the delay the 3 s target is about, logged once per turn (the developer tools' console; no renderer log channel exists for it).
  useEffect(() => {
    if (loop.phase !== 'thinking' || player.speaking !== who) return;
    marks.current.firstAudio = performance.now();
    console.info(latencyLine(turnLatency(marks.current))); // i18n-ignore: developer log line
    dispatch.current({ type: 'speechStarted' });
  }, [loop.phase, player.speaking, who]);

  useEffect(() => {
    if (!pauseWhenHidden) return;
    const onVisibility = () => {
      if (pausePolicy({ phone: true, hidden: document.hidden }) === 'pause') dispatch.current({ type: 'pause' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pauseWhenHidden]);

  // Leaving the screen closes the microphone and stops this session's speech, and only that: a ceremony opened next may already be speaking. Effects only, no
  // state: a remount in development must find the session usable.
  const silenceTurns = useRef(turns.silence);
  silenceTurns.current = turns.silence;
  useEffect(
    () => () => {
      runRef.current('discard');
      silenceTurns.current();
    },
    [],
  );

  const send = useCallback((e: LoopEvent) => dispatch.current(e), []);

  return {
    loop,
    label: labelOf(loop),
    level: rec.level,
    error,
    /** The last thing the person said, as transcribed. */
    heard,
    /** The text of the persona's current answer, for the captions. */
    caption: turns.caption,
    send,
  };
}

export type VoiceSession = ReturnType<typeof useVoiceSession>;
