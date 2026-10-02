import { useEffect, useRef, useState } from 'react';

export type Mood = 'talking' | 'listening' | 'thinking' | 'idle';
type Expression = 'smile' | 'blink' | 'think' | 'attentive' | null;

interface Bar {
  h: number;
  dy: number;
  o: number;
}

const TICK_MS = 80;

// Faces drawn with the bars themselves: eyes are short bars raised above the line, the mouth is short bars on a curve.
function face(expr: Exclude<Expression, null>, n: number, H: number, t: number): Bar[] {
  const c = (n - 1) / 2;
  const half = n * 0.28;
  const look = expr === 'think' ? Math.round(Math.sin(t / 900) * 2) : 0;
  // eyes sit outside the mouth's columns, so the mouth never has a gap
  const eyes = [Math.round(c - half * 0.6) + look, Math.round(c + half * 0.6) + look];
  const blinkClosed = expr === 'blink' && t % 600 > 300;
  return Array.from({ length: n }, (_, i) => {
    if (eyes.includes(i)) return { h: blinkClosed ? H * 0.05 : H * 0.2, dy: -H * 0.2, o: 1 };
    const u = (i - c) / (half * 0.38);
    if (expr === 'attentive') {
      return Math.abs(i - c) <= 1 ? { h: H * 0.14, dy: H * 0.2, o: 1 } : { h: H * 0.03, dy: 0, o: 0.2 };
    }
    if (Math.abs(u) <= 1) {
      if (expr === 'smile') return { h: H * 0.07, dy: H * 0.1 + H * 0.12 * (1 - u * u), o: 1 };
      if (expr === 'think') {
        // "hmm": a short flat mouth pushed to one side
        return u > -0.2 ? { h: H * 0.06, dy: H * 0.2 + Math.sin(t / 300 + i) * H * 0.015, o: 1 } : { h: H * 0.03, dy: 0, o: 0.2 };
      }
      return { h: H * 0.06, dy: H * 0.2, o: 1 };
    }
    return { h: H * 0.03, dy: 0, o: 0.2 };
  });
}

function spectrum(mood: Mood, n: number, H: number, t: number, level: number | undefined): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const wobble = Math.abs(Math.sin(t / (170 + (i % 7) * 23) + i * 1.7));
    let k: number;
    if (mood === 'listening' && level !== undefined) k = 0.1 + Math.min(1, level) * (0.35 + 0.65 * wobble);
    else if (mood === 'talking') k = 0.2 + 0.8 * wobble * (0.55 + 0.45 * Math.abs(Math.sin(t / 700)));
    else if (mood === 'thinking') k = 0.1 + 0.12 * wobble;
    else k = 0.07 + 0.05 * wobble;
    return { h: H * k, dy: 0, o: 1 };
  });
}

// The spectrum is the avatar: it moves with the voice and, now and then, turns into a face — thinking, smiling, listening.
export function SpectrumAvatar({ mood, color, small = false, level }: { mood: Mood; color: string; small?: boolean; level?: number }) {
  const n = small ? 28 : 40;
  const H = small ? 36 : 56;
  const [t, setT] = useState(0);
  const [expr, setExpr] = useState<Expression>(null);
  const quietSince = useRef<number | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduced) return;
    const start = Date.now();
    const timer = setInterval(() => setT(Date.now() - start), TICK_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  // Expression schedule per mood.
  useEffect(() => {
    setExpr(mood === 'thinking' ? 'think' : null);
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const flash = (e: Expression, every: number, length: number) => {
      const loop = () => {
        timers.push(
          setTimeout(() => {
            setExpr(e);
            timers.push(setTimeout(() => setExpr(null), length));
            loop();
          }, every + Math.random() * every * 0.5),
        );
      };
      loop();
    };
    if (mood === 'talking') flash('smile', 3500, 750);
    if (mood === 'idle') flash('blink', 5000, 700);
    if (mood === 'thinking') {
      // mostly the thinking face, with short bursts of "processing" spectrum
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
    }
    return () => timers.forEach(clearTimeout);
  }, [mood, reduced]);

  // Listening: a pause in your speech shows the attentive face.
  useEffect(() => {
    if (mood !== 'listening') {
      quietSince.current = null;
      return;
    }
    if ((level ?? 0) < 0.08) {
      quietSince.current ??= Date.now();
      setExpr(Date.now() - quietSince.current > 700 ? 'attentive' : null);
    } else {
      quietSince.current = null;
      setExpr(null);
    }
  }, [mood, level]);

  const bars = expr ? face(expr, n, H, t) : reduced && mood === 'thinking' ? face('think', n, H, 0) : spectrum(mood, n, H, t, level);
  const label = mood === 'talking' ? 'Agente falando' : mood === 'listening' ? 'Ouvindo você' : mood === 'thinking' ? 'Agente pensando' : 'Aguardando';

  return (
    <span className={`spectrum ${small ? 'spectrum-small' : ''}`} style={{ height: H }} role="img" aria-label={label}>
      {bars.map((b, i) => (
        <span key={i} style={{ height: Math.max(2, b.h), transform: `translateY(${b.dy}px)`, opacity: b.o, background: color }} />
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
  const caption = mood === 'thinking' ? 'pensando…' : null;
  return (
    <span className="presence" style={{ flex: small ? '0 1 200px' : '1 1 auto' }}>
      <SpectrumAvatar mood={mood} color={color} small={small} level={level} />
      {!small && caption && <span className="small presence-caption">{caption}</span>}
    </span>
  );
}
