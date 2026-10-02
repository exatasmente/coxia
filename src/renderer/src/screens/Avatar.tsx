import { useSpeechEnabled } from '../audio';
import { Wave } from './Wave';

type Mood = 'talking' | 'listening' | 'idle';

// A 2D face in the agent's color, standing in for the waveform when the voice is off.
export function Avatar({ color, mood, size = 64, label }: { color: string; mood: Mood; size?: number; label?: string }) {
  return (
    <span className={`avatar avatar-${mood}`} style={{ width: size, height: size, ['--face' as string]: color }} role="img" aria-label={label ?? (mood === 'talking' ? 'Agente falando' : mood === 'listening' ? 'Agente ouvindo' : 'Agente aguardando')}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <circle className="avatar-ring" cx="32" cy="32" r="31" />
        <circle className="avatar-head" cx="32" cy="32" r="27" />
        <g className="avatar-eyes">
          <ellipse cx="23" cy="27" rx="3.6" ry="4.4" />
          <ellipse cx="41" cy="27" rx="3.6" ry="4.4" />
        </g>
        {mood === 'talking' ? (
          <ellipse className="avatar-mouth-talk" cx="32" cy="43" rx="7" ry="4" />
        ) : (
          <path className="avatar-mouth-rest" d={mood === 'listening' ? 'M25 43 Q32 45 39 43' : 'M24 41 Q32 48 40 41'} />
        )}
      </svg>
    </span>
  );
}

// Waveform while the voice is on; the avatar while it is off.
export function Presence({
  on,
  color,
  small = false,
  level,
  face,
  recording = false,
}: { on: boolean; color: string; small?: boolean; level?: number; face?: string; recording?: boolean }) {
  const voice = useSpeechEnabled();
  if (voice) return <Wave on={on} color={color} small={small} level={level} />;
  const mood: Mood = recording ? 'listening' : on ? 'talking' : 'idle';
  return (
    <span className="presence" style={{ flex: small ? '0 1 200px' : '1 1 auto' }}>
      <Avatar color={face ?? color} mood={mood} size={small ? 36 : 56} />
      {!small && <span className="small presence-caption">{mood === 'talking' ? 'falando (voz desligada)' : mood === 'listening' ? 'ouvindo você' : 'aguardando'}</span>}
    </span>
  );
}
