import { useEffect, useRef, useState } from 'react';
import { speechBands, speechProgress } from '../audio';

export type Mood = 'talking' | 'listening' | 'thinking' | 'idle';

interface Bar {
  h: number;
  dy: number;
  o: number;
  eye?: boolean;
}

const FRAME_MS = 33;
const EYE_Y = -0.3;
const MOUTH_Y = 0.12;
const PAUSE_LEVEL = 0.12;
const PAUSE_MS = 350;
// where the face sits while talking: at the start of the line
const TALK_AT = 3;

/**
 * The avatar is a small face made of bars — two-column eyes on top, a three-column mouth below. While it talks it
 * stays at the start of the line making its expressions, and the spectrum leaves its mouth as waves travelling right
 * and fading with distance. The waves can only reach as far as the speech has gone: when they touch the far end, the
 * speech is over. Away from speech the face rests in the middle.
 */
function frameBars(opts: {
  n: number;
  H: number;
  t: number;
  mood: Mood;
  at: number;
  mouth: number[];
  waves: number[];
  front: number;
  smile: boolean;
  attentive: boolean;
  blink: boolean;
}): Bar[] {
  const { n, H, t, mood, at, mouth, waves, front, smile, attentive, blink } = opts;
  const look = mood === 'thinking' ? Math.round(Math.sin(t / 900)) : 0;
  const eyeCols = [at - 3 + look, at - 2 + look, at + 2 + look, at + 3 + look];
  const firstWave = at + 4;
  const span = Math.max(1, n - firstWave);
  return Array.from({ length: n }, (_, i) => {
    if (eyeCols.includes(i)) return { h: blink ? H * 0.05 : H * 0.22, dy: H * EYE_Y, o: 1, eye: true };
    const m = i - at;
    if (Math.abs(m) <= 1) {
      if (smile) return { h: H * 0.08, dy: H * MOUTH_Y + H * (m === 0 ? 0.1 : 0.03), o: 1 };
      if (attentive) return { h: H * 0.16, dy: H * (MOUTH_Y + 0.06), o: m === 0 ? 1 : 0.35 };
      if (mood === 'thinking') return m === 1 ? { h: H * 0.08, dy: H * (MOUTH_Y + 0.08), o: 1 } : { h: H * 0.06, dy: H * (MOUTH_Y + 0.08), o: m === 0 ? 1 : 0.4 };
      return { h: H * (0.06 + 0.5 * mouth[m + 1]), dy: H * MOUTH_Y, o: 1 };
    }
    if (mood === 'talking' && i >= firstWave) {
      const d = i - firstWave;
      // beyond the front: the time still to speak
      if (d > front) return { h: H * 0.04, dy: H * MOUTH_Y, o: 0.3 };
      const fade = 1 - d / span;
      return { h: H * (0.04 + 0.46 * (waves[d] ?? 0) * (0.35 + 0.65 * fade)), dy: H * MOUTH_Y, o: 0.12 + 0.88 * fade };
    }
    return { h: H * 0.04, dy: H * MOUTH_Y, o: 0.2 };
  });
}

export function SpectrumAvatar({ mood, color, small = false, level }: { mood: Mood; color: string; small?: boolean; level?: number }) {
  const n = small ? 28 : 40;
  const H = small ? 36 : 56;
  const center = Math.floor(n / 2);
  const [frame, setFrame] = useState({ t: 0, now: 0 });
  const [blink, setBlink] = useState(false);
  // energy that left the mouth, newest first: waves[0] is next to the mouth
  const waves = useRef<number[]>([]);
  const live = useRef<{ mood: Mood; mouth: number[]; energy: number; front: number }>({ mood, mouth: [0, 0, 0], energy: 0, front: 0 });
  const quietSince = useRef<number | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // One loop reads the audio (bands and progress), emits the waves and moves the front.
  useEffect(() => {
    waves.current = [];
    live.current = { mood, mouth: [0, 0, 0], energy: 1, front: 0 };
    if (reduced) {
      setFrame({ t: 0, now: performance.now() });
      return;
    }
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const span = n - (TALK_AT + 4);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      let mouth = [0, 0, 0];
      let energy = 1;
      let front = 0;
      if (mood === 'talking') {
        const bands = speechBands(3);
        mouth = bands
          ? [bands[1], bands[0], bands[2]]
          : [0, 1, 2].map((k) => 0.35 + 0.55 * Math.abs(Math.sin((now - start) / (150 + k * 40) + k)));
        const avg = (mouth[0] + mouth[1] + mouth[2]) / 3;
        energy = bands ? avg : 1;
        waves.current.unshift(avg);
        if (waves.current.length > span) waves.current.length = span;
        front = Math.round((speechProgress() ?? 0) * (span - 1));
      } else if (mood === 'listening') {
        mouth = [0, 1, 2].map((k) => Math.min(1, (level ?? 0) * (1.4 - k * 0.2)));
      }
      live.current = { mood, mouth, energy, front };
      setFrame({ t: now - start, now });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mood, n, level, reduced]);

  // Blinking only closes the eyes.
  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => {
          setBlink(false);
          loop();
        }, 160);
      }, 3500 + Math.random() * 3000);
    };
    loop();
    return () => clearTimeout(timer);
  }, [reduced]);

  // The effect runs after render: until its first frame, draw the new mood from scratch.
  const fresh = live.current.mood === mood ? live.current : { mood, mouth: [0, 0, 0], energy: 1, front: 0 };
  const { mouth, energy, front } = fresh;

  // Smile in the natural pauses of the real audio; attentive face in the pauses of your speech.
  let smile = mood === 'idle';
  let attentive = false;
  if (mood === 'talking' && energy < PAUSE_LEVEL) {
    quietSince.current ??= frame.now;
    smile = frame.now - quietSince.current > PAUSE_MS;
  } else if (mood === 'listening' && (level ?? 0) < 0.08) {
    quietSince.current ??= frame.now;
    attentive = frame.now - quietSince.current > 700;
  } else {
    quietSince.current = null;
  }

  const bars = frameBars({
    n,
    H,
    t: frame.t,
    mood,
    at: mood === 'talking' ? TALK_AT : center,
    mouth,
    waves: live.current.mood === mood ? waves.current : [],
    front,
    smile,
    attentive,
    blink,
  });
  const label = mood === 'talking' ? 'Agente falando' : mood === 'listening' ? 'Ouvindo você' : mood === 'thinking' ? 'Agente pensando' : 'Aguardando';

  return (
    <span className={`spectrum ${small ? 'spectrum-small' : ''}`} style={{ height: H }} role="img" aria-label={label}>
      {bars.map((b, i) => (
        <span
          key={i}
          className={b.eye ? 'spectrum-eye' : undefined}
          style={{ height: Math.max(2, b.h), transform: `translateY(${b.dy}px)`, opacity: b.o, background: b.eye ? `color-mix(in srgb, ${color} 35%, var(--on-night))` : color }}
        />
      ))}
    </span>
  );
}

export function Presence({
  on,
  color,
  small = false,
  level,
  recording = false,
  thinking = false,
}: { on: boolean; color: string; small?: boolean; level?: number; recording?: boolean; thinking?: boolean }) {
  const mood: Mood = recording ? 'listening' : thinking ? 'thinking' : on ? 'talking' : 'idle';
  return (
    <span className="presence" style={{ flex: small ? '0 1 200px' : '1 1 auto' }}>
      <SpectrumAvatar mood={mood} color={color} small={small} level={level} />
      {!small && mood === 'thinking' && <span className="small presence-caption">pensando…</span>}
    </span>
  );
}
