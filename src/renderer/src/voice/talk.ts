import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceEnabled } from '../../../shared/i18n';
import { t } from '../i18n';
import type { Player } from './playback';
import { transcribeAudio, useRecorder } from './recorder';

// Shared by the conversation screens: space or the button starts, space again (or silence) sends.
export function useTalk(player: Player, onText: (text: string) => Promise<void>, onError: (msg: string) => void) {
  const rec = useRecorder(() => void ref.current());
  const [transcribing, setTranscribing] = useState(false);

  const talk = useCallback(async () => {
    if (player.speaking) player.stop();
    if (!rec.recording) {
      try {
        await rec.start();
      } catch (e) {
        onError(t('ui.voice.micUnavailable', { error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio) return;
    setTranscribing(true);
    try {
      const text = (await transcribeAudio(audio)).trim();
      setTranscribing(false);
      if (text) await onText(text);
    } catch (e) {
      setTranscribing(false);
      onError(t('ui.voice.transcribeFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [rec, player, onText, onError]);

  const ref = useRef(talk);
  ref.current = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !voiceEnabled() || e.repeat || (e.target as HTMLElement).closest('input, textarea, button, select, a')) return; // i18n-ignore: CSS selector
      e.preventDefault();
      void ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { recording: rec.recording, level: rec.level, transcribing, talk };
}
