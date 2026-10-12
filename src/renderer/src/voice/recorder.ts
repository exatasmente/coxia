import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceEnabled } from '../../../shared/i18n';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { api } from '../api';
import { setAudioSession } from '../audioSession';
import { type Handoff, subscribeBarge, takeHandoff } from '../bargeMonitor';
import { VAD_DEFAULTS, type VadStop, levelOf, rmsOf, vadInit, vadStep } from '../vad';
import { stopSpeech } from './state';

// Safari (iOS) records only MP4/AAC; the recognizer reads any of these.
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function recordingType(): string | undefined {
  return RECORDING_TYPES.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
}

// What the recognizer returned in this session, so a chat message that came from the voice can offer to teach the glossary.
const transcripts = new Set<string>();

export async function transcribeAudio(audio: ArrayBuffer): Promise<string> {
  if (!voiceEnabled()) throw new Error('voice is off'); // i18n-ignore: assertion, the screens never record while voice is off
  const text = await api.transcribe(audio);
  if (text) {
    transcripts.delete(text);
    transcripts.add(text);
    if (transcripts.size > 100) transcripts.delete(transcripts.values().next().value as string);
  }
  return text;
}

export function wasTranscribed(text: string): boolean {
  return transcripts.has(text.trim());
}

const SAMPLE_MS = 50;

/**
 * Why the recorder called back: the speaker went quiet after talking, the recording hit its time limit, or the person
 * talked over an agent's voice. `heard` says whether any speech was detected, so a hands-free loop can drop a
 * recording that is only silence instead of transcribing it.
 */
export interface SilenceInfo {
  reason: VadStop | 'barge';
  heard: boolean;
}

// onSilence fires once per recording, when the speaker stopped talking (or hit the time limit); the screen then sends as if space was pressed.
// It also fires when the person starts talking over the agent's voice (barge-in), when the screen then starts recording as if space was pressed.
// `barge`: whether talking over an agent's voice starts this recorder; off, this screen keeps the microphone closed while the agent speaks (a muted voice mode).
export function useRecorder(onSilence?: (info: SilenceInfo) => void, opts: { barge?: boolean } = {}) {
  const barge = opts.barge ?? true;
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
            silenceRef.current?.({ reason: step.stop, heard: vad.heard });
          }
        }, SAMPLE_MS);
        meter.current = { timer, ctx };
      } catch {
        // No meter means push-to-talk only, as before.
      }
    },
    [],
  );

  // `autoStop` overrides the setting: a hands-free loop always needs the silence detector.
  const start = useCallback(
    async (opts: { autoStop?: boolean } = {}) => {
      if (!voiceEnabled()) throw new Error('voice is off'); // i18n-ignore: assertion, the screens never record while voice is off
      const handoff = takeHandoff();
      stopSpeech();
      autoStopped.current = false;
      let stream: MediaStream;
      try {
        if (!handoff) setAudioSession('play-and-record');
        stream = handoff?.stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      } catch (e) {
        handoff?.release();
        setAudioSession('playback');
        throw e;
      }
      const mimeType = recordingType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.start();
      recorder.current = rec;
      taken.current = handoff;
      setRecording(true);
      const voice = await api.getSettings().then((s) => s.voice, () => DEFAULT_SETTINGS.voice);
      if (recorder.current === rec) startMeter(handoff?.live ?? stream, opts.autoStop ?? voice.autoStop, voice.silenceMs);
    },
    [startMeter],
  );

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
    setAudioSession('playback');
    handoff?.release();
    setRecording(false);
    return new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }).arrayBuffer();
  }, [stopMeter]);

  useEffect(() => (barge ? subscribeBarge(() => !recorder.current && silenceRef.current?.({ reason: 'barge', heard: true })) : undefined), [barge]);
  useEffect(
    () => () => {
      stopMeter();
      taken.current?.release();
    },
    [stopMeter],
  );

  return { recording, level: recording ? level : undefined, start, stop };
}
