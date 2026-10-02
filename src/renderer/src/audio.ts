import { useCallback, useEffect, useRef, useState } from 'react';
import type { Voice } from '../../shared/types';
import { api } from './api';

const CACHE_SIZE = 40;

// Synthesized speech stays in memory only (never on disk), so a phrase heard again is not sent to Edge again.
const speechCache = new Map<string, ArrayBuffer>();

async function synthesize(text: string, voice: Voice): Promise<ArrayBuffer> {
  const key = `${voice.voice}|${voice.rate}|${voice.pitch}|${text}`;
  const hit = speechCache.get(key);
  if (hit) {
    speechCache.delete(key);
    speechCache.set(key, hit);
    return hit;
  }
  const bytes = await api.speak(text, voice);
  speechCache.set(key, bytes);
  if (speechCache.size > CACHE_SIZE) speechCache.delete(speechCache.keys().next().value as string);
  return bytes;
}

export function usePlayer() {
  const current = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);

  const stop = useCallback(() => {
    current.current?.pause();
    current.current = null;
    setSpeaking(null);
  }, []);

  const say = useCallback(
    async (text: string, voice: Voice, who: string) => {
      const bytes = await synthesize(text, voice);
      stop();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const audio = new Audio(url);
      current.current = audio;
      setSpeaking(who);
      await new Promise<void>((done) => {
        audio.onended = () => done();
        audio.onerror = () => done();
        audio.onpause = () => done();
        audio.play().catch(() => done());
      });
      URL.revokeObjectURL(url);
      if (current.current === audio) {
        current.current = null;
        setSpeaking(null);
      }
    },
    [stop],
  );

  return { speaking, say, stop };
}

export function useRecorder() {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.start();
    recorder.current = rec;
    setRecording(true);
  }, []);

  const stop = useCallback(async (): Promise<ArrayBuffer | null> => {
    const rec = recorder.current;
    if (!rec) return null;
    const stopped = new Promise<void>((done) => (rec.onstop = () => done()));
    rec.stop();
    await stopped;
    for (const track of rec.stream.getTracks()) track.stop();
    recorder.current = null;
    setRecording(false);
    return new Blob(chunks.current, { type: 'audio/webm' }).arrayBuffer();
  }, []);

  return { recording, start, stop };
}

// Push-to-talk shared by the conversation screens: space or the button starts, the same again sends.
export function useTalk(player: ReturnType<typeof usePlayer>, onText: (text: string) => Promise<void>, onError: (msg: string) => void) {
  const rec = useRecorder();
  const [transcribing, setTranscribing] = useState(false);

  const talk = useCallback(async () => {
    if (player.speaking) player.stop();
    if (!rec.recording) {
      try {
        await rec.start();
      } catch (e) {
        onError(`Microfone indisponível: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const audio = await rec.stop();
    if (!audio) return;
    setTranscribing(true);
    try {
      const text = (await api.transcribe(audio)).trim();
      setTranscribing(false);
      if (text) await onText(text);
    } catch (e) {
      setTranscribing(false);
      onError(`Falha na transcrição: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [rec, player, onText, onError]);

  const ref = useRef(talk);
  ref.current = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, button')) return;
      e.preventDefault();
      void ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { recording: rec.recording, transcribing, talk };
}
