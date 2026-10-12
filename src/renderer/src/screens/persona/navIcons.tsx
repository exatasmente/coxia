import type { ReactElement } from 'react';
import type { NavId } from '../../home';

// The icons of the home's navigation, the box's buttons and the sidebar's toggle: plain strokes in the current color, so they follow the theme without a color of their own.

const svg = (d: string, extra?: ReactElement, size = 18): ReactElement => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {extra}
  </svg>
);

const NAV: Record<NavId, string> = {
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  blocked: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  asking: 'M5 4h14v11h-7l-4 4v-4H5zM10.2 8.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1M12 13v.01',
  actions: 'M5 12l4 4 10-10',
  needs: 'M5 21V4h12l-2.5 4L17 12H5',
  call: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  deep: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4.5-4.5',
  qa: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 14l2 2 4-4',
  retro: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  history: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  runs: 'M7 5l12 7-12 7z',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  forum: 'M4 5h11v8H8l-4 3zM9 16v1h7l4 3V9h-2',
  procedures: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  memory: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  radar: 'M12 3a9 9 0 1 0 9 9M12 8a4 4 0 1 0 4 4M12 12l7-7',
  saude: 'M3 12h4l2-5 4 10 2-5h6',
  schedules: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M12 13v3l2 1',
  custo: 'M12 3v18M16 7h-5.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H7',
  auditoria: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14M12 17v.01',
};

export const NavIcon = ({ id }: { id: NavId }): ReactElement => svg(NAV[id]);

/** The sidebar's toggle: a panel with its side column. */
export const SidebarIcon = (): ReactElement => svg('M4 4h16v16H4zM9 4v16');

export const SendIcon = (): ReactElement => svg('M12 19V5M6 11l6-6 6 6', undefined, 18);

export const MicIcon = (): ReactElement => svg(NAV.call, undefined, 18);

/** Hands-free: a microphone in a loop, it listens again after each answer. */
export const HandsFreeIcon = (): ReactElement => svg('M12 6a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0V8a2 2 0 0 1 2-2zM8.5 11a3.5 3.5 0 0 0 7 0M3 12a9 9 0 0 1 15.4-6.4M21 12a9 9 0 0 1-15.4 6.4M18.5 2.5v3h-3M5.5 21.5v-3h3', undefined, 18);

/** Voice mode: the bars of a voice. */
export const VoiceModeIcon = (): ReactElement => svg('M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4', undefined, 18);

export const AttachIcon =(): ReactElement => svg('M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8', undefined, 18);
