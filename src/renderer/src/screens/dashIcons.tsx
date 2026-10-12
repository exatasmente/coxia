const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const BellIcon = () => (
  <svg {...base}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4" />
  </svg>
);

export const SpeakerOnIcon = () => (
  <svg {...base}>
    <path d="M4 10v4h4l5 4V6l-5 4zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />
  </svg>
);

export const SpeakerOffIcon = () => (
  <svg {...base}>
    <path d="M4 10v4h4l5 4V6l-5 4zM17 9l4 6M21 9l-4 6" />
  </svg>
);

export const ChevronIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
