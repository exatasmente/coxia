import { useSyncExternalStore } from 'react';
import type { BoardCard } from '../../../../shared/board';
import { api, moduleEvents } from '../../api';

// The board of the running workspace, as the screens see it: the file's own channels (`board:*`) and one shared copy of what they answered.
// The module says when the board changed, so a card opened in one window shows in the other without a poll.

export const BOARD_EVENT = 'board:changed';

export interface BoardColumn {
  id: string;
  label: string;
}

export interface BoardSquad {
  id: string;
  name: string;
  label: string;
}

export interface BoardView {
  available: boolean;
  columns: BoardColumn[];
  priorities: string[];
  /** The squads a card may go to: the ones that name a label. */
  squads: BoardSquad[];
  /** How many squads the workspace has, so the screen can say why one is missing as a destination. */
  squadCount: number;
  repos: { id: string; label: string }[];
  cards: BoardCard[];
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
  list: () => api.invoke<BoardView>('board:list'),
  create: (input: BoardCreate) => api.invoke<BoardCard>('board:create', input),
  update: (id: string, patch: BoardUpdate) => api.invoke<BoardCard>('board:update', id, patch),
  comment: (id: string, text: string) => api.invoke<BoardCard>('board:comment', id, text),
  close: (id: string) => api.invoke<BoardCard>('board:close', id),
  reopen: (id: string) => api.invoke<BoardCard>('board:reopen', id),
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
