import { useEffect, useState } from 'react';
import type { Card } from '../../shared/types';
import { api } from './api';
import { usePlayer } from './audio';
import { useCeremony } from './ceremony';
import { Ata } from './screens/Ata';
import { Call } from './screens/Call';
import { Deep } from './screens/Deep';
import { History } from './screens/History';
import { SettingsScreen } from './screens/Settings';
import { Today } from './screens/Today';

export type Screen = { name: 'today' } | { name: 'call' } | { name: 'deep'; ref: string; back: 'today' | 'call'; card?: Card } | { name: 'ata' } | { name: 'history' } | { name: 'settings' };

export function App() {
  const ceremony = useCeremony();
  const player = usePlayer();
  const [screen, setScreen] = useState<Screen>({ name: 'today' });

  const go = (next: Screen) => {
    player.stop();
    setScreen(next);
  };

  const { mergeStatus, cards } = ceremony;
  // Tray menu and notifications drive the window from the main process.
  useEffect(
    () =>
      api.onEvent((ev) => {
        if (ev.type === 'status') mergeStatus(ev.result, ev.checkedAt);
        else if (ev.type === 'deep') go({ name: 'deep', ref: ev.card.ref, back: 'today', card: ev.card });
        else if (ev.to === 'call') go(cards ? { name: 'call' } : { name: 'today' });
        else go({ name: ev.to });
      }),
    // go only touches the player and the screen state
    [mergeStatus, cards],
  );

  switch (screen.name) {
    case 'today':
      return <Today ceremony={ceremony} go={go} />;
    case 'call':
      return <Call ceremony={ceremony} player={player} go={go} />;
    case 'deep':
      return <Deep ceremony={ceremony} player={player} go={go} refName={screen.ref} back={screen.back} passedCard={screen.card} />;
    case 'ata':
      return <Ata ceremony={ceremony} go={go} />;
    case 'history':
      return <History go={go} />;
    case 'settings':
      return <SettingsScreen go={go} />;
  }
}
