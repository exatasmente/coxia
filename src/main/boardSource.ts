import { join } from 'node:path';
import type { BoardCard } from '../shared/board';
import { createBoardStore } from './board-core';
import { ATAS } from './env';

// The board file of the running workspace, read and written through one store: the module changes the cards and the day reads them from the same
// place, so a card opened now is in the day right after. The id of a new card is the module's business, never the store's.

let store: ReturnType<typeof createBoardStore> | null = null;

/** The board store of the running workspace. */
export function boardStore() {
  store ??= createBoardStore({ file: join(ATAS, 'board.json'), now: () => new Date() });
  return store;
}

/** The open cards of the board, oldest first. A workspace that never opened one has an empty list, which is not an error. */
export function boardCards(): BoardCard[] {
  return boardStore().list().filter((c) => c.state === 'open');
}
