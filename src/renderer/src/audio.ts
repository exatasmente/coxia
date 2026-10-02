import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Voice } from '../../shared/types';
import { api } from './api';
import { VAD_DEFAULTS, levelOf, rmsOf, vadInit, vadStep } from './vad';

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

// When speech is off nothing is synthesized: the agents' text still shows on screen and nothing goes to Edge.
let speechOn = true;
const speechEvents = new EventTarget();

export function setSpeechEnabled(on: boolean): void {
  speechOn = on;
  speechEvents.dispatchEvent(new Event('change'));
}

export function speechEnabled(): boolean {
  return speechOn;
}

export function usePlayer() {
  const current = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);

  const stop = useCallback(() => {
    current.current?.pause();
    current.current = null;
    setSpeaking(null);
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!speechOn) stop();
    };
    speechEvents.addEventListener('change', onChange);
    return () => speechEvents.removeEventListener('change', onChange);
  }, [stop]);

  const say = useCallback(
    async (text: string, voice: Voice, who: string) => {
      if (!speechOn) return;
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

const SAMPLE_MS = 50;

// onSilence fires once per recording, when the speaker stopped talking (or hit the time limit); the screen then sends as if space was pressed.
export function useRecorder(onSilence?: () => void) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const meter = useRef<{ timer: number; ctx: AudioContext } | null>(null);
  const silenceRef = useRef(onSilence);
  silenceRef.current = onSilence;
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);

  const stopMeter = useCallback(() => {
    if (!meter.current) return;
    window.clearInterval(meter.current.timer);
    void meter.current.ctx.close().catch(() => undefined);
    meter.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback(
    (stream: MediaStream, autoStop: boolean, silenceMs: number) => {
      try {
        const ctx = new AudioContext();
        void ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const cfg = { ...VAD_DEFAULTS, silenceMs };
        let vad = vadInit(performance.now());
        let fired = false;
        const timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = rmsOf(samples);
          setLevel(levelOf(rms));
          if (!autoStop || fired) return;
          const step = vadStep(vad, rms, performance.now(), cfg);
          vad = step.state;
          if (step.stop) {
            fired = true;
            silenceRef.current?.();
          }
        }, SAMPLE_MS);
        meter.current = { timer, ctx };
      } catch {
        // No meter means push-to-talk only, as before.
      }
    },
    [],
  );

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.start();
    recorder.current = rec;
    setRecording(true);
    const voice = await api.getSettings().then((s) => s.voice, () => DEFAULT_SETTINGS.voice);
    if (recorder.current === rec) startMeter(stream, voice.autoStop, voice.silenceMs);
  }, [startMeter]);

  const stop = useCallback(async (): Promise<ArrayBuffer | null> => {
    const rec = recorder.current;
    if (!rec) return null;
    stopMeter();
    const stopped = new Promise<void>((done) => (rec.onstop = () => done()));
    rec.stop();
    await stopped;
    for (const track of rec.stream.getTracks()) track.stop();
    recorder.current = null;
    setRecording(false);
    return new Blob(chunks.current, { type: 'audio/webm' }).arrayBuffer();
  }, [stopMeter]);

  useEffect(() => stopMeter, [stopMeter]);

  return { recording, level: recording ? level : undefined, start, stop };
}

// Shared by the conversation screens: space or the button starts, space again (or silence) sends.
export function useTalk(player: ReturnType<typeof usePlayer>, onText: (text: string) => Promise<void>, onError: (msg: string) => void) {
  const rec = useRecorder(() => void ref.current());
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

  return { recording: rec.recording, level: rec.level, transcribing, talk };
}
