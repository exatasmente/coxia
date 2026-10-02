import type { AgentTurn, Card, ReleaseAction } from '../../shared/types';
import type { TempoIssue } from '../../shared/tempo';
import type { WatcherAlert } from '../../shared/watchers';

// Pure rules behind the Hoje dashboard: what the main card offers, what needs the person, how activities are ordered.

export function greeting(hour: number): string {
  if (hour < 5) return 'Boa noite';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
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

export function resumeNote(startedAt: number | null, saved: boolean): string {
  if (saved) return 'A pré-daily de hoje já foi encerrada e a ata está gravada.';
  if (startedAt) {
    const at = new Date(startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `Retomando a pré-daily de hoje, começada às ${at}: os agentes já preparados não são chamados de novo.`;
  }
  return 'Cartões e agentes de hoje recuperados do disco, sem chamar o GitLab nem os agentes de novo.';
}

function ataHint(i: AgoraInput): string | null {
  if (!i.decisions && !i.effects) return null;
  return `${i.decisions} ${i.decisions === 1 ? 'decisão' : 'decisões'} · ${i.effects} ${i.effects === 1 ? 'efeito aguardando' : 'efeitos aguardando'} “sim”`;
}

/** The one primary action of the "Agora" card, by the moment of the pre-daily. */
export function agoraPlan(i: AgoraInput): AgoraPlan {
  const ended = i.callEnded || i.saved;
  const retro: AgoraButton[] = i.retroDue ? [{ action: 'retro', label: 'Abrir a retro' }] : [];
  const note = i.resumed ? resumeNote(i.startedAt, i.saved) : null;
  const ata: AgoraButton = { action: 'ata', label: 'Ver ata' };

  if (ended) {
    return {
      phase: 'ended',
      title: 'Pré-daily encerrada',
      hint: ataHint(i) ?? note,
      progress: null,
      primary: ata,
      secondary: [{ action: 'reset', label: 'Nova pré-daily', disabled: i.loadingCards }, ...retro],
    };
  }
  if (i.startedAt) {
    return {
      phase: 'live',
      title: 'Call em andamento',
      hint: ataHint(i) ?? note,
      progress: null,
      primary: { action: 'call', label: 'Voltar à call' },
      secondary: [ata],
    };
  }
  if (!i.hasCards) {
    return {
      phase: 'loading',
      title: 'Pré-daily',
      hint: 'Lendo o GitLab pelo daily-report (~30 s).',
      progress: 'Montando cartões…',
      primary: { action: 'call', label: 'Começar a pré-daily', disabled: true },
      secondary: retro,
    };
  }
  return {
    phase: 'ready',
    title: 'Pré-daily',
    hint: note ?? `${i.total} ${i.total === 1 ? 'atividade' : 'atividades'}, bloqueadas primeiro. ~30 s por atividade.`,
    progress: i.ready < i.total ? `Agentes prontos ${i.ready} de ${i.total}` : null,
    primary: { action: 'call', label: 'Começar a pré-daily' },
    secondary: [...(i.resumed ? [{ action: 'reset', label: 'Nova pré-daily', disabled: i.loadingCards } as AgoraButton] : []), ...retro],
  };
}

const MR_CONFLICT = /^(.+): MR com conflitos$/;

/** The MRs of the card that the report blocks for conflicts ("<mr>: MR com conflitos"), in the card's order. */
export function conflictMrs(card: Card): Card['mrPaths'] {
  const refs = new Set(card.blockers.map((b) => MR_CONFLICT.exec(b)?.[1]).filter((r): r is string => !!r));
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
  // Blocked rows whose first reason is an MR with conflicts: the card, so the row can offer to resolve it.
  conflictCard?: Card;
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
    cta: a.card ? 'Abrir o gate' : null,
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
      title: `Conflito na #${a.issue} ao sincronizar com a main`,
      detail: a.issueTitle,
      cta: 'Ver conflito',
      to: { to: 'conflict', id: a.id },
    });
  }

  for (const c of i.cards.filter((x) => x.blockers.length)) {
    items.push({
      id: `blocked:${c.ref}`,
      kind: 'blocked',
      tone: 'warn',
      title: c.blockers[0],
      detail: `#${c.iid} · ${c.title}`,
      cta: 'Aprofundar',
      to: { to: 'deep', ref: c.ref },
      ...(MR_CONFLICT.test(c.blockers[0]) && conflictMrs(c).length ? { conflictCard: c } : {}),
    });
  }

  const release = i.actions.filter((x) => x.kind !== 'conflict' && isPendingAction(x)).length;
  if (release > 0) {
    items.push({
      id: 'actions',
      kind: 'actions',
      tone: 'warn',
      title: release === 1 ? '1 ação de release aguardando o seu “seguir”' : `${release} ações de release aguardando o seu “seguir”`,
      detail: null,
      cta: 'Ver ações',
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
      cta: 'Responder',
      to: { to: 'deep', ref: c.ref },
    });
  }

  items.push(...i.alerts.filter((a) => a.kind !== 'rejections').map(watcherItem));
  return items;
}

/** Lower is more urgent: blocked, then waiting for an answer, then back from QA, then close to QA, then the rest. */
export function urgencyRank(card: Card, turn: AgentTurn | undefined, answered: boolean): number {
  if (card.blockers.length) return 0;
  if (turn?.question && !answered) return 1;
  if (/Test Fail/i.test(card.stage ?? '')) return 2;
  if (/Code Review OK|Ready To Test/i.test(card.stage ?? '')) return 3;
  return 4;
}

/** Stable: equal ranks keep the order the cards came in. */
export function sortByUrgency(cards: Card[], turns: Record<string, AgentTurn>, answered: Record<string, boolean>): Card[] {
  return cards
    .map((card, index) => ({ card, index, rank: urgencyRank(card, turns[card.ref], !!answered[card.ref]) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.card);
}

export function mrLabel(n: number): string {
  return n === 0 ? 'sem MR' : n === 1 ? '1 MR' : `${n} MRs`;
}

export function stageLabel(card: Card): string {
  return (card.stage ?? '').replace(/^STAGE::\s*/, '') || 'sem estágio';
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
};

/** The bottom bar only appears where no floating composer lives: conversations (call, deep, gate, qa...) hide it. */
export function bottomNavActive(screen: string): NavKey | null {
  return NAV_ACTIVE[screen] ?? null;
}
