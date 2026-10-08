import { useSyncExternalStore } from 'react';
import type { BoardCard, BoardItem, BoardProjectLine, BoardTarget, HostState, Waiting } from '../../../../shared/board';
import { api, moduleEvents } from '../../api';

// The board of the running workspace, as the screens see it: the file's own channels (`board:*`) and one shared copy of what they answered.
// The module says when the board changed, so a card opened in one window shows in the other without a poll.

export const BOARD_EVENT = 'board:changed';

/** Where a column is written on the host: the label, and whether it is the mapping's, the app's own default, or cannot be written. */
export interface ColumnWrite {
  label: string | null;
  by: 'mapping' | 'default' | 'refused';
}

export interface BoardColumn {
  id: string;
  label: string;
  /** Null where the host keeps no labels or there is no host. */
  writes: ColumnWrite | null;
}

export interface BoardSquad {
  id: string;
  name: string;
  label: string;
}

/** A card, and where it stands in relation to the host. */
export type BoardCardView = BoardCard & { hostState: HostState; waiting: Waiting | null };

/** An issue the host lists that no card holds, and what waits in Actions for it. */
export type BoardItemView = BoardItem & { waiting: Waiting | null };

export interface BoardHostView {
  name: string | null;
  /** The host's issues have labels: a column, a priority and a squad can be written there. */
  labels: boolean;
  readAt: string | null;
  error: string | null;
  /** Why a card cannot become an issue now, else null. */
  cannotSend: string | null;
}

export interface BoardView {
  /** Null where the workspace has no usable code host: the board is then only the workspace's own. */
  host: BoardHostView | null;
  projects: BoardProjectLine[];
  noProject: boolean;
  items: BoardItemView[];
  columns: BoardColumn[];
  priorities: string[];
  /** The squads a card may go to: the ones that name a label. */
  squads: BoardSquad[];
  /** How many squads the workspace has, so the screen can say why one is missing as a destination. */
  squadCount: number;
  repos: { id: string; label: string }[];
  cards: BoardCardView[];
}

export interface BoardCreate {
  title: string;
  body: string;
  column: string;
  squad?: string | null;
  priority?: string | null;
  repo?: string | null;
  labels?: string[];
}

export interface BoardUpdate {
  title?: string;
  body?: string;
  column?: string;
  squad?: string | null;
  priority?: string | null;
  labels?: string[];
}

export const boardApi = {
  list: (refresh = false) => api.invoke<BoardView>('board:list', refresh),
  create: (input: BoardCreate) => api.invoke<BoardCard>('board:create', input),
  send: (id: string) => api.invoke<BoardCard>('board:send', id),
  update: (target: BoardTarget, patch: BoardUpdate) => api.invoke<BoardCard | null>('board:update', target, patch),
  comment: (target: BoardTarget, text: string) => api.invoke<BoardCard | null>('board:comment', target, text),
  close: (target: BoardTarget) => api.invoke<BoardCard | null>('board:close', target),
  reopen: (target: BoardTarget) => api.invoke<BoardCard | null>('board:reopen', target),
};

let view: BoardView | null = null;
let started = false;
const subscribers = new Set<() => void>();

function set(next: BoardView): void {
  view = next;
  for (const fn of subscribers) fn();
}

/** Reads the board again; the screen calls it after a move, and the module's event calls it for every window. */
export function reloadBoard(): void {
  void boardApi.list().then(set, () => undefined);
}

function start(): void {
  if (started) return;
  started = true;
  moduleEvents.addEventListener(BOARD_EVENT, reloadBoard);
  reloadBoard();
}

/** The board: null until the first read. */
export function useBoard(): BoardView | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => view,
  );
}
