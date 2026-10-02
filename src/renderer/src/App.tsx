import { useEffect, useState } from 'react';
import type { Card, ReleaseAction } from '../../shared/types';
import { api, moduleEvents } from './api';
import { usePlayer } from './audio';
import { useCeremony } from './ceremony';
import { Actions } from './screens/Actions';
import { Ata } from './screens/Ata';
import { Call } from './screens/Call';
import { Conflict } from './screens/Conflict';
import { Custo } from './screens/Custo';
import { Deep } from './screens/Deep';
import { Gate } from './screens/Gate';
import { History } from './screens/History';
import { QaHandoff } from './screens/QaHandoff';
import { QuickActions } from './screens/QuickActions';
import { RetroScreen } from './screens/RetroScreen';
import { SettingsScreen } from './screens/Settings';
import { Today } from './screens/Today';

export type Screen =
  | { name: 'today' }
  | { name: 'call' }
  | { name: 'deep'; ref: string; back: 'today' | 'call'; card?: Card }
  | { name: 'ata' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'actions' }
  | { name: 'conflict'; id: string }
  | { name: 'gate'; ref: string; card?: Card }
  | { name: 'qa'; ref: string; card?: Card }
  | { name: 'retro' }
  | { name: 'custo' }
  | { name: 'quick'; ref: string; card?: Card }
  // slot: screens of feature modules (one union member each, above this line)
  ;

export function App() {
  const ceremony = useCeremony();
  const player = usePlayer();
  const [screen, setScreen] = useState<Screen>({ name: 'today' });
  const [actions, setActions] = useState<ReleaseAction[]>([]);

  const go = (next: Screen) => {
    player.stop();
    setScreen(next);
  };

  useEffect(() => {
    void api.listActions().then(setActions);
  }, []);

  const { mergeStatus, cards } = ceremony;
  // Tray menu and notifications drive the window from the main process.
  useEffect(
    () =>
      api.onEvent((ev) => {
        if (ev.type === 'status') mergeStatus(ev.result, ev.checkedAt);
        else if (ev.type === 'actions') setActions(ev.actions);
        else if (ev.type === 'deep') go({ name: 'deep', ref: ev.card.ref, back: 'today', card: ev.card });
        else if (ev.type === 'conflict') go({ name: 'conflict', id: ev.id });
        else if (ev.type === 'open') go(ev.screen as unknown as Screen);
        else if (ev.type === 'module') moduleEvents.dispatchEvent(new CustomEvent(ev.name, { detail: ev.payload }));
        else if (ev.to === 'call') go(cards ? { name: 'call' } : { name: 'today' });
        else go({ name: ev.to });
      }),
    // go only touches the player and the screen state
    [mergeStatus, cards],
  );

  const pendingActions = actions.filter((a) => a.state === 'pending' || a.state === 'failed').length;

  switch (screen.name) {
    case 'today':
      return <Today ceremony={ceremony} go={go} pendingActions={pendingActions} />;
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
    case 'actions':
      return <Actions actions={actions} go={go} />;
    case 'gate':
      return <Gate card={ceremony.cards?.cards.find((x) => x.ref === screen.ref) ?? screen.card} ceremony={ceremony} player={player} go={go} />;
    case 'qa':
      return <QaHandoff card={ceremony.cards?.cards.find((x) => x.ref === screen.ref) ?? screen.card} ceremony={ceremony} player={player} go={go} />;
    case 'retro':
      return <RetroScreen ceremony={ceremony} player={player} go={go} />;
    case 'custo':
      return <Custo go={go} />;
    case 'quick':
      return <QuickActions card={ceremony.cards?.cards.find((x) => x.ref === screen.ref) ?? screen.card} go={go} />;
    // slot: routes of feature modules
    case 'conflict':
      return <Conflict action={actions.find((a) => a.id === screen.id)} ceremony={ceremony} player={player} go={go} />;
  }
}
