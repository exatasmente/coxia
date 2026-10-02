import { useEffect, useState } from 'react';
import { usePlayer } from './audio';
import { useCeremony } from './ceremony';
import { Ata } from './screens/Ata';
import { Call } from './screens/Call';
import { Deep } from './screens/Deep';
import { Today } from './screens/Today';

export type Screen = { name: 'today' } | { name: 'call' } | { name: 'deep'; ref: string; back: 'today' | 'call' } | { name: 'ata' };

export function App() {
  const ceremony = useCeremony();
  const player = usePlayer();
  const [screen, setScreen] = useState<Screen>({ name: 'today' });
  const { loadCards } = ceremony;

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const go = (next: Screen) => {
    player.stop();
    setScreen(next);
  };

  switch (screen.name) {
    case 'today':
      return <Today ceremony={ceremony} go={go} />;
    case 'call':
      return <Call ceremony={ceremony} player={player} go={go} />;
    case 'deep':
      return <Deep ceremony={ceremony} player={player} go={go} refName={screen.ref} back={screen.back} />;
    case 'ata':
      return <Ata ceremony={ceremony} go={go} />;
  }
}
