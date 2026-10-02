import { useCallback, useEffect, useState } from 'react';
import type { DayView, DeletePreview, TrashEntry } from '../../shared/minutesVersions';
import type { SameDayMark } from '../../shared/sameDay';
import type { Card } from '../../shared/types';
import { api, errorText } from './api';

// Which versions of a day: the whole day, or the numbers.
export type Which = number[] | 'all';

export const minutesApi = {
  day: (date: string) => api.invoke<DayView>('minutes:day', date),
  previewDelete: (date: string, which: Which) => api.invoke<DeletePreview>('minutes:delete-preview', date, which),
  remove: (date: string, which: Which) => api.invoke<TrashEntry>('minutes:delete', date, which),
  trash: () => api.invoke<TrashEntry[]>('minutes:trash'),
  restore: (id: string) => api.invoke<{ date: string; versions: { from: number; to: number }[] }>('minutes:restore', id),
  saveDayTeams: (date: string, key: string, text: string) => api.invoke<void>('minutes:day-teams', date, key, text),
  saveVersionTeams: (date: string, n: number, text: string) => api.invoke<void>('minutes:version-teams', date, n, text),
  agenda: (cards: Card[], ceremonyId: string) => api.invoke<{ cards: Card[]; marks: Record<string, SameDayMark> }>('sameday:agenda', cards, ceremonyId),
};

/** The versions of one day, read again when `refresh` changes or `reload` is called. */
export function useDay(date: string | null, refresh: unknown = null) {
  const [day, setDay] = useState<DayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!date) return Promise.resolve();
    return minutesApi.day(date).then(
      (d) => {
        setDay(d);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, [date]);
  useEffect(() => {
    void reload();
  }, [reload, refresh]);
  return { day, error, reload };
}
