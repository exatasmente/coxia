import { useMemo } from 'react';
import type { ReleaseAction } from '../../../../shared/types';
import { totalUnread } from '../../../../shared/forumView';
import type { Screen } from '../../App';
import type { Ceremony } from '../../ceremony';
import { useCycle } from '../../cycleApi';
import { type HomeCounts, type NavId, type RowContext, blockedCards, homeCounts, isCurrentRow, navGroups, qaCandidates, resolveRow, rowTitle } from '../../home';
import { useT, useTv } from '../../i18n';
import { useWatcherAlerts } from '../../watchersApi';
import { useSeen, useThreads } from '../cycle/forumApi';
import { waitingRuns } from '../cycle/RunNeeds';
import { useRuns } from '../cycle/runsApi';
import { useRadarCount } from '../radarSlots';
import { badgeTitle, useSaudeBadge } from '../SaudeButton';
import { NavIcon } from './navIcons';

// The navigation of the home: the sidebar of the computer and the menu sheet of the phone draw these rows. Each count sits on the row it opens, quiet at zero, so what needs
// the person reads at a glance without a band of colored boxes over the conversation.

/** The four counts of the home, from the lists the Overview draws (home.ts). */
export function useHomeCounts(c: Ceremony, actions: ReleaseAction[]): HomeCounts {
  const runs = useRuns();
  const { alerts } = useWatcherAlerts();
  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  return useMemo(() => homeCounts({ cards, turns: c.turns, answered: c.answered, runs, actions, alerts }), [cards, c.turns, c.answered, runs, actions, alerts]);
}

interface Badge {
  count: number;
  /** What the count says to a screen reader. */
  label: string;
  tone: 'warn' | 'info';
}

interface Props {
  go: (s: Screen) => void;
  ceremony: Ceremony;
  actions: ReleaseAction[];
  /** The screen on show, marked as the current row. */
  current: Screen['name'];
  persona: boolean;
  /** Icons only (the sidebar folded): the words go to the tooltip and the accessible name. */
  folded?: boolean;
  /** Called after a row is chosen: the phone's sheet closes. */
  onPick?: () => void;
}

export function HomeNav({ go, ceremony: c, actions, current, persona, folded = false, onPick }: Props) {
  const t = useT();
  const tv = useTv();
  const cycle = useCycle();
  const runs = useRuns();
  const counts = useHomeCounts(c, actions);
  const health = useSaudeBadge();
  const radar = useRadarCount();
  const waiting = waitingRuns(runs ?? []).length;
  const unread = totalUnread(useThreads() ?? [], useSeen());
  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  const firstBlocked = blockedCards(cards, runs)[0];
  const firstQa = qaCandidates(cards, cycle).all[0];

  const badges: Partial<Record<NavId, Badge>> = {
    blocked: { count: counts.blocked, label: t('ui.today.tiles.blockersAria', { count: counts.blocked }), tone: 'warn' },
    asking: { count: counts.asking, label: t('ui.today.tiles.questionsAria', { count: counts.asking }), tone: 'info' },
    actions: { count: counts.actions, label: t('ui.today.tiles.actionsAria', { count: counts.actions }), tone: 'warn' },
    needs: { count: counts.needs, label: t('ui.chat.strip.needsAria', { count: counts.needs }), tone: 'warn' },
    runs: { count: waiting, label: t('ui.runs.navBadge', { count: waiting }), tone: 'info' },
    forum: { count: unread, label: t('ui.forum.list.unreadAll', { count: unread }), tone: 'info' },
    saude: { count: health.total, label: badgeTitle(health), tone: 'warn' },
    radar: { count: radar.total, label: t('ui.radar.button.title', { total: radar.total, urgent: radar.urgent }), tone: radar.urgent ? 'warn' : 'info' },
  };

  // What a row says on hover beyond its words: the help's shortcut, and what the radar and the health check count.
  const titles: Partial<Record<NavId, string>> = {
    help: t('ui.today.helpShortcut'),
    radar: radar.ran ? t('ui.radar.button.title', { total: radar.total, urgent: radar.urgent }) : t('ui.radar.notRunYet'),
    saude: health.total ? badgeTitle(health) : t('ui.health.button.title'),
  };

  const ctx: RowContext = { callHeld: !!c.startedAt && !c.callEnded, hasCards: !!c.cards, firstBlocked, firstQa };

  return (
    <nav className={`home-nav ${folded ? 'home-nav-folded' : ''}`} aria-label={t('ui.today.navLabel')}>
      {navGroups(cycle?.ceremonies, persona).map((g) => (
        <div key={g.id} className="home-nav-group" role="group" aria-label={g.label ? t(g.label) : undefined}>
          {g.label && !folded && <div className="home-nav-head">{t(g.label)}</div>}
          {g.rows.map((r) => {
            const { label, screen } = resolveRow(r, ctx, { t, tv });
            const badge = badges[r.id];
            const shown = badge && badge.count > 0 ? badge : null;
            return (
              <button
                key={r.id}
                type="button"
                className="home-nav-row"
                aria-current={isCurrentRow(r, current) ? 'page' : undefined}
                aria-label={shown ? `${label}, ${shown.label}` : folded ? label : undefined}
                title={rowTitle(label, titles[r.id], folded)}
                disabled={!screen}
                onClick={() => {
                  if (!screen) return;
                  onPick?.();
                  go(screen);
                }}
              >
                <span className="home-nav-icon">
                  <NavIcon id={r.id} />
                  {folded && shown && <span className={`home-nav-dot home-nav-${shown.tone}`} aria-hidden="true" />}
                </span>
                {!folded && <span className="home-nav-label">{label}</span>}
                {!folded && shown && (
                  <span className={`home-nav-count home-nav-${shown.tone}`} aria-hidden="true">
                    {shown.count > 99 ? '99+' : shown.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
