import { useCallback, useRef, useState } from 'react';
import type { Voice } from '../../shared/types';
import { api } from './api';

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
      const bytes = await api.speak(text, voice);
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
