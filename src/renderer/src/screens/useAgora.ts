import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { api } from '../api';
import type { Ceremony } from '../ceremony';
import { useCycle } from '../cycleApi';
import { type AgoraAction, type AgoraPlan, agoraPlan, retroDue } from '../dashboard';
import { useDay } from '../minutesApi';

/**
 * The plan of the Agora card and what its buttons do. The Overview draws it and the chat pins it above the box; both read it here, so the card says the same thing in both
 * and its buttons do what they always did.
 */
export function useAgora(c: Ceremony, go: (s: Screen) => void): { plan: AgoraPlan; onAgora: (a: AgoraAction) => void; retroToday: boolean; ready: number } {
  const cycle = useCycle();
  const on = cycle?.ceremonies;
  const [retro, setRetro] = useState<{ day: number; time: string } | null>(null);
  useEffect(() => {
    void api.getSettings().then((s) => setRetro({ day: s.schedule.retroDay, time: s.schedule.retroTime }), () => undefined);
  }, []);

  const cards = c.cards?.cards ?? [];
  const ready = cards.filter((card) => c.turns[card.ref]).length;
  const now = new Date();
  const { day } = useDay(c.snapshot.id.slice(0, 10), c.startedAt);
  const version = day?.versions.find((v) => v.ceremonyId === c.snapshot.id)?.n ?? null;
  const retroToday = on?.retro !== false && !!retro && retroDue(now, retro.day, retro.time);
  const plan = agoraPlan({
    hasCards: !!c.cards,
    loadingCards: c.loadingCards,
    startedAt: c.startedAt,
    callEnded: c.callEnded,
    saved: !!c.saveResult,
    resumed: c.resumed,
    ready,
    total: cards.length,
    decisions: c.decisions.length,
    effects: c.effects.length,
    retroDue: retroToday,
    label: cycle?.preDailyLabel,
    sameDay: {
      version,
      unchanged: Object.values(c.marks).filter((x) => x.kind === 'unchanged').length,
      changed: Object.values(c.marks).filter((x) => x.kind === 'changed').length,
    },
  });

  const onAgora = (a: AgoraAction) => {
    if (a === 'call') go({ name: 'call' });
    else if (a === 'ata') go({ name: 'ata' });
    else if (a === 'retro') go({ name: 'retro' });
    else void c.reset();
  };

  return { plan, onAgora, retroToday, ready };
}
