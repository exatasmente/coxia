import { useEffect, useState } from 'react';
import { voiceEnabled } from '../../../shared/i18n';
import { hasAudioSession, isIos, setAudioSession } from '../audioSession';

// When speech is off nothing is synthesized: the agents' text still shows on screen and nothing goes to Edge.
let speechOn = true;
export const speechEvents = new EventTarget();

export function setSpeechEnabled(on: boolean): void {
  speechOn = on;
  speechEvents.dispatchEvent(new Event('change'));
}

export function speechEnabled(): boolean {
  return speechOn;
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

/** Silences whatever is playing or still being synthesized. */
export function stopSpeech(): void {
  speechEvents.dispatchEvent(new Event('stop'));
}

// All speech goes through one analyser so the spectrum avatar follows the sentence that is playing.
export interface AudioNodes {
  ctx: AudioContext;
  node: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
  wave: Float32Array<ArrayBuffer>;
}

let nodes: AudioNodes | null = null;

// iOS mutes Web Audio with the ring/silent switch unless the page is in the playback audio session.
// Safari 17+ takes it directly; older ones join it while a media element plays, so a silent one runs during speech.
let sessionKeeper: HTMLAudioElement | null = null;

function silentWav(): string {
  const rate = 8000;
  const samples = rate / 2;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const text = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function preferPlaybackSession(): boolean {
  if (!hasAudioSession()) return false;
  setAudioSession('playback');
  return true;
}

export function keepPlaybackSession(on: boolean): void {
  if (!sessionKeeper) return;
  if (on) void sessionKeeper.play().catch(() => undefined);
  else sessionKeeper.pause();
}

// Mobile browsers start the AudioContext suspended until a user gesture.
export function unlockAudio(): void {
  if (!voiceEnabled()) return;
  try {
    if (!preferPlaybackSession() && !sessionKeeper && isIos()) {
      sessionKeeper = new Audio(silentWav());
      sessionKeeper.loop = true;
      // played once inside the gesture, so later speech can start it without one
      void sessionKeeper.play().then(() => sessionKeeper?.pause(), () => undefined);
    }
    ensureAudio();
  } catch {
    // no Web Audio: the avatar just loses its spectrum
  }
}

export function ensureAudio(): AudioNodes {
  if (nodes) {
    void nodes.ctx.resume();
    return nodes;
  }
  const ctx = new AudioContext();
  void ctx.resume();
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  node.smoothingTimeConstant = 0.5;
  node.connect(ctx.destination);
  nodes = { ctx, node, bins: new Uint8Array(node.frequencyBinCount), wave: new Float32Array(node.fftSize) };
  return nodes;
}

/** The shared output nodes, or null before any speech created them. */
export function audioNodes(): AudioNodes | null {
  return nodes;
}
