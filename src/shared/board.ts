import type { Card } from './types';
import type { Language, SquadDef, StageDef, StageKind, VcsKind } from './config/types';
import { catalogText, cycleText } from './cycles/text';

// The workspace's own board: the cards nothing else holds. A card of the board is a plain document (a `BoardCard`), and this file is the pure
// part of it — what a card carries, how a patch changes one, how a board card becomes a card of the day, and which squads the board may give it
// to. A host's card is the host's: nothing here reaches a code host.

/** One line of a card's history: what happened, when, and what it changed. Kept in the file and read back with the card. */
export interface BoardHistoryEntry {
  at: string;
  /** `sent`: the issue was made on the code host (`text` is its reference). `host`: the host changed something (`text` is `column`, `state`, `title` or `labels`, with `from` and `to` for column and state). */
  kind: 'created' | 'moved' | 'priority' | 'squad' | 'closed' | 'reopened' | 'commented' | 'edited' | 'sent' | 'host';
  from?: string | null;
  to?: string | null;
  /** What was commented, or which fields were edited; short and already written for a person. */
  text?: string;
}

/** The issue a card became on the code host. Absent on a card: it exists only on the board. */
export interface BoardHostLink {
  /** Labels, urls and what can be written depend on the host's kind. */
  vcs: VcsKind;
  /** As the host's reads name it (the path); the write's key when the workspace has no path. */
  project: string;
  iid: number;
  url: string;
  linkedAt: string;
}

/** Why the last attempt to reach the host left no link. */
export interface BoardHostNote {
  kind: 'failed' | 'declined' | 'unsupported' | 'unlinked';
  /** Already written for a person: a reason, never a token. */
  text: string;
  at: string;
}

/** A card opened on the board. */
export interface BoardCard {
  /** Eight lower-case letters and digits. Never a number, so it can never be mistaken for a code host's reference. */
  id: string;
  title: string;
  body: string;
  /** The id of a `devCycle.stages` stage: the column the card sits in. */
  column: string;
  /** A squad id, or null. */
  squad: string | null;
  /** A level of `devCycle.priority.labels` (the label name), or null. Never the level's pattern. */
  priority: string | null;
  /** Labels the card carries, as the day shows them; a card given to a squad carries the squad's own label. */
  labels: string[];
  /** A `projects.repos[].id`, or null when the workspace has no repository. */
  repo: string | null;
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  history: BoardHistoryEntry[];
  /** The issue it became. Absent: the card exists only on the board. */
  host?: BoardHostLink;
  /** Why the last attempt to reach the host left no link; cleared when the card is linked. */
  hostNote?: BoardHostNote;
}

export interface BoardFile {
  version: 1;
  cards: BoardCard[];
}

export const BOARD_VERSION = 1;
export const BOARD_ID_LENGTH = 8;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A board id from random bytes: eight characters of the alphabet above, never only digits, so it never reads as an issue number. */
export function boardId(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < BOARD_ID_LENGTH; i++) out += ID_ALPHABET[bytes[i % bytes.length] % ID_ALPHABET.length];
  return /^[0-9]+$/.test(out) ? `a${out.slice(1)}` : out;
}

export function emptyBoard(): BoardFile {
  return { version: BOARD_VERSION, cards: [] };
}

/** The columns a card may sit in: the stages the workspace configured, in their own order. */
export function boardColumns(stages: readonly StageDef[]): StageDef[] {
  return [...stages];
}

/** The name a kind of stage goes by, in the workspace's language: the word the team screen offers when a stage is edited. */
const KIND_LABEL_KEY: Record<StageKind, string> = {
  backlog: 'ui.flow.kind.backlog',
  development: 'ui.flow.kind.development',
  review: 'ui.flow.kind.review',
  reviewApproved: 'ui.flow.kind.reviewApproved',
  qa: 'ui.flow.kind.qa',
  qaApproved: 'ui.flow.kind.qaApproved',
  returned: 'ui.flow.kind.returned',
  done: 'ui.flow.kind.done',
  blocked: 'ui.flow.kind.blocked',
};

// A stage whose label names a catalog key in the namespace the app words its own texts with (the shipped cycle templates) is not a text a
// person reads: its text is what the key says. Any other label (a name typed in the team screen) is the name itself.
const KEY_SHAPED = /^(cycle|ui|main|wizard|minutes)\./;

/**
 * The name of a column, in words a person reads: the text of a label that is a catalog key, the label itself when it is a name, and the name
 * of the kind when the label is a key nobody has (a stage edited in the team screen with a label that is no longer a text). The day and the
 * board therefore never show a raw key.
 */
export function columnLabel(label: string, kind: StageKind, language: Language): string {
  if (!KEY_SHAPED.test(label)) return label;
  return cycleText(label, language) !== label ? cycleText(label, language) : (catalogText(KIND_LABEL_KEY[kind], language) ?? label);
}

export function columnOf(stages: readonly StageDef[], id: string): StageDef | null {
  return stages.find((s) => s.id === id) ?? null;
}

/** The level of `devCycle.priority.labels` a card may carry: a plain label name, never a pattern (a pattern ranks cards but cannot be stored). */
export function boardPriorities(levels: readonly string[]): string[] {
  return levels.map((level) => level.replace(/^\^/, '').replace(/\$$/, '')).filter((level) => !!level && !/[\\^$.*+?()[\]{}|]/.test(level));
}

/** The label a squad is reached by on the board: its own label, else the first of its scope's. Null: the squad names no label. */
export function squadLabel(squad: SquadDef): string | null {
  return squad.label?.trim() || squad.scope.labels[0]?.trim() || null;
}

/** The squads the board may give a card to, in the order the configuration has them. A squad that names no label is not a destination. */
export function boardSquadChoices(squads: readonly SquadDef[], language: Language): { id: string; name: string; label: string }[] {
  return squads.flatMap((s) => {
    const label = squadLabel(s);
    return label ? [{ id: s.id, name: cycleText(s.name, language) || s.id, label }] : [];
  });
}

/** A card of the board as the day carries it. `ref` is the repository id and the board's own id; the stage is the column's own name. */
export function boardCardOf(card: BoardCard, o: { stages: readonly StageDef[]; language: Language; levels: readonly string[]; title?: string }): Card {
  const column = columnOf(o.stages, card.column);
  const stage = column ? columnLabel(column.label, column.kind, o.language) : null;
  return {
    ref: cardRef(card),
    iid: card.id,
    title: card.title,
    stage,
    spec: null,
    mrs: [],
    mrPaths: [],
    blockers: [],
    pending: [],
    changes: [],
    note: lastComment(card),
    url: '',
    labels: card.labels,
    milestone: null,
    updatedAt: card.updatedAt,
    ...(card.repo ? { project: card.repo } : {}),
    priority: priorityOf(card.priority, o.levels),
  };
}

/** `<repository id>#<board id>`, or the board id alone when the card names no repository. */
export function cardRef(card: Pick<BoardCard, 'id' | 'repo'>): string {
  return card.repo ? `${card.repo}#${card.id}` : card.id;
}

/** What the card's note shows: the text of the last comment of its own history. */
export function lastComment(card: BoardCard): string | null {
  const last = [...card.history].reverse().find((h) => h.kind === 'commented' && h.text?.trim());
  return last?.text?.trim() ?? null;
}

/** The level a stored priority label stands for, ranked like any other card's priority. Null when the card carries none or it no longer matches. */
export function priorityOf(label: string | null, levels: readonly string[]): { rank: number; label: string } | null {
  if (!label) return null;
  const at = boardPriorities(levels).findIndex((l) => l.toLowerCase() === label.toLowerCase());
  return at < 0 ? null : { rank: at, label };
}

export interface BoardPatch {
  title?: string;
  body?: string;
  column?: string;
  squad?: string | null;
  priority?: string | null;
  labels?: string[];
  state?: 'open' | 'closed';
  comment?: string;
  /** The label of the squad the card is being given to (its own, or its first scope label): written on the card beside the squad id. */
  squadLabel?: string;
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? '') === (b ?? '');

/**
 * The card after a patch, with a history line for every change and `updatedAt` bumped when anything came of it. Pure: the caller validates
 * the column, the squad and the priority before calling.
 */
export function applyPatch(card: BoardCard, patch: BoardPatch, at: string): BoardCard {
  const next: BoardCard = { ...card, history: [...card.history] };
  const line = (kind: BoardHistoryEntry['kind'], extra: Omit<BoardHistoryEntry, 'at' | 'kind'> = {}): void => {
    next.history.push({ at, kind, ...extra });
  };
  let changed = false;

  if (patch.title !== undefined && patch.title !== card.title) {
    next.title = patch.title;
    line('edited', { text: 'title' });
    changed = true;
  }
  if (patch.body !== undefined && patch.body !== card.body) {
    next.body = patch.body;
    line('edited', { text: 'body' });
    changed = true;
  }
  if (patch.column !== undefined && patch.column !== card.column) {
    line('moved', { from: card.column, to: patch.column });
    next.column = patch.column;
    changed = true;
  }
  if (patch.squad !== undefined && !same(patch.squad, card.squad)) {
    line('squad', { from: card.squad, to: patch.squad });
    next.squad = patch.squad;
    changed = true;
  }
  if (patch.priority !== undefined && !same(patch.priority, card.priority)) {
    line('priority', { from: card.priority, to: patch.priority });
    next.priority = patch.priority;
    changed = true;
  }
  if (patch.labels !== undefined) {
    const labels = [...new Set(patch.labels.map((l) => l.trim()).filter(Boolean))];
    if (labels.join('\u0000') !== card.labels.join('\u0000')) {
      next.labels = labels;
      line('edited', { text: 'labels' });
      changed = true;
    }
  }
  if (patch.state !== undefined && patch.state !== card.state) {
    line(patch.state === 'closed' ? 'closed' : 'reopened');
    next.state = patch.state;
    changed = true;
  }
  if (patch.comment) {
    line('commented', { text: patch.comment });
    changed = true;
  }
  if (!changed) return card;
  next.updatedAt = at;
  return next;
}

// ---------------------------------------------------------------- the host's issues on the board

/** What a write of the board is aimed at: a card of the board by its id, or an issue the host lists that no card holds, by its project and number. */
export type BoardTarget = string | { project: string; iid: number };

/** An issue the host lists that no card of the board is linked to. Derived from a read and never stored: the board file gains nothing for it. */
export interface BoardItem {
  /** `<project>#<iid>`. */
  key: string;
  project: string;
  iid: number;
  title: string;
  /** A stage id of the workspace's columns, or null: the stages cannot place it ("No column"). */
  column: string | null;
  labels: string[];
  url: string;
  updatedAt: string | null;
  priority: string | null;
  squad: string | null;
}

export const itemKey = (project: string, iid: number): string => `${project}#${iid}`;

/** What reading one project of the host found. */
export interface BoardProjectLine {
  project: string;
  /** How many open issues the read brought. */
  count: number;
  /** The read reached its limit: older issues of the project are not on the board. */
  truncated: boolean;
  /** Why the project could not be read, else null. */
  error: string | null;
}

/** What the board knows about the host after a read: the project listing, the issues no card holds, and how each linked card stands. */
export interface HostRead {
  at: string;
  /** The workspace names no project of this host to list. */
  noProject: boolean;
  projects: BoardProjectLine[];
  items: BoardItem[];
  /** For each card linked to an issue, what the host said now. */
  seen: Record<string, HostSeen['state']>;
  /** The read failed as a whole (not a single project); nothing came of it. */
  error: string | null;
}

/** Where a card stands in relation to the host: `none` with no usable host; the rest, in the order the screen gives them precedence. */
export type HostState = 'none' | 'waiting' | 'linked' | 'missing' | 'unread' | 'notSent';

/** The squads the board offers for a card being given to one: every configured squad that names a label, which is how the card is claimed. */
export function squadsForCard(squads: readonly SquadDef[]): SquadDef[] {
  return squads.filter((s) => !!squadLabel(s));
}

// ---------------------------------------------------------------- the mirror: what the host says about a card it holds

/** What a read of the host found for a card the board opened: the issue as it is now, or why there is none. */
export interface HostSeen {
  /** `missing`: the host does not return it (deleted, moved, no access). `unread`: it could not be read now; the stored copy stays. */
  state: 'open' | 'closed' | 'missing' | 'unread';
  title: string;
  /** The issue's labels as the host holds them, the board's own stage labels included. */
  labels: string[];
  /** The stage the host's labels, status and mapping give it, or null when none. */
  stageId: string | null;
  updatedAt: string | null;
  url: string;
}

export interface MirrorContext {
  stages: readonly StageDef[];
  levels: readonly string[];
  squads: readonly SquadDef[];
  /** The host's issues have labels (Bitbucket's do not): when false, the board's own column, priority and squad are never touched. */
  labelsOnHost: boolean;
  /** Every label the app could have written for a stage (`ownStageLabels`): they say the column and are not part of the card's labels. */
  ownLabels: readonly string[];
}

const lowerCase = (s: string): string => s.toLowerCase();
const has = (labels: readonly string[], label: string): boolean => labels.some((l) => lowerCase(l) === lowerCase(label));

/** The priority and the squad an issue's labels say: the first configured plain level whose label it carries, the first squad whose label it carries. */
export function derivedFields(labels: readonly string[], ctx: Pick<MirrorContext, 'levels' | 'squads'>): { priority: string | null; squad: string | null } {
  const priority = boardPriorities(ctx.levels).find((level) => has(labels, level)) ?? null;
  const squad = ctx.squads.find((s) => {
    const label = squadLabel(s);
    return label !== null && has(labels, label);
  });
  return { priority, squad: squad?.id ?? null };
}

/** The changes to a card for what the host said; only the fields that differ. */
export interface MirrorChanges {
  title?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  updatedAt?: string;
  column?: string;
  priority?: string | null;
  squad?: string | null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l) => has(b, l));

/**
 * What the host says that the card's copy does not. The host is canonical: title, open or closed, labels (without the app's own stage labels), the column and
 * the priority and squad its labels say. Nothing for an issue that is missing or could not be read. For a host with no issue labels, the board's own column,
 * priority and squad are kept. A newer `updatedAt` of the host's is taken so the day orders the card by what happened last.
 */
export function mirrorOf(card: BoardCard, seen: HostSeen, ctx: MirrorContext): MirrorChanges {
  if (seen.state !== 'open' && seen.state !== 'closed') return {};
  const out: MirrorChanges = {};
  if (seen.title && seen.title !== card.title) out.title = seen.title;
  if (seen.state !== card.state) out.state = seen.state;
  if (ctx.labelsOnHost) {
    // A host with no labels on issues says none: the card's own labels (the squad's among them) are not wiped by an empty answer.
    const labels = [...new Set(seen.labels.filter((l) => !has(ctx.ownLabels, l)))];
    if (!sameSet(labels, card.labels)) out.labels = labels;
    if (seen.stageId && seen.stageId !== card.column && ctx.stages.some((s) => s.id === seen.stageId)) out.column = seen.stageId;
    const derived = derivedFields(seen.labels, ctx);
    if (derived.priority !== card.priority) out.priority = derived.priority;
    if (derived.squad !== card.squad) out.squad = derived.squad;
  }
  const seenAt = seen.updatedAt ? Date.parse(seen.updatedAt) : NaN;
  if (!Number.isNaN(seenAt) && seenAt > Date.parse(card.updatedAt)) out.updatedAt = new Date(seenAt).toISOString();
  return out;
}

/** The card after the host's changes, with a `host` line for a column, a state, a title or labels that changed. Returns the same card when nothing came of it. */
export function applyMirror(card: BoardCard, changes: MirrorChanges, at: string): BoardCard {
  if (!Object.keys(changes).length) return card;
  const next: BoardCard = { ...card, history: [...card.history] };
  const line = (text: string, extra: Omit<BoardHistoryEntry, 'at' | 'kind' | 'text'> = {}): void => {
    next.history.push({ at, kind: 'host', text, ...extra });
  };
  if (changes.title !== undefined) {
    next.title = changes.title;
    line('title');
  }
  if (changes.state !== undefined) {
    line('state', { from: card.state, to: changes.state });
    next.state = changes.state;
  }
  if (changes.column !== undefined) {
    line('column', { from: card.column, to: changes.column });
    next.column = changes.column;
  }
  if (changes.labels !== undefined) {
    next.labels = changes.labels;
    line('labels');
  }
  if (changes.priority !== undefined) next.priority = changes.priority;
  if (changes.squad !== undefined) next.squad = changes.squad;
  if (changes.updatedAt !== undefined) next.updatedAt = changes.updatedAt;
  return next;
}
