import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { SpeechSegment, Voice } from '../../shared/types';
import { api } from './api';
import { type Handoff, startMonitor, stopMonitor, subscribeBarge, takeHandoff } from './bargeMonitor';
import { type Placed, placeSegment, speechProgressAt, trimRange } from './speech';
import { VAD_DEFAULTS, levelOf, rmsOf, vadInit, vadStep } from './vad';

export { setBargeIn } from './bargeMonitor';

const CACHE_SIZE = 200;
// Audio scheduled this far ahead of the clock is enough; the next sentences are requested when it runs lower.
const AHEAD_S = 8;
// Edge takes parallel requests; Kokoro runs one synthesis at a time.
const MAX_PARALLEL = { edge: 3, kokoro: 1 };

// Synthesized sentences stay in memory only (never on disk), so a phrase heard again is not synthesized again.
const speechCache = new Map<string, ArrayBuffer>();

async function synthesize(token: string, seg: SpeechSegment): Promise<ArrayBuffer> {
  const key = `${seg.engine}|${seg.voice}|${seg.rate}|${seg.pitch}|${seg.speed}|${seg.text}`;
  const hit = speechCache.get(key);
  if (hit) {
    speechCache.delete(key);
    speechCache.set(key, hit);
    return hit;
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await api.speakSegment(token, seg);
  } catch (e) {
    // one retry: the free Edge endpoint drops a request now and then
    if (/cancelled/.test(String(e))) throw e;
    bytes = await api.speakSegment(token, seg);
  }
  speechCache.set(key, bytes);
  if (speechCache.size > CACHE_SIZE) speechCache.delete(speechCache.keys().next().value as string);
  return bytes;
}

export function clearSpeechCache(): void {
  speechCache.clear();
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

// All speech goes through one analyser so the spectrum avatar follows the sentence that is playing.
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;
let wave: Float32Array<ArrayBuffer> | null = null;

function ensureAudio(): { ctx: AudioContext; node: AnalyserNode } {
  audioCtx ??= new AudioContext();
  void audioCtx.resume();
  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    analyser.connect(audioCtx.destination);
    bins = new Uint8Array(analyser.frequencyBinCount);
    wave = new Float32Array(analyser.fftSize);
  }
  return { ctx: audioCtx, node: analyser };
}

// One speech at a time: its sentences are scheduled on the audio clock, back to back, as they come out of synthesis.
interface Playback {
  token: string;
  cancelled: boolean;
  started: boolean;
  placed: Placed[];
  totalWeight: number;
  sources: AudioBufferSourceNode[];
  finish: () => void;
}

let active: Playback | null = null;
let tokens = 0;

function beginPlayback(): { pb: Playback; ended: Promise<void> } {
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => (finish = resolve));
  const pb: Playback = { token: `speech-${++tokens}-${Date.now()}`, cancelled: false, started: false, placed: [], totalWeight: 0, sources: [], finish };
  return { pb, ended };
}

// Stops what is playing, drops what is still being synthesized and releases whoever waits for the speech to end.
function endPlayback(pb: Playback): void {
  if (active === pb) active = null;
  pb.cancelled = true;
  for (const source of pb.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // never started
    }
    source.disconnect();
  }
  pb.sources = [];
  void api.cancelSpeech(pb.token).catch(() => undefined);
  stopMonitor();
  pb.finish();
}

/** Silences whatever is playing or still being synthesized. */
export function stopSpeech(): void {
  speechEvents.dispatchEvent(new Event('stop'));
}

function playbackRms(): number {
  if (!analyser || !wave || !active?.started) return 0;
  analyser.getFloatTimeDomainData(wave);
  return rmsOf(wave);
}

/**
 * Energy of the speech playing now in `count` bands from 90 Hz to 6 kHz on a log scale, 0..1 each,
 * or null when no audio is playing (voice off, still synthesizing the first sentence).
 */
export function speechBands(count: number): number[] | null {
  if (!analyser || !bins || !audioCtx || !active?.started) return null;
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

// How far the current speech is, 0..1, over the whole of it: the audio clock, or the reading time when the voice is off.
let reading: { start: number; ms: number } | null = null;

export function speechProgress(): number | null {
  if (active?.started && audioCtx) return speechProgressAt(active.placed, active.totalWeight, audioCtx.currentTime - (audioCtx.outputLatency || 0));
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

interface Sentence {
  buffer: AudioBuffer;
  offset: number;
  duration: number;
}

async function decode(pb: Playback, ctx: AudioContext, seg: SpeechSegment): Promise<Sentence | null> {
  const bytes = await synthesize(pb.token, seg);
  if (pb.cancelled) throw new Error('cancelled');
  const buffer = await ctx.decodeAudioData(bytes.slice(0));
  const range = trimRange(buffer.getChannelData(0), buffer.sampleRate);
  return range && { buffer, ...range };
}

// The first sentence starts as soon as it is ready; the next ones are requested ahead and scheduled right after it.
async function playSpeech(pb: Playback, ended: Promise<void>, text: string, voice: Voice, onStart: () => void): Promise<void> {
  const segments = await api.planSpeech(text, voice);
  if (pb.cancelled || segments.length === 0) return;
  const { ctx, node } = ensureAudio();
  pb.totalWeight = segments.reduce((sum, s) => sum + Math.max(1, s.text.length), 0);

  const slots = segments.map(() => {
    const slot = {} as { promise: Promise<Sentence | null>; resolve: (s: Sentence | null) => void; reject: (e: unknown) => void };
    slot.promise = new Promise((resolve, reject) => Object.assign(slot, { resolve, reject }));
    slot.promise.catch(() => undefined);
    return slot;
  });
  const maxParallel = MAX_PARALLEL[segments[0].engine];
  let requested = 0;
  let inflight = 0;
  let cursor = 0;
  let last: AudioBufferSourceNode | null = null;
  let failure: unknown = null;

  const pump = () => {
    while (!pb.cancelled && requested < segments.length && inflight < maxParallel && (!pb.started || cursor - ctx.currentTime < AHEAD_S)) {
      const slot = slots[requested];
      inflight++;
      decode(pb, ctx, segments[requested++])
        .then(slot.resolve, slot.reject)
        .finally(() => {
          inflight--;
          pump();
        });
    }
  };
  const timer = window.setInterval(pump, 250);
  try {
    pump();
    for (let i = 0; i < segments.length; i++) {
      let sentence: Sentence | null;
      try {
        sentence = await slots[i].promise;
      } catch (e) {
        // a sentence that failed twice is skipped; the speech only fails if nothing could be played
        if (pb.cancelled) return;
        failure = e;
        continue;
      }
      if (pb.cancelled) return;
      if (!sentence) continue;
      const placed = placeSegment(cursor, ctx.currentTime, sentence.duration, segments[i].pauseMs, Math.max(1, segments[i].text.length));
      const source = ctx.createBufferSource();
      source.buffer = sentence.buffer;
      source.connect(node);
      source.start(placed.start, sentence.offset, sentence.duration);
      pb.sources.push(source);
      pb.placed.push(placed);
      cursor = placed.end;
      last = source;
      if (!pb.started) {
        pb.started = true;
        onStart();
        void startMonitor(playbackRms);
      }
    }
    if (!last) {
      if (failure) throw failure;
      return;
    }
    last.onended = pb.finish;
    await ended;
  } finally {
    window.clearInterval(timer);
  }
}

export function usePlayer() {
  const silent = useRef<{ timer: ReturnType<typeof setTimeout>; done: () => void } | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  // the chat message being played, so its replay button can turn into stop
  const [item, setItem] = useState<unknown>(null);

  const stop = useCallback(() => {
    if (active) endPlayback(active);
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
    speechEvents.addEventListener('stop', stop);
    return () => {
      speechEvents.removeEventListener('change', onChange);
      speechEvents.removeEventListener('stop', stop);
    };
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
      stop();
      const { pb, ended } = beginPlayback();
      active = pb;
      try {
        await playSpeech(pb, ended, text, voice, () => {
          setSpeaking(who);
          setItem(opts.item ?? null);
        });
      } finally {
        // still the current speech: it ended by itself (a stop or a newer speech has already taken care of the state)
        if (active === pb) {
          endPlayback(pb);
          setSpeaking(null);
          setItem(null);
        }
      }
    },
    [stop],
  );

  return { speaking, current: item, say, stop };
}

const SAMPLE_MS = 50;

// onSilence fires once per recording, when the speaker stopped talking (or hit the time limit); the screen then sends as if space was pressed.
// It also fires when the person starts talking over the agent's voice (barge-in), when the screen then starts recording as if space was pressed.
export function useRecorder(onSilence?: () => void) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const meter = useRef<{ timer: number; ctx: AudioContext } | null>(null);
  const taken = useRef<Handoff | null>(null);
  const autoStopped = useRef(false);
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
            autoStopped.current = true;
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
    const handoff = takeHandoff();
    stopSpeech();
    autoStopped.current = false;
    let stream: MediaStream;
    try {
      stream = handoff?.stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
    } catch (e) {
      handoff?.release();
      throw e;
    }
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.start();
    recorder.current = rec;
    taken.current = handoff;
    setRecording(true);
    const voice = await api.getSettings().then((s) => s.voice, () => DEFAULT_SETTINGS.voice);
    if (recorder.current === rec) startMeter(handoff?.live ?? stream, voice.autoStop, voice.silenceMs);
  }, [startMeter]);

  const stop = useCallback(async (): Promise<ArrayBuffer | null> => {
    const rec = recorder.current;
    if (!rec) return null;
    recorder.current = null;
    stopMeter();
    const handoff = taken.current;
    taken.current = null;
    // the recording runs behind the microphone by the pre-roll: let it catch up with what was just said
    if (handoff && !autoStopped.current) await new Promise((done) => setTimeout(done, handoff.prerollMs));
    const stopped = new Promise<void>((done) => (rec.onstop = () => done()));
    rec.stop();
    await stopped;
    for (const track of rec.stream.getTracks()) track.stop();
    handoff?.release();
    setRecording(false);
    return new Blob(chunks.current, { type: 'audio/webm' }).arrayBuffer();
  }, [stopMeter]);

  useEffect(() => subscribeBarge(() => !recorder.current && silenceRef.current?.()), []);
  useEffect(
    () => () => {
      stopMeter();
      taken.current?.release();
    },
    [stopMeter],
  );

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
