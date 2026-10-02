import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Voice } from '../../shared/types';
import { api } from './api';
import { VAD_DEFAULTS, levelOf, rmsOf, vadInit, vadStep } from './vad';

const CACHE_SIZE = 40;

// Synthesized speech stays in memory only (never on disk), so a phrase heard again is not synthesized again.
const speechCache = new Map<string, ArrayBuffer>();

async function synthesize(text: string, voice: Voice): Promise<ArrayBuffer> {
  const key = `${voice.engine ?? 'edge'}|${voice.voice}|${voice.rate}|${voice.pitch}|${voice.speed ?? 1}|${text}`;
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

export function clearSpeechCache(): void {
  speechCache.clear();
}

// Kokoro returns WAV, Edge MP3.
function mimeOf(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) === 'RIFF' ? 'audio/wav' : 'audio/mpeg';
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

// The playing speech goes through an analyser so the spectrum avatar follows the real audio.
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;

function attachAnalyser(audio: HTMLAudioElement): void {
  try {
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
    const source = audioCtx.createMediaElementSource(audio);
    const node = audioCtx.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.5;
    source.connect(node);
    node.connect(audioCtx.destination);
    analyser = node;
    bins = new Uint8Array(node.frequencyBinCount);
  } catch {
    analyser = null;
  }
}

function detachAnalyser(): void {
  analyser?.disconnect();
  analyser = null;
}

/**
 * Energy of the speech playing now in `count` bands from 90 Hz to 6 kHz on a log scale, 0..1 each,
 * or null when no audio is playing (voice off, between phrases).
 */
export function speechBands(count: number): number[] | null {
  if (!analyser || !bins || !audioCtx) return null;
  analyser.getByteFrequencyData(bins);
  const hzPerBin = audioCtx.sampleRate / 2 / bins.length;
  const lo = Math.log(90);
  const hi = Math.log(6000);
  return Array.from({ length: count }, (_, k) => {
    const from = Math.max(1, Math.floor(Math.exp(lo + ((hi - lo) * k) / count) / hzPerBin));
    const to = Math.max(from + 1, Math.floor(Math.exp(lo + ((hi - lo) * (k + 1)) / count) / hzPerBin));
    let sum = 0;
    for (let i = from; i < to && i < bins!.length; i++) sum += bins![i];
    // sqrt lifts the quieter high bands so the whole mouth moves, not only the first bars
    return Math.sqrt(sum / (to - from) / 255);
  });
}

// How far the current speech is, 0..1: the real audio position, or the reading time when the voice is off.
let playing: HTMLAudioElement | null = null;
let reading: { start: number; ms: number } | null = null;

export function speechProgress(): number | null {
  if (playing && Number.isFinite(playing.duration) && playing.duration > 0) return Math.min(1, playing.currentTime / playing.duration);
  if (reading) return Math.min(1, (performance.now() - reading.start) / reading.ms);
  return null;
}

export function useSpeechEnabled(): boolean {
  const [on, setOn] = useState(speechOn);
  useEffect(() => {
    const onChange = () => setOn(speechOn);
    speechEvents.addEventListener('change', onChange);
    return () => speechEvents.removeEventListener('change', onChange);
  }, []);
  return on;
}

// With the voice off the agent still "talks" for its reading time, so the avatar moves and the flow keeps its pace.
export function readingMs(text: string): number {
  return Math.min(9000, Math.max(1200, text.length * 45));
}

export function usePlayer() {
  const current = useRef<HTMLAudioElement | null>(null);
  const silent = useRef<{ timer: ReturnType<typeof setTimeout>; done: () => void } | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  // the chat message being played, so its replay button can turn into stop
  const [item, setItem] = useState<unknown>(null);

  const stop = useCallback(() => {
    current.current?.pause();
    current.current = null;
    if (silent.current) {
      clearTimeout(silent.current.timer);
      silent.current.done();
      silent.current = null;
    }
    setSpeaking(null);
    setItem(null);
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!speechOn) stop();
    };
    speechEvents.addEventListener('change', onChange);
    return () => speechEvents.removeEventListener('change', onChange);
  }, [stop]);

  const say = useCallback(
    async (text: string, voice: Voice, who: string, opts: { force?: boolean; item?: unknown } = {}) => {
      if (!speechOn && !opts.force) {
        stop();
        setSpeaking(who);
        const ms = readingMs(text);
        reading = { start: performance.now(), ms };
        await new Promise<void>((done) => {
          const entry = { timer: setTimeout(() => done(), ms), done };
          silent.current = entry;
        });
        reading = null;
        silent.current = null;
        setSpeaking((w) => (w === who ? null : w));
        return;
      }
      const bytes = await synthesize(text, voice);
      stop();
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(bytes) }));
      const audio = new Audio(url);
      attachAnalyser(audio);
      playing = audio;
      current.current = audio;
      setSpeaking(who);
      setItem(opts.item ?? null);
      await new Promise<void>((done) => {
        audio.onended = () => done();
        audio.onerror = () => done();
        audio.onpause = () => done();
        audio.play().catch(() => done());
      });
      URL.revokeObjectURL(url);
      detachAnalyser();
      if (playing === audio) playing = null;
      if (current.current === audio) {
        current.current = null;
        setSpeaking(null);
        setItem(null);
      }
    },
    [stop],
  );

  return { speaking, current: item, say, stop };
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
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, button, select, a')) return;
      e.preventDefault();
      void ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { recording: rec.recording, level: rec.level, transcribing, talk };
}
