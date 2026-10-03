import { type ReactNode, useState } from 'react';
import type { Screen } from '../App';
import { bottomNavActive, type NavKey } from '../dashboard';
import { useT, useTv, useVoiceEnabled } from '../i18n';
import { useIsPhone } from '../useIsPhone';
import { ActionsIcon, CallIcon, ChatIcon, HistoryIcon, HomeIcon, MoreIcon } from './dashIcons';
import { HeaderModuleButtons } from './moduleSlots';
import { badgeTitle, useSaudeBadge } from './SaudeButton';
import { totalUnread } from '../../../shared/forumView';
import { useSeen, useThreads } from './cycle/forumApi';
import { useRuns } from './cycle/runsApi';
import { waitingRuns } from './cycle/RunNeeds';
import { Sheet } from './Sheet';

interface Props {
  screen: Screen['name'];
  go: (s: Screen) => void;
  pendingActions: number;
  hasCards: boolean;
  callLive: boolean;
}

function MoreSheet({ go, onClose }: { go: (s: Screen) => void; onClose: () => void }) {
  const t = useT();
  const badge = useSaudeBadge();
  const waiting = waitingRuns(useRuns() ?? []).length;
  const unread = totalUnread(useThreads() ?? [], useSeen());
  const open = (s: Screen) => {
    onClose();
    go(s);
  };
  const rows: { label: string; screen: Screen; badge?: number; badgeLabel?: string }[] = [
    { label: t('ui.nav.settings'), screen: { name: 'settings' } },
    { label: t('ui.runs.nav'), screen: { name: 'runs' }, badge: waiting, badgeLabel: t('ui.runs.navBadge', { count: waiting }) },
    { label: t('ui.forum.nav'), screen: { name: 'forum' }, badge: unread, badgeLabel: t('ui.forum.list.unreadAll', { count: unread }) },
    { label: t('ui.nav.cost'), screen: { name: 'custo' } },
    { label: t('ui.nav.radar'), screen: { name: 'radar' } },
    { label: t('ui.nav.health'), screen: { name: 'saude' }, badge: badge.total, badgeLabel: badgeTitle(badge) },
    { label: t('ui.nav.audit'), screen: { name: 'auditoria' } },
    { label: t('ui.nav.help'), screen: { name: 'help' } },
  ];
  return (
    <Sheet label={t('ui.nav.more')} onClose={onClose}>
      <div className="sheet-list" onClick={(e) => (e.target as HTMLElement).closest('.sheet-slot button, .sheet-slot a') && onClose()} /* i18n-ignore */>
        {rows.map((r) => (
          <button key={r.screen.name} type="button" className="sheet-row" onClick={() => open(r.screen)}>
            <span>{r.label}</span>
            {r.badge ? <span className="badge badge-block" aria-label={r.badgeLabel}>{r.badge}</span> : null}
          </button>
        ))}
        <div className="sheet-slot">
          <HeaderModuleButtons />
        </div>
      </div>
    </Sheet>
  );
}

// Phone only: where there is no floating composer. Conversations (call, deep dive, gate, QA...) keep the whole screen.
export function BottomNav({ screen, go, pendingActions, hasCards, callLive }: Props) {
  const t = useT();
  const tv = useTv();
  const phone = useIsPhone();
  const voiceOn = useVoiceEnabled();
  const [more, setMore] = useState(false);
  const active = bottomNavActive(screen);
  if (!phone || !active) return null;

  const item = (key: NavKey, label: string, icon: ReactNode, onClick: () => void, extra?: { badge?: number; disabled?: boolean; live?: boolean; ariaLabel?: string }) => (
    <button
      key={key}
      type="button"
      className="bnav-item"
      aria-current={active === key ? 'page' : undefined}
      aria-label={extra?.ariaLabel}
      disabled={extra?.disabled}
      aria-haspopup={key === 'more' ? 'dialog' : undefined}
      onClick={onClick}
    >
      <span className="bnav-icon">
        {icon}
        {extra?.badge ? <span className="bnav-badge">{extra.badge > 99 ? '99+' : extra.badge}</span> : null}
        {extra?.live ? <span className="bnav-live" aria-hidden="true" /> : null}
      </span>
      <span className="bnav-label">{label}</span>
    </button>
  );

  return (
    <>
      <nav className="bnav" aria-label={t('ui.nav.mainLabel')}>
        {item('today', t('ui.nav.today'), <HomeIcon />, () => go({ name: 'today' }))}
        {item('call', tv('nav.call'), voiceOn ? <CallIcon /> : <ChatIcon />, () => go({ name: 'call' }), { disabled: !hasCards, live: callLive, ariaLabel: callLive ? tv('nav.call.live') : tv('nav.call') })}
        {item('actions', t('ui.nav.actions'), <ActionsIcon />, () => go({ name: 'actions' }), { badge: pendingActions, ariaLabel: pendingActions ? t('ui.nav.actionsPending', { count: pendingActions }) : t('ui.nav.actions') })}
        {item('history', t('ui.nav.history'), <HistoryIcon />, () => go({ name: 'history' }))}
        {item('more', t('ui.nav.more'), <MoreIcon />, () => setMore(true))}
      </nav>
      {more && <MoreSheet go={go} onClose={() => setMore(false)} />}
    </>
  );
}
