// Barge-in detection: is the person talking over the agent's voice? Pure on purpose, like vad.ts: the monitor feeds it
// the microphone RMS and the RMS of what is being played, with timestamps.

export interface BargeConfig {
  // no trigger right after playback starts: the echo canceller needs a moment to converge
  warmupMs: number;
  // time above the bar, in total, before it fires
  sustainMs: number;
  // a dip shorter than this (a syllable gap, a breath) does not reset the count
  graceMs: number;
  // absolute floor: room noise and keyboard clacks stay below it
  minRms: number;
  // the mic must reach this share of the playback level; speaker echo that survives the canceller is a fraction of it
  echoRatio: number;
  // the echo reaches the mic late (output latency, room), so the bar follows the loudest playback of this window
  historyMs: number;
}

export const BARGE_DEFAULTS: BargeConfig = {
  warmupMs: 400,
  sustainMs: 300,
  graceMs: 120,
  minRms: 0.03,
  echoRatio: 0.5,
  historyMs: 300,
};

export interface BargeState {
  startedAt: number;
  lastT: number;
  voicedMs: number;
  lastVoiceAt: number;
  history: { t: number; play: number }[];
}

export function bargeInit(startedAt: number): BargeState {
  return { startedAt, lastT: startedAt, voicedMs: 0, lastVoiceAt: startedAt, history: [] };
}

export function bargeBar(playPeak: number, cfg: BargeConfig): number {
  return Math.max(cfg.minRms, playPeak * cfg.echoRatio);
}

export function bargeStep(state: BargeState, mic: number, play: number, t: number, cfg: BargeConfig): { state: BargeState; fire: boolean } {
  const history = [...state.history.filter((h) => t - h.t <= cfg.historyMs), { t, play }];
  const peak = history.reduce((m, h) => Math.max(m, h.play), 0);
  const dt = Math.max(0, t - state.lastT);
  let { voicedMs, lastVoiceAt } = state;
  if (t - state.startedAt < cfg.warmupMs) return { state: { ...state, lastT: t, voicedMs: 0, history }, fire: false };
  if (mic >= bargeBar(peak, cfg)) {
    voicedMs += dt;
    lastVoiceAt = t;
  } else if (t - lastVoiceAt > cfg.graceMs) {
    voicedMs = 0;
  }
  return { state: { ...state, lastT: t, voicedMs, lastVoiceAt, history }, fire: voicedMs >= cfg.sustainMs };
}
