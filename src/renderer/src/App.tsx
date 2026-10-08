import { type ReactElement, useEffect, useRef, useState } from 'react';
import { parseTarget, targetFromSearch, type PushTarget } from '../../shared/push';
import type { Card, ReleaseAction } from '../../shared/types';
import { api, moduleEvents } from './api';
import { startCycle } from './cycleApi';
import { setBargeIn, setSpeechEnabled, usePlayer } from './audio';
import { useCeremony } from './ceremony';
import { applyVoiceMode, useTv } from './i18n';
import { Actions } from './screens/Actions';
import { Ajuda, useHelpShortcut } from './screens/Ajuda';
import { Glossario } from './screens/Glossario';
import { NowPlaying } from './screens/NowPlaying';
import { Ata } from './screens/Ata';
import { Auditoria } from './screens/Auditoria';
import { Call } from './screens/Call';
import { Conflict } from './screens/Conflict';
import { Custo } from './screens/Custo';
import { Deep } from './screens/Deep';
import { Discussions } from './screens/Discussions';
import { Gate } from './screens/Gate';
import { History } from './screens/History';
import { BoardScreen } from './screens/cycle/BoardScreen';
import { ForumScreen } from './screens/cycle/ForumScreen';
import { RunScreen } from './screens/cycle/RunScreen';
import { RunsScreen } from './screens/cycle/RunsScreen';
import { QaHandoff } from './screens/QaHandoff';
import { QuickActions } from './screens/QuickActions';
import { Reentry } from './screens/Reentry';
import { Radar } from './screens/Radar';
import { RetroScreen } from './screens/RetroScreen';
import { Saude } from './screens/Saude';
import { SettingsScreen } from './screens/Settings';
import { BottomNav } from './screens/BottomNav';
import { Today } from './screens/Today';
import { JobsDock } from './JobsDock';
import { UpdatePrompt } from './UpdatePrompt';
import { UpdateToast } from './UpdateToast';
import { useReportUpdateBusy } from './updateApi';
import { useJobsSnapshot } from './useJobs';
import { targetToScreen } from './pushTarget';
import { useWorkspaces } from './workspaceApi';
import { SetupWizard } from './wizard/SetupWizard';
import { wizardApi } from './wizard/wizardApi';

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
  | { name: 'reentry'; ref: string; card?: Card }
  | { name: 'discussions'; ref: string; mr?: string; card?: Card }
  | { name: 'radar' }
  | { name: 'saude' }
  | { name: 'auditoria' }
  | { name: 'help' }
  | { name: 'glossario' }
  | { name: 'wizard' }
  | { name: 'run'; id: string; tab?: 'cycle' | 'forum'; from?: 'runs' }
  | { name: 'runs' }
  | { name: 'board' }
  | { name: 'forum'; thread?: string }
  // slot: screens of feature modules (one union member each, above this line)
  ;

function sameScreenKey(s: Screen): string {
  const { name, ref, id } = s as { name: string; ref?: string; id?: string };
  return `${name}|${ref ?? ''}|${id ?? ''}`;
}

export function App() {
  // Re-renders the whole tree when the language or the voice mode changes: the wording follows both.
  useTv();
  const ceremony = useCeremony();
  useWorkspaces();
  const player = usePlayer();
  const [screen, setScreen] = useState<Screen>({ name: 'today' });
  const [actions, setActions] = useState<ReleaseAction[]>([]);
  // A workspace whose setup never finished lands in the wizard; one that did (every migrated install) never sees it unless it is opened.
  const [setup, setSetup] = useState<'checking' | 'needed' | 'done'>('checking');
  useEffect(() => {
    void wizardApi.config().then((v) => setSetup(v.config.setupComplete ? 'done' : 'needed'), () => setSetup('done'));
  }, []);

  // Speech is not cut by navigation: it keeps playing and NowPlaying offers the way back to its screen.
  const go = (next: Screen) => setScreen(next);
  const [origin, setOrigin] = useState<Screen | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    setOrigin((o) => (player.speaking ? (o ?? screenRef.current) : null));
  }, [player.speaking]);
  const away = !!origin && sameScreenKey(origin) !== sameScreenKey(screen);
  useEffect(() => {
    document.documentElement.classList.toggle('has-now-playing', away);
  }, [away]);

  useHelpShortcut(screen.name, go);

  useEffect(() => {
    startCycle();
    void api.listActions().then(setActions);
    void api.getSettings().then((s) => {
      applyVoiceMode(s.voice.enabled);
      setSpeechEnabled(s.voice.speak);
      setBargeIn(s.voice.bargeIn);
    });
  }, []);

  const { mergeStatus, cards } = ceremony;
  // Tray menu and notifications drive the window from the main process.
  useEffect(
    () =>
      api.onEvent((ev) => {
        if (ev.type === 'status') mergeStatus(ev.result, ev.checkedAt);
        else if (ev.type === 'actions') {
          setActions(ev.actions);
          // The board follows what became of its proposals (approved, skipped, failed) without asking Actions itself.
          moduleEvents.dispatchEvent(new CustomEvent('actions:changed'));
        }
        else if (ev.type === 'deep') go({ name: 'deep', ref: ev.card.ref, back: 'today', card: ev.card });
        else if (ev.type === 'conflict') go({ name: 'conflict', id: ev.id });
        else if (ev.type === 'open') go(ev.screen as unknown as Screen);
        else if (ev.type === 'module') moduleEvents.dispatchEvent(new CustomEvent(ev.name, { detail: ev.payload }));
        else if (ev.type === 'settings') {
          applyVoiceMode(ev.settings.voice.enabled);
          setSpeechEnabled(ev.settings.voice.speak);
          setBargeIn(ev.settings.voice.bargeIn);
        }
        else if (ev.to === 'call') go(cards ? { name: 'call' } : { name: 'today' });
        else go({ name: ev.to });
      }),
    // go only touches the player and the screen state
    [mergeStatus, cards],
  );

  // A tapped push notification arrives as ?open=... (app was closed) or as a message from the service worker (app was open).
  const cardsLoaded = useRef(false);
  cardsLoaded.current = !!cards;
  useEffect(() => {
    const open = (t: PushTarget) => {
      const next = targetToScreen(t, cardsLoaded.current);
      if (next) go(next);
    };
    const fromUrl = targetFromSearch(location.search);
    if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
    if (fromUrl) open(fromUrl);
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; target?: unknown } | null;
      const t = data?.type === 'cerimonias:open' ? parseTarget(data.target) : null;
      if (t) open(t);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
    // go only touches the player and the screen state
  }, []);

  // Something is running that an update restart would cut: the call, the speech, an agent job.
  const callLive = !!ceremony.startedAt && !ceremony.callEnded;
  const jobsRunning = useJobsSnapshot().some((j) => j.status === 'running');
  useReportUpdateBusy(callLive || !!player.speaking || jobsRunning);

  const pendingActions = actions.filter((a) => a.state === 'pending' || a.state === 'failed').length;

  const view = ((): ReactElement => { switch (screen.name) {
    case 'today':
      return <Today ceremony={ceremony} go={go} pendingActions={pendingActions} actions={actions} />;
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
    case 'reentry':
      return <Reentry card={ceremony.cards?.cards.find((x) => x.ref === screen.ref) ?? screen.card} ceremony={ceremony} player={player} go={go} />;
    case 'discussions':
      return <Discussions card={ceremony.cards?.cards.find((x) => x.ref === screen.ref) ?? screen.card} initialMr={screen.mr} ceremony={ceremony} player={player} go={go} />;
    case 'help':
      return <Ajuda go={go} />;
    // slot: routes of feature modules
    case 'forum':
      return <ForumScreen go={go} thread={screen.thread} />;
    case 'runs':
      return <RunsScreen go={go} />;
    case 'board':
      return <BoardScreen go={go} />;
    case 'run':
      return <RunScreen id={screen.id} go={go} ceremony={ceremony} actions={actions} tab={screen.tab} back={screen.from === 'runs' ? { name: 'runs' } : undefined} />;
    case 'auditoria':
      return <Auditoria go={go} />;
    case 'radar':
      return <Radar go={go} />;
    case 'saude':
      return <Saude go={go} />;
    case 'glossario':
      return <Glossario go={go} />;
    case 'wizard':
      return <SetupWizard firstRun={false} onClose={() => go({ name: 'settings' })} />;
    case 'conflict':
      return <Conflict action={actions.find((a) => a.id === screen.id)} ceremony={ceremony} player={player} go={go} />;
  } })();

  if (setup === 'checking') return <div className="page"><div className="wrap"><span className="spinner" aria-hidden="true" /></div></div>;
  if (setup === 'needed') return <SetupWizard firstRun onClose={() => setSetup('done')} />;

  return (
    <>
      {away && origin && player.speaking && <NowPlaying who={player.speaking} origin={origin} go={go} stop={player.stop} />}
      {view}
      <BottomNav screen={screen.name} go={go} pendingActions={pendingActions} hasCards={!!cards} callLive={callLive} />
      <JobsDock screen={screen} go={go} />
      <UpdateToast />
      <UpdatePrompt hidden={screen.name === 'settings'} />
    </>
  );
}
