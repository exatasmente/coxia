import { BARGE_DEFAULTS, bargeInit, bargeStep } from './barge';
import { rmsOf } from './vad';

// Listens to the microphone only while an agent's voice plays and a screen can take a recording; the moment the person
// talks over it, the recorder of that screen starts, as if the talk key was pressed.

const SAMPLE_MS = 40;
// Detection needs about 350 ms of voice before it fires. The recorder takes the stream through a delay line, so those
// first words are in the recording instead of lost.
export const PREROLL_S = 0.5;
const HANDOFF_TTL_MS = 2000;

// What the recorder takes over when barge-in fires: it owns the microphone from there on.
export interface Handoff {
  stream: MediaStream; // the microphone, PREROLL_S behind
  live: MediaStream; // the microphone as it is, for the silence detector
  prerollMs: number;
  release: () => void;
}

interface Monitor {
  timer: number;
  ctx: AudioContext;
  mic: MediaStream;
  dest: MediaStreamAudioDestinationNode;
}

let enabled = true;
let generation = 0;
let monitor: Monitor | null = null;
let pending: { handoff: Handoff; expiry: number } | null = null;
const listeners = new Set<() => void>();

export function setBargeIn(on: boolean): void {
  enabled = on;
  if (!on) stopMonitor();
}

// Only a screen with a recorder subscribes: without one there is nothing to start, so the microphone stays closed.
export function subscribeBarge(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stopMonitor();
  };
}

function releaseMonitor(m: Monitor): void {
  window.clearInterval(m.timer);
  for (const track of m.mic.getTracks()) track.stop();
  void m.ctx.close().catch(() => undefined);
}

export function stopMonitor(): void {
  generation++;
  if (!monitor) return;
  releaseMonitor(monitor);
  monitor = null;
}

export function takeHandoff(): Handoff | null {
  if (!pending) return null;
  window.clearTimeout(pending.expiry);
  const { handoff } = pending;
  pending = null;
  return handoff;
}

function fire(m: Monitor): void {
  window.clearInterval(m.timer);
  monitor = null;
  const handoff: Handoff = {
    stream: m.dest.stream,
    live: m.mic,
    prerollMs: PREROLL_S * 1000,
    release: () => releaseMonitor(m),
  };
  pending?.handoff.release();
  // nobody took it (the screen did not start recording): do not leave the microphone open
  pending = { handoff, expiry: window.setTimeout(() => takeHandoff()?.release(), HANDOFF_TTL_MS) };
  for (const cb of [...listeners]) cb();
}

/** `playRms` is the level of what is being played right now; it is what the microphone has to clearly exceed. */
export async function startMonitor(playRms: () => number): Promise<void> {
  if (!enabled || listeners.size === 0 || monitor) return;
  const mine = ++generation;
  let mic: MediaStream;
  try {
    // Echo cancellation is the first guard against hearing the agent itself; the level check in barge.ts is the second.
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  } catch {
    return;
  }
  if (mine !== generation || monitor) {
    for (const track of mic.getTracks()) track.stop();
    return;
  }
  const ctx = new AudioContext();
  void ctx.resume();
  const source = ctx.createMediaStreamSource(mic);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = PREROLL_S;
  const dest = ctx.createMediaStreamDestination();
  source.connect(analyser);
  source.connect(delay);
  delay.connect(dest);
  const samples = new Float32Array(analyser.fftSize);
  let state = bargeInit(performance.now());
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const step = bargeStep(state, rmsOf(samples), playRms(), performance.now(), BARGE_DEFAULTS);
    state = step.state;
    if (step.fire && monitor) fire(monitor);
  }, SAMPLE_MS);
  monitor = { timer, ctx, mic, dest };
}
