// Silence detection for the recorder. Pure on purpose: audio.ts feeds it RMS samples and timestamps.

export interface VadConfig {
  silenceMs: number;
  maxMs: number;
  calibrationMs: number;
  minThreshold: number;
  maxThreshold: number;
  noiseFactor: number;
  noiseMargin: number;
  speechMs: number;
}

export const VAD_DEFAULTS: VadConfig = {
  silenceMs: 1200,
  maxMs: 30_000,
  calibrationMs: 300,
  minThreshold: 0.015,
  maxThreshold: 0.08,
  noiseFactor: 2,
  noiseMargin: 0.01,
  speechMs: 100,
};

export interface VadState {
  startedAt: number;
  calibration: number[];
  threshold: number | null;
  voiceSince: number | null;
  heard: boolean;
  lastVoiceAt: number;
}

export type VadStop = 'silence' | 'limit';

export function vadInit(startedAt: number): VadState {
  return { startedAt, calibration: [], threshold: null, voiceSince: null, heard: false, lastVoiceAt: startedAt };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

// Median, not mean: if the person starts talking inside the calibration window, the few loud samples do not inflate the noise floor.
export function thresholdFor(noise: number, cfg: VadConfig): number {
  return Math.min(cfg.maxThreshold, Math.max(cfg.minThreshold, noise * cfg.noiseFactor + cfg.noiseMargin));
}

export function vadStep(state: VadState, rms: number, t: number, cfg: VadConfig): { state: VadState; stop: VadStop | null } {
  if (t - state.startedAt >= cfg.maxMs) return { state, stop: 'limit' };

  if (state.threshold === null) {
    const calibration = [...state.calibration, rms];
    if (t - state.startedAt < cfg.calibrationMs) return { state: { ...state, calibration }, stop: null };
    return { state: { ...state, calibration, threshold: thresholdFor(median(calibration), cfg) }, stop: null };
  }

  // Lower bar once speech started, so a trailing syllable or a breath does not reset the silence timer.
  const bar = state.heard ? state.threshold * 0.7 : state.threshold;
  if (rms < bar) {
    const next = state.heard ? state : { ...state, voiceSince: null };
    return { state: next, stop: state.heard && t - state.lastVoiceAt >= cfg.silenceMs ? 'silence' : null };
  }

  if (state.heard) return { state: { ...state, lastVoiceAt: t }, stop: null };
  const voiceSince = state.voiceSince ?? t;
  if (t - voiceSince >= cfg.speechMs) return { state: { ...state, voiceSince, heard: true, lastVoiceAt: t }, stop: null };
  return { state: { ...state, voiceSince }, stop: null };
}

// 0..1 for the waveform. RMS of speech sits around 0.05 to 0.2, so it is scaled up and clipped.
export function levelOf(rms: number): number {
  return Math.min(1, rms * 6);
}

export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
