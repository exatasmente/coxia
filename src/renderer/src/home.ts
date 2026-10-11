import type { Run } from '../../shared/runs';
import { isRunBlocker, runOfCard, waitingRuns } from '../../shared/runs/view';
import { isReadyForQa } from '../../shared/cycles/stages';
import type { CycleView } from '../../shared/cycles/view';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { personaOf } from '../../shared/config/team';
import type { AgentTurn, Card, ReleaseAction } from '../../shared/types';
import type { WatcherAlert } from '../../shared/watchers';
import type { Screen } from './App';
import { type AgoraPlan, isPendingAction, needsYou, pendingQuestions } from './dashboard';

// Where the app opens, where every "back" returns, and what the chat that is the home decides above its markup. A screen asks for the home here and never names it, so which
// screen is the home is decided in one place. It is the chat with the persona, or the invitation to make one (`homeView`); the Overview holds what Today held. Plain functions,
// because nothing renders a component in the tests: the counts of the strip, the card of the ceremony, the rows of the menu.

/** The Overview: what Today held, a screen of its own. */
export const OVERVIEW: Screen = { name: 'overview' };

/** The screen the app opens on and every "back to the start" goes to. `homeView` says what it draws: the chat, or the wizard that makes the persona, or the Overview. */
export const HOME: Screen = { name: 'chat' };

/** Where a deep dive goes back to: the pre-daily it came from, or the home. */
export type DeepBack = 'chat' | 'call';

export const deepBack = (back: DeepBack): Screen => (back === 'call' ? { name: 'call' } : HOME);

// ---- the strip ----------------------------------------------------------------------------------------------------------------------------------

/** The part of the Overview a count opens at. */
export type OverviewSection = 'blocked' | 'asking' | 'needs';

/** The cards that cannot go on: a blocker the tracker shows, or a run stopped on a question or a failure. In the agenda's order. */
export function blockedCards(cards: readonly Card[], runs: readonly Run[] | null | undefined): Card[] {
  return cards.filter((card) => card.blockers.length > 0 || (!!runs && isRunBlocker(runOfCard(runs, card.ref))));
}

export interface HomeCountsInput {
  cards: Card[];
  turns: Record<string, AgentTurn>;
  answered: Record<string, boolean>;
  runs: readonly Run[] | null | undefined;
  actions: ReleaseAction[];
  alerts: WatcherAlert[];
}

export interface HomeCounts {
  blocked: number;
  asking: number;
  /** What waits in Actions: proposals to decide and the ones that failed. */
  actions: number;
  /** What needs the person: the list of "needs you" with the runs that wait and the watcher alerts. */
  needs: number;
}

/** The four counts of the strip. The Overview lists what these count (`blockedCards`, `pendingQuestions`, `needsYou`), so the strip and the Overview cannot disagree. */
export function homeCounts(i: HomeCountsInput): HomeCounts {
  return {
    blocked: blockedCards(i.cards, i.runs).length,
    asking: pendingQuestions(i.cards, i.turns, i.answered).length,
    actions: i.actions.filter(isPendingAction).length,
    needs: needsYou({ cards: i.cards, turns: i.turns, answered: i.answered, actions: i.actions, alerts: i.alerts }).length + waitingRuns(i.runs ?? []).length,
  };
}

/** Where each count of the strip leads: the Overview at its section, or Actions. */
export function stripTarget(count: keyof HomeCounts): Screen {
  return count === 'actions' ? { name: 'actions' } : { name: 'overview', section: count };
}

/**
 * The catalog key of a count's label. A phone has a quarter of the width for each, and "Precisa de você" does not fit it at a size that reads, so that one has a shorter
 * wording there; the others are short enough as they are.
 */
export function stripLabelKey(count: keyof HomeCounts, phone: boolean): string {
  if (count === 'needs') return phone ? 'ui.chat.strip.needsShort' : 'ui.chat.strip.needs';
  return { blocked: 'ui.today.tiles.blockers', asking: 'ui.today.tiles.questions', actions: 'ui.today.tiles.actions' }[count];
}

// ---- the ceremony card --------------------------------------------------------------------------------------------------------------------------

/** The card pinned above the box: the plan of the Agora card of the Overview when it has something to say, and nothing for a cycle with no pre-daily or while the cards load. */
export function ceremonyCard(plan: AgoraPlan, ceremonies: Pick<CycleView['ceremonies'], 'preDaily'> | undefined): AgoraPlan | null {
  if (ceremonies?.preDaily === false) return null;
  return plan.phase === 'loading' ? null : plan;
}

// ---- the menu -----------------------------------------------------------------------------------------------------------------------------------

export type MenuId =
  | 'overview'
  | 'call'
  | 'deep'
  | 'qa'
  | 'retro'
  | 'actions'
  | 'history'
  | 'runs'
  | 'board'
  | 'forum'
  | 'procedures'
  | 'memory'
  | 'settings'
  | 'custo'
  | 'radar'
  | 'saude'
  | 'auditoria'
  | 'help';

export interface MenuRow {
  id: MenuId;
  /** The catalog key of the words of the row. */
  label: string;
  /** The screen it opens; the two ceremonies that work on a card (`deep`, `qa`) take it from the cards, so they have none here. */
  screen: Screen | null;
  group: 'screens' | 'ceremonies';
}

const screenRow = (id: MenuId, label: string, group: MenuRow['group'] = 'screens'): MenuRow => ({ id, label, screen: { name: id } as Screen, group });

/** The ceremonies the menu offers, the way the Overview offers them: a ceremony the cycle turned off is not listed. */
function ceremonyRows(on: Partial<CycleView['ceremonies']> | undefined): MenuRow[] {
  return [
    ...(on?.preDaily !== false ? [screenRow('call', 'ui.today.preDaily', 'ceremonies')] : []),
    ...(on?.unblock !== false ? [{ id: 'deep' as const, label: 'ui.today.deepen', screen: null, group: 'ceremonies' as const }] : []),
    ...(on?.qaHandoff !== false ? [{ id: 'qa' as const, label: 'ui.today.qaHandoff', screen: null, group: 'ceremonies' as const }] : []),
    ...(on?.retro !== false ? [screenRow('retro', 'ui.today.retro', 'ceremonies')] : []),
  ];
}

/**
 * What the menu of the chat lists. On the computer, the buttons of the header Today had; on the phone, the rows of the More sheet and Actions and History besides, because the chat
 * has no bottom bar to carry them. Both start with the Overview and carry the ceremonies, so none depends on the model understanding a request.
 */
export function menuRows(phone: boolean, on?: Partial<CycleView['ceremonies']>): MenuRow[] {
  const overview = screenRow('overview', 'ui.chat.menu.overview');
  const common = [
    screenRow('runs', 'ui.runs.nav'),
    screenRow('board', 'ui.board.nav'),
    screenRow('forum', 'ui.forum.nav'),
    screenRow('procedures', 'ui.procedures.nav'),
    screenRow('memory', 'ui.memory.nav'),
  ];
  const rest = [screenRow('custo', 'ui.nav.cost'), screenRow('radar', 'ui.nav.radar'), screenRow('saude', 'ui.nav.health'), screenRow('auditoria', 'ui.nav.audit'), screenRow('help', 'ui.nav.help')];
  if (phone) return [overview, ...ceremonyRows(on), screenRow('actions', 'ui.nav.actions'), screenRow('history', 'ui.nav.history'), screenRow('settings', 'ui.nav.settings'), ...common, ...rest];
  return [overview, ...ceremonyRows(on), screenRow('history', 'ui.nav.history'), ...common, screenRow('settings', 'ui.nav.settings'), ...rest];
}

/** The cards the QA hand-off may take, the ones ready for QA first (the Overview's list, and the first of it is what the menu opens). */
export function qaCandidates(cards: readonly Card[], cycle: CycleView | null | undefined): { ready: Card[]; all: Card[] } {
  const ready = cycle ? cards.filter((card) => isReadyForQa(cycle, card.stage, !!card.spec)) : [];
  return { ready, all: [...ready, ...cards.filter((x) => x.spec && !ready.includes(x))] };
}

// ---- the first thing the app shows --------------------------------------------------------------------------------------------------------------

/** What the home draws: nothing yet, the chat with the persona, the wizard that makes it, or the Overview (the person chose "Not now"). */
export type HomeView = 'loading' | 'chat' | 'wizard' | 'overview';

export function homeView(i: { config: Pick<WorkspaceConfig, 'agents'> | null; snoozed: boolean }): HomeView {
  if (!i.config) return 'loading';
  if (personaOf(i.config.agents.team)) return 'chat';
  return i.snoozed ? 'overview' : 'wizard';
}

/** The persona of the configuration, if any: a draft that was never finished is none. */
export const personaIn = (config: Pick<WorkspaceConfig, 'agents'> | null | undefined): AgentDef | null => (config ? personaOf(config.agents.team) : null);

// "Not now" on the wizard shows the Overview for the rest of the session. It is not stored: the next opening offers the wizard again.
let snoozed = false;

export const wizardSnoozed = (): boolean => snoozed;

/** The person said "Not now": the home is the Overview until the app is opened again, or until they ask for the wizard. */
export function snoozeWizard(): void {
  snoozed = true;
}

/** The person asks for the wizard again (from the Overview they were left on). */
export function resumeWizard(): void {
  snoozed = false;
}
