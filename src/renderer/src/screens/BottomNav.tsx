import { type ReactNode, useState } from 'react';
import type { Screen } from '../App';
import { bottomNavActive, type NavKey } from '../dashboard';
import { useIsPhone } from '../useIsPhone';
import { ActionsIcon, CallIcon, HistoryIcon, HomeIcon, MoreIcon } from './dashIcons';
import { HeaderModuleButtons } from './moduleSlots';
import { useSaudeProblems } from './SaudeButton';
import { Sheet } from './Sheet';

interface Props {
  screen: Screen['name'];
  go: (s: Screen) => void;
  pendingActions: number;
  hasCards: boolean;
  callLive: boolean;
}

function MoreSheet({ go, onClose }: { go: (s: Screen) => void; onClose: () => void }) {
  const problems = useSaudeProblems();
  const open = (s: Screen) => {
    onClose();
    go(s);
  };
  const rows: { label: string; screen: Screen; badge?: number }[] = [
    { label: 'Configurações', screen: { name: 'settings' } },
    { label: 'Custo', screen: { name: 'custo' } },
    { label: 'Radar', screen: { name: 'radar' } },
    { label: 'Saúde', screen: { name: 'saude' }, badge: problems },
    { label: 'Auditoria', screen: { name: 'auditoria' } },
    { label: 'Ajuda', screen: { name: 'help' } },
  ];
  return (
    <Sheet label="Mais" onClose={onClose}>
      <div className="sheet-list" onClick={(e) => (e.target as HTMLElement).closest('.sheet-slot button, .sheet-slot a') && onClose()}>
        {rows.map((r) => (
          <button key={r.label} type="button" className="sheet-row" onClick={() => open(r.screen)}>
            <span>{r.label}</span>
            {r.badge ? <span className="badge badge-block" aria-label={`${r.badge} problema(s)`}>{r.badge}</span> : null}
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
  const phone = useIsPhone();
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
      <nav className="bnav" aria-label="Navegação principal">
        {item('today', 'Hoje', <HomeIcon />, () => go({ name: 'today' }))}
        {item('call', 'Call', <CallIcon />, () => go({ name: 'call' }), { disabled: !hasCards, live: callLive, ariaLabel: callLive ? 'Call, em andamento' : 'Call' })}
        {item('actions', 'Ações', <ActionsIcon />, () => go({ name: 'actions' }), { badge: pendingActions, ariaLabel: pendingActions ? `Ações, ${pendingActions} pendentes` : 'Ações' })}
        {item('history', 'Histórico', <HistoryIcon />, () => go({ name: 'history' }))}
        {item('more', 'Mais', <MoreIcon />, () => setMore(true))}
      </nav>
      {more && <MoreSheet go={go} onClose={() => setMore(false)} />}
    </>
  );
}
