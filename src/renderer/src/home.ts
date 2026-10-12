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
// because nothing renders a component in the tests: the counts, the ceremony bar, the rows of the navigation.

/** The Overview: what Today held, a screen of its own. */
export const OVERVIEW: Screen = { name: 'overview' };

/** The screen the app opens on and every "back to the start" goes to. `homeView` says what it draws: the chat, or the wizard that makes the persona, or the Overview. */
export const HOME: Screen = { name: 'chat' };

/** Where a deep dive goes back to: the pre-daily it came from, or the home. */
export type DeepBack = 'chat' | 'call';

export const deepBack = (back: DeepBack): Screen => (back === 'call' ? { name: 'call' } : HOME);

// ---- the counts ----------------------------------------------------------------------------------------------------------------------------------

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

/** The four counts of the navigation. The Overview lists what these count (`blockedCards`, `pendingQuestions`, `needsYou`), so the navigation and the Overview cannot disagree. */
export function homeCounts(i: HomeCountsInput): HomeCounts {
  return {
    blocked: blockedCards(i.cards, i.runs).length,
    asking: pendingQuestions(i.cards, i.turns, i.answered).length,
    actions: i.actions.filter(isPendingAction).length,
    needs: needsYou({ cards: i.cards, turns: i.turns, answered: i.answered, actions: i.actions, alerts: i.alerts }).length + waitingRuns(i.runs ?? []).length,
  };
}

/** Where each count leads: the Overview at its section, or Actions. */
export function countTarget(count: keyof HomeCounts): Screen {
  return count === 'actions' ? { name: 'actions' } : { name: 'overview', section: count };
}

/** Whether anything is counted: the phone's menu button carries a dot then, since the counts live in the menu. */
export const anyCount = (c: HomeCounts): boolean => c.blocked + c.asking + c.actions + c.needs > 0;

// ---- the ceremony card --------------------------------------------------------------------------------------------------------------------------

/** The bar above the box: the plan of the Agora card of the Overview when it has something to say, and nothing for a cycle with no pre-daily or while the cards load. */
export function ceremonyCard(plan: AgoraPlan, ceremonies: Pick<CycleView['ceremonies'], 'preDaily'> | undefined): AgoraPlan | null {
  if (ceremonies?.preDaily === false) return null;
  return plan.phase === 'loading' ? null : plan;
}

// ---- the navigation -----------------------------------------------------------------------------------------------------------------------------

export type NavId =
  | 'chat'
  | 'overview'
  | 'blocked'
  | 'asking'
  | 'actions'
  | 'needs'
  | 'call'
  | 'deep'
  | 'qa'
  | 'retro'
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
  | 'schedules'
  | 'auditoria'
  | 'claudeSessions'
  | 'help';

export interface NavRow {
  id: NavId;
  /** The catalog key of the words of the row. */
  label: string;
  /** The screen it opens; the two ceremonies that work on a card (`deep`, `qa`) take it from the cards, so they have none here. */
  screen: Screen | null;
}

export interface NavGroup {
  id: 'home' | 'attention' | 'ceremonies' | 'cycle' | 'app';
  /** The catalog key of the group's heading; the first group has none. */
  label: string | null;
  rows: NavRow[];
}

const row = (id: NavId & Screen['name'], label: string): NavRow => ({ id, label, screen: { name: id } as Screen });
const countRow = (id: keyof HomeCounts, label: string): NavRow => ({ id, label, screen: countTarget(id) });

/** The ceremonies the navigation offers, the way the Overview offers them: a ceremony the cycle turned off is not listed. */
function ceremonyRows(on: Partial<CycleView['ceremonies']> | undefined): NavRow[] {
  return [
    ...(on?.preDaily !== false ? [row('call', 'ui.today.preDaily')] : []),
    ...(on?.unblock !== false ? [{ id: 'deep' as const, label: 'ui.today.deepen', screen: null }] : []),
    ...(on?.qaHandoff !== false ? [{ id: 'qa' as const, label: 'ui.today.qaHandoff', screen: null }] : []),
    ...(on?.retro !== false ? [row('retro', 'ui.today.retro')] : []),
  ];
}

/**
 * The navigation of the home, in groups: the sidebar on the computer and the menu sheet on the phone list the same rows. What needs the person comes first, with its counts;
 * then the ceremonies, the cycle's screens and the app's. Every screen is one tap away, so none depends on the model understanding a request. The machine's Claude Code
 * sessions are listed only when the feature is on, and only in the desktop window (`claude` is false in a paired browser).
 */
export function navGroups(on: Partial<CycleView['ceremonies']> | undefined, persona: boolean, claude = false): NavGroup[] {
  return [
    { id: 'home', label: null, rows: [...(persona ? [row('chat', 'ui.nav.chat')] : []), row('overview', 'ui.chat.menu.overview')] },
    {
      id: 'attention',
      label: 'ui.chat.nav.attention',
      rows: [countRow('blocked', 'ui.today.tiles.blockers'), countRow('asking', 'ui.today.tiles.questions'), countRow('actions', 'ui.today.tiles.actions'), countRow('needs', 'ui.chat.strip.needs')],
    },
    { id: 'ceremonies', label: 'ui.chat.nav.ceremonies', rows: ceremonyRows(on) },
    {
      id: 'cycle',
      label: 'ui.chat.nav.cycle',
      rows: [row('runs', 'ui.runs.nav'), row('board', 'ui.board.nav'), row('forum', 'ui.forum.nav'), row('procedures', 'ui.procedures.nav'), row('memory', 'ui.memory.nav'), row('history', 'ui.nav.history')],
    },
    {
      id: 'app',
      label: 'ui.chat.nav.app',
      rows: [row('radar', 'ui.nav.radar'), row('saude', 'ui.nav.health'), row('schedules', 'ui.schedules.nav'), row('custo', 'ui.nav.cost'), row('auditoria', 'ui.nav.audit'), ...(claude ? [row('claudeSessions', 'ui.claude.nav')] : []), row('settings', 'ui.nav.settings'), row('help', 'ui.nav.help')],
    },
  ].filter((g) => g.rows.length > 0) as NavGroup[];
}

/** What the words of a row need from the translators: the plain one and the one that follows the voice mode. */
export interface RowSay {
  t: (key: string, params?: Record<string, string | number>) => string;
  tv: (key: string, params?: Record<string, string | number>) => string;
}

/** What the day decides about the rows: the pre-daily held or not, whether the board's cards are loaded, and the first card each card-bound ceremony could take. */
export interface RowContext {
  callHeld: boolean;
  hasCards: boolean;
  firstBlocked?: Pick<Card, 'iid' | 'ref'>;
  firstQa?: Card;
}

/**
 * The words and the target of a row that depend on the day: the pre-daily is named as the cycle names it and says "back" while it is held (and has no target before the cards
 * load), and the two ceremonies on a card open the first card they can take, or nothing when there is none.
 */
export function resolveRow(r: NavRow, ctx: RowContext, say: RowSay): { label: string; screen: Screen | null } {
  if (r.id === 'call') return { label: ctx.callHeld ? say.tv('call.back') : say.t(r.label), screen: ctx.hasCards ? r.screen : null };
  if (r.id === 'deep') {
    const card = ctx.firstBlocked;
    return { label: card ? say.t('ui.today.deepenIssue', { iid: card.iid }) : say.t('ui.today.deepen'), screen: card ? { name: 'deep', ref: card.ref, back: 'chat' } : null };
  }
  if (r.id === 'qa') return { label: say.t('ui.chat.menu.qa'), screen: ctx.firstQa ? { name: 'qa', ref: ctx.firstQa.ref, card: ctx.firstQa } : null };
  return { label: say.t(r.label), screen: r.screen };
}

/** Whether a row is the screen on show; the Overview's rows that open a section of it do not count as the Overview itself. */
export function isCurrentRow(r: NavRow, current: Screen['name']): boolean {
  return r.screen?.name === current && (current !== 'overview' || r.id === 'overview');
}

/** The hover text of a row: its detail (what the radar counts, the help's shortcut), and, when the sidebar is folded, its words too, since the icon alone does not say them. */
export function rowTitle(label: string, detail: string | undefined, folded: boolean): string | undefined {
  if (!folded) return detail;
  return detail ? `${label} · ${detail}` : label;
}

// The screens the navigation opens are drawn inside its frame (HomeShell), the sidebar on the computer and the menu button on the phone, so the menu does not vanish one tap
// away from the home. The chat and the Overview draw the frame themselves, since their header carries the phone's menu; the conversations (call, deep dive, gate, QA...) and
// the wizards keep the whole screen.
const FRAMED: ReadonlySet<Screen['name']> = new Set<Screen['name']>([
  'actions', 'history', 'settings', 'custo', 'radar', 'saude', 'schedules', 'auditoria', 'help', 'glossario', 'run', 'runs', 'board', 'forum', 'procedures', 'memory', 'prompts', 'claudeSessions',
]);

export const framedScreen = (name: Screen['name']): boolean => FRAMED.has(name);

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
