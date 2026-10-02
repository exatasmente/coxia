const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const MicIcon = () => (
  <svg {...base}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const BackIcon = () => (
  <svg {...base}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const NextIcon = () => (
  <svg {...base}>
    <path d="M5 4l10 8-10 8zM19 5v14" />
  </svg>
);

export const StopIcon = () => (
  <svg {...base}>
    <path d="M4 12h16M14 6l6 6-6 6" />
  </svg>
);

export const ClockIcon = () => (
  <svg {...base} width={16} height={16} style={{ stroke: 'var(--warn)' }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
