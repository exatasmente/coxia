import { stageDisplay } from '../../shared/cycles/stages';
import { intlLocale, t, tv } from '../../shared/i18n';
import type { AgentTurn, Card, ReleaseAction } from '../../shared/types';
import type { TempoIssue } from '../../shared/tempo';
import type { WatcherAlert } from '../../shared/watchers';

// Pure rules behind the Hoje dashboard: what the main card offers, what needs the person.

export function greeting(hour: number): string {
  if (hour < 5) return t('today.greeting.night');
  if (hour < 12) return t('today.greeting.morning');
  if (hour < 18) return t('today.greeting.afternoon');
  return t('today.greeting.night');
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** The weekly retro is "relevant" from its time on, on its day. */
export function retroDue(now: Date, retroDay: number, retroTime: string): boolean {
  return now.getDay() === retroDay && now.getHours() * 60 + now.getMinutes() >= minutesOf(retroTime);
}

export type AgoraAction = 'call' | 'ata' | 'reset' | 'retro';

export interface AgoraInput {
  hasCards: boolean;
  loadingCards: boolean;
  startedAt: number | null;
  callEnded: boolean;
  saved: boolean;
  resumed: boolean;
  ready: number;
  total: number;
  decisions: number;
  effects: number;
  retroDue: boolean;
  /** How the cycle calls the daily preparation; absent: the default label ("pré-daily" / "pre-daily"). */
  label?: string;
  /** Earlier meetings today: which version this one is, and how many cards need nothing new. */
  sameDay?: { version: number | null; unchanged: number; changed: number };
}

export interface AgoraButton {
  action: AgoraAction;
  label: string;
  disabled?: boolean;
}

export interface AgoraPlan {
  phase: 'loading' | 'ready' | 'live' | 'ended';
  title: string;
  hint: string | null;
  progress: string | null;
  primary: AgoraButton;
  secondary: AgoraButton[];
}

/** What the team calls the daily preparation; the cycle says it ("pré-daily", "daily scrum", "standup"). */
const defaultLabel = (): string => t('ui.today.preDailyLabel');
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function resumeNote(startedAt: number | null, saved: boolean, label = defaultLabel()): string {
  if (saved) return t('ui.today.resume.saved', { label });
  if (startedAt) {
    const at = new Date(startedAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
    return t('ui.today.resume.started', { label, time: at });
  }
  return t('ui.today.resume.restored');
}

function ataHint(i: AgoraInput): string | null {
  if (!i.decisions && !i.effects) return null;
  return `${t('ui.today.ataDecisions', { count: i.decisions })} · ${t('ui.today.ataEffects', { count: i.effects })}`;
}

/** The one primary action of the "Agora" card, by the moment of the pre-daily. */
export function agoraPlan(i: AgoraInput): AgoraPlan {
  const label = i.label ?? defaultLabel();
  const ended = i.callEnded || i.saved;
  const retro: AgoraButton[] = i.retroDue ? [{ action: 'retro', label: t('ui.today.openRetro') }] : [];
  const note = i.resumed ? resumeNote(i.startedAt, i.saved, label) : null;
  const ata: AgoraButton = { action: 'ata', label: t('ui.today.viewMinutes') };

  if (ended) {
    return {
      phase: 'ended',
      title: `${t('ui.today.agora.ended', { label: capital(label) })}${i.sameDay?.version ? ` · ${t('minutes.version.label', { n: i.sameDay.version })}` : ''}`,
      hint: ataHint(i) ?? note,
      progress: null,
      primary: ata,
      secondary: [{ action: 'reset', label: t('ui.today.agora.new', { label }), disabled: i.loadingCards }, ...retro],
    };
  }
  if (i.startedAt) {
    return {
      phase: 'live',
      title: tv('call.inProgress'),
      hint: ataHint(i) ?? note,
      progress: null,
      primary: { action: 'call', label: tv('call.back') },
      secondary: [ata],
    };
  }
  if (!i.hasCards) {
    return {
      phase: 'loading',
      title: capital(label),
      hint: t('ui.today.agora.loadingHint'),
      progress: t('ui.today.buildingCards'),
      primary: { action: 'call', label: t('ui.today.agora.start', { label }), disabled: true },
      secondary: retro,
    };
  }
  return {
    phase: 'ready',
    title: capital(label),
    hint:
      note ??
      (i.sameDay && i.sameDay.unchanged + i.sameDay.changed > 0
        ? t('sameDay.today.hint', { unchanged: i.sameDay.unchanged, changed: i.sameDay.changed })
        : t('ui.today.agora.readyHint', { count: i.total })),
    progress: i.ready < i.total ? t('ui.today.agora.progress', { ready: i.ready, total: i.total }) : null,
    primary: { action: 'call', label: t('ui.today.agora.start', { label }) },
    secondary: [...(i.resumed ? [{ action: 'reset', label: t('ui.today.agora.new', { label }), disabled: i.loadingCards } as AgoraButton] : []), ...retro],
  };
}

// The sentence of a card source command that only has text; the integration's own blocker is localized, so it is never parsed.
const MR_CONFLICT = /^(.+): MR com conflitos$/;

/** The MRs of the card that conflict, in the card's order: the ones the source flags, plus the ones a blocker names with the command's sentence. */
export function conflictMrs(card: Card): Card['mrPaths'] {
  const refs = new Set([...(card.mrConflicts ?? []), ...card.blockers.map((b) => MR_CONFLICT.exec(b)?.[1]).filter((r): r is string => !!r)]);
  return card.mrPaths.filter((m) => refs.has(m.ref));
}

export function isPendingAction(a: ReleaseAction): boolean {
  return a.state === 'pending' || a.state === 'failed';
}

export type NeedTarget =
  | { to: 'deep'; ref: string }
  | { to: 'gate'; ref: string; card: Card }
  | { to: 'actions' }
  | { to: 'conflict'; id: string };

export interface NeedItem {
  id: string;
  kind: 'blocked' | 'actions' | 'conflict' | 'question' | 'watcher';
  tone: 'stop' | 'warn' | 'info';
  title: string;
  detail: string | null;
  cta: string | null;
  to: NeedTarget | null;
  // Only watcher rows can be dismissed.
  alertId?: string;
  // Blocked rows of a card with a conflicting MR: the card, so the row can offer to resolve it.
  conflictCard?: Card;
  // The one MR whose button the row shows, when the row's own reason is that MR's; absent: one button per conflicting MR.
  conflictRef?: string;
}

export interface NeedsInput {
  cards: Card[];
  turns: Record<string, AgentTurn>;
  answered: Record<string, boolean>;
  actions: ReleaseAction[];
  alerts: WatcherAlert[];
}

export function pendingQuestions(cards: Card[], turns: Record<string, AgentTurn>, answered: Record<string, boolean>): Card[] {
  return cards.filter((c) => turns[c.ref]?.question && !answered[c.ref]);
}

function watcherItem(a: WatcherAlert): NeedItem {
  return {
    id: `watcher:${a.id}`,
    kind: 'watcher',
    tone: a.kind === 'rejections' ? 'stop' : 'warn',
    title: a.message,
    detail: a.detail,
    cta: a.card ? t('ui.today.openGate') : null,
    to: a.card ? { to: 'gate', ref: a.card.ref, card: a.card } : null,
    alertId: a.id,
  };
}

/** Only what needs the person today, most serious first. */
export function needsYou(i: NeedsInput): NeedItem[] {
  const items: NeedItem[] = [];
  items.push(...i.alerts.filter((a) => a.kind === 'rejections').map(watcherItem));

  for (const a of i.actions.filter((x) => x.kind === 'conflict' && isPendingAction(x))) {
    items.push({
      id: `conflict:${a.id}`,
      kind: 'conflict',
      tone: 'warn',
      title: t('ui.today.need.conflict', { issue: a.issue }),
      detail: a.issueTitle,
      cta: t('ui.today.need.seeConflict'),
      to: { to: 'conflict', id: a.id },
    });
  }

  for (const c of i.cards.filter((x) => x.blockers.length)) {
    const conflicting = conflictMrs(c);
    const own = conflicting.find((m) => c.blockers[0].startsWith(`${m.ref}:`));
    items.push({
      id: `blocked:${c.ref}`,
      kind: 'blocked',
      tone: 'warn',
      title: c.blockers[0],
      detail: `#${c.iid} · ${c.title}`,
      cta: t('ui.today.deepen'),
      to: { to: 'deep', ref: c.ref },
      ...(conflicting.length ? { conflictCard: c, ...(own ? { conflictRef: own.ref } : {}) } : {}),
    });
  }

  const release = i.actions.filter((x) => x.kind !== 'conflict' && isPendingAction(x)).length;
  if (release > 0) {
    items.push({
      id: 'actions',
      kind: 'actions',
      tone: 'warn',
      title: t('ui.today.need.releaseActions', { count: release }),
      detail: null,
      cta: t('ui.today.need.seeActions'),
      to: { to: 'actions' },
    });
  }

  for (const c of pendingQuestions(i.cards, i.turns, i.answered)) {
    items.push({
      id: `question:${c.ref}`,
      kind: 'question',
      tone: 'info',
      title: i.turns[c.ref]?.question ?? '',
      detail: `#${c.iid} · ${c.title}`,
      cta: t('ui.today.need.answer'),
      to: { to: 'deep', ref: c.ref },
    });
  }

  items.push(...i.alerts.filter((a) => a.kind !== 'rejections').map(watcherItem));
  return items;
}

export function mrLabel(n: number): string {
  return n === 0 ? t('ui.today.noMr') : t('ui.today.mrCount', { count: n });
}

export function stageLabel(card: Card): string {
  return stageDisplay(card.stage, t('today.noStage'));
}

export interface TempoSegment {
  issue: string | null;
  minutes: number;
  pct: number;
}

/** Share of the day per issue, for the thin stacked bar; the percentages add up to 100. */
export function tempoSegments(issues: TempoIssue[]): TempoSegment[] {
  const total = issues.reduce((n, i) => n + i.minutes, 0);
  if (total <= 0) return [];
  return issues.filter((i) => i.minutes > 0).map((i) => ({ issue: i.issue, minutes: i.minutes, pct: (i.minutes / total) * 100 }));
}

export type NavKey = 'today' | 'call' | 'actions' | 'history' | 'more';

const NAV_ACTIVE: Record<string, NavKey> = {
  today: 'today',
  actions: 'actions',
  history: 'history',
  settings: 'more',
  custo: 'more',
  radar: 'more',
  saude: 'more',
  auditoria: 'more',
  help: 'more',
  glossario: 'more',
  run: 'more',
  runs: 'more',
  board: 'more',
  forum: 'more',
  procedures: 'more',
};

/** The bottom bar only appears where no floating composer lives: conversations (call, deep, gate, qa...) hide it. */
export function bottomNavActive(screen: string): NavKey | null {
  return NAV_ACTIVE[screen] ?? null;
}
