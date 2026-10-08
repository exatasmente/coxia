import type { Card } from './types';
import type { Language, SquadDef, StageDef, StageKind } from './config/types';
import { catalogText, cycleText } from './cycles/text';

// The workspace's own board: the cards nothing else holds. A card of the board is a plain document (a `BoardCard`), and this file is the pure
// part of it — what a card carries, how a patch changes one, how a board card becomes a card of the day, and which squads the board may give it
// to. A host's card is the host's: nothing here reaches a code host.

/** One line of a card's history: what happened, when, and what it changed. Kept in the file and read back with the card. */
export interface BoardHistoryEntry {
  at: string;
  kind: 'created' | 'moved' | 'priority' | 'squad' | 'closed' | 'reopened' | 'commented' | 'edited';
  from?: string | null;
  to?: string | null;
  /** What was commented, or which fields were edited; short and already written for a person. */
  text?: string;
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

/** The squads the board offers for a card being given to one: every configured squad that names a label, which is how the card is claimed. */
export function squadsForCard(squads: readonly SquadDef[]): SquadDef[] {
  return squads.filter((s) => !!squadLabel(s));
}
