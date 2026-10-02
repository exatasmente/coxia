import type { Card } from '../shared/types';
import type { Module } from './module';
import { agenda } from './sameDay';
import { dayView, deleteMinutes, listTrash, previewDelete, restoreMinutes, saveDayTeams, saveVersionTeams } from './minutesStore';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateArg(date: unknown): string {
  if (typeof date !== 'string' || !DATE.test(date)) throw new Error('data inválida');
  return date;
}

// Which versions: "all" (the whole day) or a list of version numbers.
function whichArg(which: unknown): number[] | 'all' {
  if (which === 'all') return 'all';
  if (Array.isArray(which) && which.length && which.every((n) => Number.isInteger(n) && n > 0)) return which as number[];
  throw new Error('versões inválidas');
}

// Reachable from the window and from the browser alike: the minutes are local data, and moving them to the trash is undone by Restore.
export const minutes: Module = (ctx) => {
  ctx.handle('minutes:day', (date: unknown) => dayView(dateArg(date)));
  ctx.handle('minutes:delete-preview', (date: unknown, which: unknown) => previewDelete(dateArg(date), whichArg(which)));
  ctx.handle('minutes:delete', (date: unknown, which: unknown) => {
    const entry = deleteMinutes(dateArg(date), whichArg(which));
    // Every window and browser holding one of these ceremonies drops it.
    ctx.emit({ type: 'module', name: 'minutes:deleted', payload: entry.ceremonyIds });
    return entry;
  });
  ctx.handle('minutes:trash', () => listTrash());
  ctx.handle('minutes:restore', (id: unknown) => restoreMinutes(String(id)));
  ctx.handle('minutes:day-teams', (date: unknown, key: string, text: string) => saveDayTeams(dateArg(date), key, text));
  ctx.handle('minutes:version-teams', (date: unknown, n: number, text: string) => saveVersionTeams(dateArg(date), n, text));
  ctx.handle('sameday:agenda', (cards: Card[], ceremonyId?: string) => agenda(cards, ceremonyId));
};
