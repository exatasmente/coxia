const HEIGHTS = [18, 30, 44, 26, 52, 38, 22, 48, 34, 56, 28, 42, 20, 50, 36, 24, 46, 32, 54, 26, 40, 22, 50, 30, 44, 18, 38, 52, 28, 46, 34, 24, 48, 20, 42, 30, 54, 26, 36, 22];

// With a level (0..1) the bars follow the microphone; without it they keep the CSS animation.
export function Wave({ on, color, small = false, level }: { on: boolean; color: string; small?: boolean; level?: number }) {
  const heights = small ? HEIGHTS.slice(0, 28).map((h) => Math.round(h * 0.65)) : HEIGHTS;
  return (
    <div className={`wave ${on ? 'on' : ''}`} style={small ? { height: 36, flex: '0 1 200px' } : undefined} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            height: h,
            background: color,
            ...(small ? { flexBasis: 3, width: 3 } : {}),
            ...(level === undefined
              ? { animationDuration: `${0.9 + (i % 5) * 0.12}s`, animationDelay: `${i * 0.04}s` }
              : { animation: 'none', transform: `scaleY(${Math.min(1, 0.12 + level * (h / 56) * 1.1)})`, transition: 'transform 80ms linear' }),
          }}
        />
      ))}
    </div>
  );
}
