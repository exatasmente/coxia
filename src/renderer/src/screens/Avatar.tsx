import { useEffect, useRef, useState } from 'react';
import { speechBands } from '../audio';

export type Mood = 'talking' | 'listening' | 'thinking' | 'idle';
type Expression = 'smile' | 'think' | 'attentive' | null;

interface Bar {
  h: number;
  dy: number;
  o: number;
  eye?: boolean;
}

// Two bands: the eyes on top, the mouth (spectrum) below, sized so the mouth never reaches the eyes.
const EYE_Y = -0.32;
const MOUTH_Y = 0.12;
const MOUTH_MAX = 0.55;

const FRAME_MS = 33;
const PAUSE_LEVEL = 0.12;
const PAUSE_MS = 350;

function geometry(n: number, look = 0) {
  const c = (n - 1) / 2;
  const half = n * 0.28;
  // eyes sit outside the mouth's columns, so the mouth never has a gap
  const left = Math.round(c - half * 0.6) + look;
  const right = Math.round(c + half * 0.6) + look;
  // two columns per eye, growing outwards, so the eyes read as eyes even at the small size
  return { c, half, eyes: [left - 1, left, right, right + 1] };
}

function eye(H: number, closed: boolean): Bar {
  return { h: closed ? H * 0.05 : H * 0.22, dy: H * EYE_Y, o: 1, eye: true };
}

// A full face drawn with the bars: short bars raised for the eyes, short bars on a curve for the mouth.
function face(expr: Exclude<Expression, null>, n: number, H: number, t: number, blink: boolean): Bar[] {
  const look = expr === 'think' ? Math.round(Math.sin(t / 900) * 2) : 0;
  const { c, half, eyes } = geometry(n, look);
  return Array.from({ length: n }, (_, i) => {
    if (eyes.includes(i)) return eye(H, blink);
    if (expr === 'attentive') return Math.abs(i - c) <= 1 ? { h: H * 0.14, dy: H * 0.2, o: 1 } : { h: H * 0.03, dy: H * MOUTH_Y, o: 0.2 };
    const u = (i - c) / (half * 0.38);
    if (Math.abs(u) <= 1) {
      if (expr === 'smile') return { h: H * 0.07, dy: H * 0.1 + H * 0.12 * (1 - u * u), o: 1 };
      return u > -0.2 ? { h: H * 0.06, dy: H * 0.2 + Math.sin(t / 300 + i) * H * 0.015, o: 1 } : { h: H * 0.03, dy: H * MOUTH_Y, o: 0.2 };
    }
    return { h: H * 0.03, dy: H * MOUTH_Y, o: 0.2 };
  });
}

/**
 * The spectrum as the mouth, with the eyes always above it. `bands` (low to high frequency) mirrors from the center
 * outwards, so the lows open the middle of the mouth like a voice does.
 */
function spectrum(mood: Mood, n: number, H: number, t: number, level: number | undefined, bands: number[] | null, blink: boolean): Bar[] {
  const { c, eyes } = geometry(n);
  return Array.from({ length: n }, (_, i) => {
    if (eyes.includes(i)) return eye(H, blink);
    let k: number;
    if (bands) {
      const d = Math.min(bands.length - 1, Math.floor((Math.abs(i - c) / (n / 2)) * bands.length));
      k = 0.06 + 0.94 * bands[d];
    } else {
      const wobble = Math.abs(Math.sin(t / (170 + (i % 7) * 23) + i * 1.7));
      if (mood === 'listening' && level !== undefined) k = 0.1 + Math.min(1, level) * (0.35 + 0.65 * wobble);
      else if (mood === 'talking') k = 0.2 + 0.8 * wobble * (0.55 + 0.45 * Math.abs(Math.sin(t / 700)));
      else if (mood === 'thinking') k = 0.1 + 0.12 * wobble;
      else k = 0.07 + 0.05 * wobble;
    }
    return { h: H * MOUTH_MAX * Math.min(1, k), dy: H * MOUTH_Y, o: 1 };
  });
}

// The spectrum is the avatar: the eyes stay, the bars follow the voice and, at moments, become a face.
export function SpectrumAvatar({ mood, color, small = false, level }: { mood: Mood; color: string; small?: boolean; level?: number }) {
  const n = small ? 28 : 40;
  const H = small ? 36 : 56;
  const [frame, setFrame] = useState<{ t: number; bands: number[] | null }>({ t: 0, bands: null });
  const [expr, setExpr] = useState<Expression>(null);
  const [blink, setBlink] = useState(false);
  const quietSince = useRef<number | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bandCount = Math.ceil(n / 2);

  // Every frame: time for the simulated motion and, while speech plays, the real bands.
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    let last = 0;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      setFrame({ t: now - start, bands: mood === 'talking' ? speechBands(bandCount) : null });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mood, reduced, bandCount]);

  // Blinking only closes the eyes; the spectrum keeps moving.
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

  // Thinking: the thinking face, with short bursts of "processing" spectrum.
  useEffect(() => {
    quietSince.current = null;
    setExpr(mood === 'thinking' ? 'think' : null);
    if (reduced || mood !== 'thinking') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loop = () => {
      timers.push(
        setTimeout(() => {
          setExpr(null);
          timers.push(setTimeout(() => setExpr('think'), 900));
          loop();
        }, 2600 + Math.random() * 1200),
      );
    };
    loop();
    return () => timers.forEach(clearTimeout);
  }, [mood, reduced]);

  // Talking with real audio: a smile in its natural pauses, never over the voice.
  const bands = frame.bands;
  const energy = bands ? bands.reduce((a, b) => a + b, 0) / bands.length : null;
  useEffect(() => {
    if (mood !== 'talking' || energy === null) return;
    if (energy < PAUSE_LEVEL) {
      quietSince.current ??= Date.now();
      if (Date.now() - quietSince.current > PAUSE_MS) setExpr('smile');
    } else {
      quietSince.current = null;
      setExpr(null);
    }
  }, [mood, energy]);

  // Talking without audio (voice off): a smile now and then.
  useEffect(() => {
    if (mood !== 'talking' || reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loop = () => {
      timers.push(
        setTimeout(() => {
          if (speechBands(1) === null) {
            setExpr('smile');
            timers.push(setTimeout(() => setExpr(null), 750));
          }
          loop();
        }, 3500 + Math.random() * 1700),
      );
    };
    loop();
    return () => timers.forEach(clearTimeout);
  }, [mood, reduced]);

  // Listening: a pause in your speech shows the attentive face.
  useEffect(() => {
    if (mood !== 'listening') return;
    if ((level ?? 0) < 0.08) {
      quietSince.current ??= Date.now();
      setExpr(Date.now() - quietSince.current > 700 ? 'attentive' : null);
    } else {
      quietSince.current = null;
      setExpr(null);
    }
  }, [mood, level]);

  const bars = expr
    ? face(expr, n, H, frame.t, blink)
    : reduced && mood === 'thinking'
      ? face('think', n, H, 0, false)
      : spectrum(mood, n, H, frame.t, level, bands, blink);
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
