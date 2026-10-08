import { useSyncExternalStore } from 'react';
import type { BoardCard, BoardItem, BoardProjectLine, BoardTarget, HostState, SendAllResult, Waiting } from '../../../../shared/board';
import { api, moduleEvents } from '../../api';

// The board of the running workspace, as the screens see it: the file's own channels (`board:*`) and one shared copy of what they answered.
// The module says when the board changed, so a card opened in one window shows in the other without a poll.

export const BOARD_EVENT = 'board:changed';
/** Raised by the app shell whenever the list of proposals in Actions changes. */
export const ACTIONS_EVENT = 'actions:changed';

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
  /** How many cards "Send all" would send now. */
  sendable: number;
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
  sendAll: () => api.invoke<SendAllResult>('board:sendAll'),
  update: (target: BoardTarget, patch: BoardUpdate) => api.invoke<BoardCard | null>('board:update', target, patch),
  comment: (target: BoardTarget, text: string) => api.invoke<BoardCard | null>('board:comment', target, text),
  close: (target: BoardTarget) => api.invoke<BoardCard | null>('board:close', target),
  reopen: (target: BoardTarget) => api.invoke<BoardCard | null>('board:reopen', target),
};

let view: BoardView | null = null;
const subscribers = new Set<() => void>();

function set(next: BoardView): void {
  view = next;
  for (const fn of subscribers) fn();
}

/**
 * Reads the board again. With a host, `refresh` asks the host instead of reusing what was read less than five minutes ago: the screen's own opening and
 * the module's events reuse it, the person's refresh button does not.
 */
export function reloadBoard(refresh = false): Promise<void> {
  return boardApi.list(refresh).then(set, () => undefined);
}

/**
 * Follows the board while its screen is on: it reads again when the board changed and when a proposal in Actions was approved, skipped or failed. Only while
 * the screen is mounted — the host is read when the board is opened or refreshed, and at no other time. Returns the way to stop.
 */
export function watchBoard(): () => void {
  const reload = (): void => void reloadBoard();
  moduleEvents.addEventListener(BOARD_EVENT, reload);
  moduleEvents.addEventListener(ACTIONS_EVENT, reload);
  return () => {
    moduleEvents.removeEventListener(BOARD_EVENT, reload);
    moduleEvents.removeEventListener(ACTIONS_EVENT, reload);
  };
}

/** The board: null until the first read, which the screen asks for when it opens. */
export function useBoard(): BoardView | null {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => view,
  );
}
