import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceEnabled } from '../../../shared/i18n';
import type { SpeechSegment, Voice } from '../../../shared/types';
import { api } from '../api';
import { startMonitor, stopMonitor } from '../bargeMonitor';
import { type Placed, placeSegment, speechProgressAt, trimRange } from '../speech';
import { rmsOf } from '../vad';
import { type SpeechFeed, createSpeechFeed } from './speechFeed';
import { audioNodes, ensureAudio, keepPlaybackSession, speechEnabled, speechEvents } from './state';

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
  if (active === pb) {
    active = null;
    keepPlaybackSession(false);
  }
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

function playbackRms(): number {
  const a = audioNodes();
  if (!a || !active?.started) return 0;
  a.node.getFloatTimeDomainData(a.wave);
  return rmsOf(a.wave);
}

/**
 * Energy of the speech playing now in `count` bands from 90 Hz to 6 kHz on a log scale, 0..1 each,
 * or null when no audio is playing (voice off, still synthesizing the first sentence).
 */
export function speechBands(count: number): number[] | null {
  const a = audioNodes();
  if (!a || !active?.started) return null;
  const bins = a.bins;
  a.node.getByteFrequencyData(bins);
  const hzPerBin = a.ctx.sampleRate / 2 / bins.length;
  const lo = Math.log(90);
  const hi = Math.log(6000);
  return Array.from({ length: count }, (_, k) => {
    const from = Math.max(1, Math.floor(Math.exp(lo + ((hi - lo) * k) / count) / hzPerBin));
    const to = Math.max(from + 1, Math.floor(Math.exp(lo + ((hi - lo) * (k + 1)) / count) / hzPerBin));
    let sum = 0;
    for (let i = from; i < to && i < bins.length; i++) sum += bins[i];
    // sqrt lifts the quieter high bands so the whole mouth moves, not only the first bars
    return Math.sqrt(sum / (to - from) / 255);
  });
}

// How far the current speech is, 0..1, over the whole of it: the audio clock, or the reading time when the voice is off.
let reading: { start: number; ms: number } | null = null;

export function speechProgress(): number | null {
  const a = audioNodes();
  if (active?.started && a) return speechProgressAt(active.placed, active.totalWeight, a.ctx.currentTime - (a.ctx.outputLatency || 0));
  if (reading) return Math.min(1, (performance.now() - reading.start) / reading.ms);
  return null;
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

interface Slot {
  promise: Promise<Sentence | null>;
  resolve: (s: Sentence | null) => void;
  reject: (e: unknown) => void;
}

function newSlot(): Slot {
  const slot = {} as Slot;
  slot.promise = new Promise((resolve, reject) => Object.assign(slot, { resolve, reject }));
  slot.promise.catch(() => undefined);
  return slot;
}

// The first sentence starts as soon as it is ready; the next ones are requested ahead and scheduled right after it.
// The feed may still be growing (an answer spoken while it is written): the loop waits for the next segment until it ends.
async function playSpeech(pb: Playback, ended: Promise<void>, feed: SpeechFeed, onStart: () => void): Promise<void> {
  const stopped = ended.then(() => null);
  const first = await Promise.race([feed.at(0), stopped]);
  if (pb.cancelled || !first) return;
  const { ctx, node } = ensureAudio();
  const weigh = () => (pb.totalWeight = feed.segments.reduce((sum, s) => sum + Math.max(1, s.text.length), 0));
  weigh();

  const slots: Slot[] = [];
  const slot = (i: number) => (slots[i] ??= newSlot());
  const maxParallel = MAX_PARALLEL[first.engine];
  let requested = 0;
  let inflight = 0;
  let cursor = 0;
  let last: AudioBufferSourceNode | null = null;
  let failure: unknown = null;

  const pump = () => {
    while (!pb.cancelled && requested < feed.segments.length && inflight < maxParallel && (!pb.started || cursor - ctx.currentTime < AHEAD_S)) {
      const target = slot(requested);
      inflight++;
      decode(pb, ctx, feed.segments[requested++])
        .then(target.resolve, target.reject)
        .finally(() => {
          inflight--;
          pump();
        });
    }
  };
  const unsubscribe = feed.subscribe(() => {
    weigh();
    pump();
  });
  const timer = window.setInterval(pump, 250);
  try {
    pump();
    for (let i = 0; ; i++) {
      const seg = await Promise.race([feed.at(i), stopped]);
      if (pb.cancelled) return;
      if (!seg) break;
      let sentence: Sentence | null;
      try {
        // a stop settles `ended` while a sentence may never have been requested
        sentence = await Promise.race([slot(i).promise, stopped]);
      } catch (e) {
        // a sentence that failed twice is skipped; the speech only fails if nothing could be played
        if (pb.cancelled) return;
        failure = e;
        continue;
      }
      if (pb.cancelled) return;
      if (!sentence) continue;
      const placed = placeSegment(cursor, ctx.currentTime, sentence.duration, seg.pauseMs, Math.max(1, seg.text.length));
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
    // a growing feed can end long after its last sentence played: then there is no `ended` event left to wait for
    if (ctx.currentTime >= cursor) pb.finish();
    else last.onended = pb.finish;
    await ended;
  } finally {
    unsubscribe();
    window.clearInterval(timer);
  }
}

/** An answer spoken while it is written: sentences go in as they complete, `end` when the answer is whole. */
export interface SpeechStream {
  push(text: string): void;
  end(): void;
  cancel(): void;
  /** Settles when the speech is over: played to the end, cancelled or stopped by another speech. */
  done: Promise<void>;
}

const SILENT_STREAM: SpeechStream = { push: () => undefined, end: () => undefined, cancel: () => undefined, done: Promise.resolve() };

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
      if (!speechEnabled()) stop();
    };
    speechEvents.addEventListener('change', onChange);
    speechEvents.addEventListener('stop', stop);
    return () => {
      speechEvents.removeEventListener('change', onChange);
      speechEvents.removeEventListener('stop', stop);
    };
  }, [stop]);

  const play = useCallback(
    async (feed: SpeechFeed, who: string, item: unknown) => {
      stop();
      const { pb, ended } = beginPlayback();
      active = pb;
      keepPlaybackSession(true);
      try {
        await playSpeech(pb, ended, feed, () => {
          setSpeaking(who);
          setItem(item ?? null);
        });
      } finally {
        // still the current speech: it ended by itself (a stop or a newer speech has already taken care of the state)
        if (active === pb) {
          endPlayback(pb);
          setSpeaking(null);
          setItem(null);
        }
        feed.cancel();
      }
    },
    [stop],
  );

  const say = useCallback(
    async (text: string, voice: Voice, who: string, opts: { force?: boolean; item?: unknown } = {}) => {
      // Voice off: text everywhere. Nothing is synthesized, nothing waits for a reading time, the flow just goes on.
      if (!voiceEnabled()) return;
      if (!speechEnabled() && !opts.force) {
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
      const feed = createSpeechFeed((piece) => api.planSpeech(piece, voice));
      feed.push(text);
      feed.end();
      await play(feed, who, opts.item);
    },
    [stop, play],
  );

  // With speech off (or the voice off) nothing is synthesized: the text is already on screen.
  const sayStream = useCallback(
    (voice: Voice, who: string, opts: { item?: unknown } = {}): SpeechStream => {
      if (!voiceEnabled() || !speechEnabled()) return SILENT_STREAM;
      const feed = createSpeechFeed((piece) => api.planSpeech(piece, voice));
      const done = play(feed, who, opts.item).catch(() => undefined);
      return {
        push: (text) => feed.push(text),
        end: () => feed.end(),
        cancel: () => {
          if (feed.done) return;
          feed.cancel();
          stop();
        },
        done,
      };
    },
    [stop, play],
  );

  return { speaking, current: item, say, sayStream, stop };
}

export type Player = ReturnType<typeof usePlayer>;
