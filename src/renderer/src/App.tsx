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
import { MemoryScreen } from './screens/memory/MemoryScreen';
import { ProceduresScreen } from './screens/procedures/ProceduresScreen';
import { PromptsScreen, usePromptsShortcut } from './screens/prompts/PromptsScreen';
import { QaHandoff } from './screens/QaHandoff';
import { QuickActions } from './screens/QuickActions';
import { Reentry } from './screens/Reentry';
import { Radar } from './screens/Radar';
import { RetroScreen } from './screens/RetroScreen';
import { Saude } from './screens/Saude';
import { SchedulesScreen } from './screens/Schedules';
import { SchedulerAsk } from './SchedulerAsk';
import { SettingsScreen } from './screens/Settings';
import { Overview } from './screens/Overview';
import { ChatScreen } from './screens/persona/ChatScreen';
import { HomeShell } from './screens/persona/HomeShell';
import { PersonaWizard } from './screens/persona/PersonaWizard';
import { VoiceModeScreen, useVoiceShortcut } from './screens/persona/VoiceModeScreen';
import { useConfigView } from './screens/team/teamApi';
import { ClaudeSessionsScreen } from './screens/ClaudeSessions';
import { useClaudeSessionsOn } from './claudeSessionsApi';
import { JobsDock } from './JobsDock';
import { PersonaIndicator } from './screens/persona/PersonaIndicator';
import { UpdatePrompt } from './UpdatePrompt';
import { UpdateToast } from './UpdateToast';
import { useReportUpdateBusy } from './updateApi';
import { useJobsSnapshot } from './useJobs';
import { type DeepBack, HOME, OVERVIEW, type OverviewSection, framedScreen, homeView, personaIn, snoozeWizard, wizardSnoozed } from './home';
import { useAnyLive } from './liveApi';
import { targetToScreen } from './pushTarget';
import { useWorkspaces } from './workspaceApi';
import { SetupWizard } from './wizard/SetupWizard';
import { wizardApi } from './wizard/wizardApi';

export type Screen =
  | { name: 'chat' }
  | { name: 'overview'; section?: OverviewSection }
  | { name: 'call' }
  | { name: 'deep'; ref: string; back: DeepBack; card?: Card }
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
  // A merge request that is not a card of the day, named by its project and number; `back` is the conversation whose button opened it.
  | { name: 'discussions'; project: string; number: number; back?: Screen }
  | { name: 'radar' }
  | { name: 'saude' }
  | { name: 'auditoria'; id?: string }
  | { name: 'help' }
  | { name: 'glossario' }
  | { name: 'wizard' }
  | { name: 'run'; id: string; tab?: 'cycle' | 'forum'; from?: 'runs' }
  | { name: 'runs' }
  | { name: 'board' }
  | { name: 'forum'; thread?: string }
  | { name: 'procedures' }
  | { name: 'memory' }
  | { name: 'prompts' }
  | { name: 'schedules' }
  | { name: 'voice' }
  | { name: 'claudeSessions' }
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
  const [screen, setScreen] = useState<Screen>(HOME);
  const [actions, setActions] = useState<ReleaseAction[]>([]);
  // The persona of the workspace: whose conversation the chat is. Kept current by the configuration event.
  const { view: configView, error: configError, reload: reloadConfig } = useConfigView();
  const persona = personaIn(configView?.config);
  const claudeOn = useClaudeSessionsOn();
  // A workspace known to have none: a notice about a ceremony opens the Overview and not the wizard (until the configuration is read the answer is "unknown", not "none").
  const noPersona = !!configView && !persona;
  // The persona was just saved: the wizard waits for the configuration that holds it, so it is not drawn again for the instant in between.
  const [made, setMade] = useState(false);
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
  usePromptsShortcut(screen.name, go);
  useVoiceShortcut(screen.name, go, !!persona);

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
        else if (ev.type === 'deep') go({ name: 'deep', ref: ev.card.ref, back: 'chat', card: ev.card });
        else if (ev.type === 'conflict') go({ name: 'conflict', id: ev.id });
        else if (ev.type === 'open') go(ev.screen as unknown as Screen);
        else if (ev.type === 'module') moduleEvents.dispatchEvent(new CustomEvent(ev.name, { detail: ev.payload }));
        else if (ev.type === 'settings') {
          applyVoiceMode(ev.settings.voice.enabled);
          setSpeechEnabled(ev.settings.voice.speak);
          setBargeIn(ev.settings.voice.bargeIn);
        }
        else {
          // The old names stay: a tray entry or a notice that says `today` opens the Overview, and the pre-daily without cards opens the home.
          const next = targetToScreen({ to: ev.to }, !!cards, noPersona);
          if (next) go(next);
        }
      }),
    // go only touches the player and the screen state
    [mergeStatus, cards, noPersona],
  );

  // A tapped push notification arrives as ?open=... (app was closed) or as a message from the service worker (app was open).
  const cardsLoaded = useRef(false);
  cardsLoaded.current = !!cards;
  const noPersonaRef = useRef(noPersona);
  noPersonaRef.current = noPersona;
  useEffect(() => {
    const open = (t: PushTarget) => {
      const next = targetToScreen(t, cardsLoaded.current, noPersonaRef.current);
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

  // Every card's turn is prepared as soon as the cards are there, whichever screen is open (the Overview did it when it was Today). Turns already prepared, or restored from
  // disk, come from the cache; only the missing ones call an agent.
  const { cards: loadedCards, prepareAll } = ceremony;
  useEffect(() => {
    if (loadedCards) void prepareAll();
  }, [loadedCards, prepareAll]);

  // Something is running that an update restart would cut: the call, the speech, an agent job, an answer of the persona being written (anywhere, a paired phone included).
  const callLive = !!ceremony.startedAt && !ceremony.callEnded;
  const jobsRunning = useJobsSnapshot().some((j) => j.status === 'running');
  const writing = useAnyLive();
  useReportUpdateBusy(callLive || !!player.speaking || jobsRunning || writing);

  const pendingActions = actions.filter((a) => a.state === 'pending' || a.state === 'failed').length;

  const view = ((): ReactElement => { switch (screen.name) {
    case 'chat':
    case 'overview': {
      // The home: the chat with the persona; with none, the wizard that makes it (the Overview if the person said "Not now"). The Overview is also a screen of its own.
      // A configuration that cannot be read leaves the Overview, which does not need it, rather than a spinner with no end.
      const home = screen.name !== 'chat' || (!configView && configError) ? 'overview' : homeView({ config: configView?.config ?? null, snoozed: wizardSnoozed() });
      if (home === 'loading' || (home === 'wizard' && made)) return <div className="page"><div className="wrap"><span className="spinner" aria-hidden="true" /></div></div>;
      if (home === 'wizard') {
        return (
          <PersonaWizard
            presentation="screen"
            persona={null}
            onDone={() => {
              setMade(true);
              void reloadConfig().then(() => {
                setMade(false);
                go(HOME);
              });
            }}
            onClose={() => {
              snoozeWizard();
              go(OVERVIEW);
            }}
          />
        );
      }
      if (home === 'chat') return <ChatScreen ceremony={ceremony} go={go} persona={persona} team={configView?.config.agents.team} actions={actions} player={player} />;
      return <Overview ceremony={ceremony} go={go} pendingActions={pendingActions} actions={actions} section={screen.name === 'overview' ? screen.section : undefined} persona={persona} />;
    }
    case 'voice':
      // A spoken conversation with the persona, in the same conversation as the chat; with no persona there is nobody to talk to.
      if (!persona) return <Overview ceremony={ceremony} go={go} pendingActions={pendingActions} actions={actions} persona={persona} />;
      return <VoiceModeScreen persona={persona} player={player} voice={ceremony.voiceOfAgent(persona.id)} go={go} />;
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
      if ('project' in screen) return <Discussions key={`${screen.project}!${screen.number}`} card={undefined} initialMr={undefined} target={{ project: screen.project, number: screen.number }} back={screen.back} ceremony={ceremony} player={player} go={go} />;
      return <Discussions card={ceremony.cards?.cards.find((x) => x.ref === screen.ref) ?? screen.card} initialMr={screen.mr} ceremony={ceremony} player={player} go={go} />;
    case 'help':
      return <Ajuda go={go} />;
    // slot: routes of feature modules
    case 'claudeSessions':
      // Off, or in a paired browser, the screen does not exist.
      if (!claudeOn) return <Overview ceremony={ceremony} go={go} pendingActions={pendingActions} actions={actions} persona={persona} />;
      return <ClaudeSessionsScreen />;
    case 'forum':
      return <ForumScreen go={go} thread={screen.thread} />;
    case 'runs':
      return <RunsScreen go={go} />;
    case 'board':
      return <BoardScreen go={go} />;
    case 'procedures':
      return <ProceduresScreen go={go} />;
    case 'memory':
      return <MemoryScreen go={go} />;
    case 'prompts':
      return <PromptsScreen go={go} />;
    case 'schedules':
      return <SchedulesScreen go={go} />;
    case 'run':
      return <RunScreen id={screen.id} go={go} ceremony={ceremony} actions={actions} tab={screen.tab} back={screen.from === 'runs' ? { name: 'runs' } : undefined} />;
    case 'auditoria':
      return <Auditoria go={go} act={screen.id} />;
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
      {framedScreen(screen.name) ? (
        <HomeShell go={go} ceremony={ceremony} actions={actions} current={screen.name} persona={!!persona} bar>
          <PersonaIndicator screen={screen.name} />
          {view}
        </HomeShell>
      ) : (
        <>
          <PersonaIndicator screen={screen.name} />
          {view}
        </>
      )}
      <JobsDock screen={screen} go={go} />
      <UpdateToast />
      <UpdatePrompt hidden={screen.name === 'settings'} />
      <SchedulerAsk />
    </>
  );
}
