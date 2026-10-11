import { useMemo, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { totalUnread } from '../../../../shared/forumView';
import type { Screen } from '../../App';
import type { Ceremony } from '../../ceremony';
import { useCycle } from '../../cycleApi';
import { blockedCards, menuRows, qaCandidates } from '../../home';
import { intlLocale, useT, useTv } from '../../i18n';
import { useIsPhone } from '../../useIsPhone';
import { runningWorkspace, useWorkspaces } from '../../workspaceApi';
import { BellIcon, MoreIcon } from '../dashIcons';
import { HeaderModuleButtons } from '../moduleSlots';
import { RadarButton } from '../radarSlots';
import { badgeTitle, SaudeButton, useSaudeBadge } from '../SaudeButton';
import { Sheet } from '../Sheet';
import { UpdateBadge } from '../UpdateBadge';
import { VoiceToggle } from '../VoiceToggle';
import { useSeen, useThreads } from '../cycle/forumApi';
import { waitingRuns } from '../cycle/RunNeeds';
import { useRuns } from '../cycle/runsApi';
import { agentName } from '../cycle/names';

// The header of the chat: who the person talks to, the date, the badges the Today header carried (the test workspace, the update, the voice switch, the bell of the jobs), and
// the menu. The menu is what the chat has instead of a navigation bar: the Overview, the ceremonies and every screen the Today header and the More sheet of the phone listed.

interface RowBadge {
  count: number;
  label: string;
}

/** The menu as one list of buttons: inline under the header on the computer, a sheet on the phone. */
function MenuRows({ go, ceremony: c, phone, close }: { go: (s: Screen) => void; ceremony: Ceremony; phone: boolean; close: () => void }) {
  const t = useT();
  const tv = useTv();
  const cycle = useCycle();
  const runs = useRuns();
  const badge = useSaudeBadge();
  const waiting = waitingRuns(runs ?? []).length;
  const unread = totalUnread(useThreads() ?? [], useSeen());
  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  const firstBlocked = blockedCards(cards, runs)[0];
  const firstQa = qaCandidates(cards, cycle).all[0];
  const rows = menuRows(phone, cycle?.ceremonies);
  const open = (s: Screen) => {
    close();
    go(s);
  };
  const badges: Partial<Record<string, RowBadge>> = {
    runs: { count: waiting, label: t('ui.runs.navBadge', { count: waiting }) },
    forum: { count: unread, label: t('ui.forum.list.unreadAll', { count: unread }) },
    saude: { count: badge.total, label: badgeTitle(badge) },
  };

  return (
    <>
      {rows.map((row) => {
        let label = t(row.label);
        let disabled = false;
        let screen: Screen | null = row.screen;
        if (row.id === 'call') {
          label = c.startedAt && !c.callEnded ? tv('call.back') : tv('call.enter');
          disabled = !c.cards;
        } else if (row.id === 'deep') {
          screen = firstBlocked ? { name: 'deep', ref: firstBlocked.ref, back: 'chat' } : null;
          label = firstBlocked ? t('ui.today.deepenIssue', { iid: firstBlocked.iid }) : t('ui.today.deepen');
          disabled = !firstBlocked;
        } else if (row.id === 'qa') {
          screen = firstQa ? { name: 'qa', ref: firstQa.ref, card: firstQa } : null;
          label = t('ui.chat.menu.qa');
          disabled = !firstQa;
        }
        // On the computer the radar and health buttons are the ones of the old header, with their counts; on the phone they are rows like the others.
        if (!phone && row.id === 'radar') return <RadarButton key={row.id} go={open} />;
        if (!phone && row.id === 'saude') return <SaudeButton key={row.id} go={open} />;
        const extra = badges[row.id];
        return (
          <button
            key={row.id}
            type="button"
            className={phone ? 'sheet-row' : 'btn'}
            disabled={disabled}
            onClick={() => screen && open(screen)}
          >
            <span>{label}</span>
            {phone && extra?.count ? <span className="badge badge-block" aria-label={extra.label}>{extra.count}</span> : null}
          </button>
        );
      })}
    </>
  );
}

export function ChatHeader({ persona, go, ceremony }: { persona: AgentDef | null; go: (s: Screen) => void; ceremony: Ceremony }) {
  const t = useT();
  const phone = useIsPhone();
  const testWorkspace = runningWorkspace(useWorkspaces())?.test === true;
  const [menu, setMenu] = useState(false);
  const now = new Date();
  const date = now.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  return (
    <header className="chat-head">
      <div className="dash-top">
        <div className="dash-hello">
          {!phone && (
            <div className="dash-logo" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
              </svg>
            </div>
          )}
          <div className="dash-hello-text">
            <div className="faint">{today}</div>
            <h1 className="chat-name">{persona ? agentName([persona], persona.id) : t('ui.chat.noPersona.title')}</h1>
          </div>
        </div>
        <div className="dash-top-actions">
          <UpdateBadge go={go} />
          {testWorkspace && <span className="ws-test-chip" title={t('ui.today.testWorkspaceHint')}>{t('ui.today.testWorkspace')}</span>}
          <VoiceToggle />
          <button type="button" className="btn icon-btn" aria-label={t('ui.today.jobs')} title={t('ui.today.jobsRunning')} onClick={() => window.dispatchEvent(new CustomEvent('cerimonias:jobs-open'))}>
            <BellIcon />
          </button>
          <button type="button" className="btn" aria-expanded={menu} aria-haspopup={phone ? 'dialog' : undefined} aria-controls={phone ? undefined : 'chat-menu'} onClick={() => setMenu((v) => !v)}>
            <MoreIcon /> {t('ui.chat.menu.button')}
          </button>
        </div>
      </div>
      {menu && !phone && (
        <nav id="chat-menu" className="dash-nav chat-menu" aria-label={t('ui.today.navLabel')}>
          <MenuRows go={go} ceremony={ceremony} phone={false} close={() => setMenu(false)} />
          <HeaderModuleButtons />
        </nav>
      )}
      {menu && phone && (
        <Sheet label={t('ui.chat.menu.button')} onClose={() => setMenu(false)}>
          <div className="sheet-list" onClick={(e) => (e.target as HTMLElement).closest('.sheet-slot button, .sheet-slot a') && setMenu(false)} /* i18n-ignore */>
            <MenuRows go={go} ceremony={ceremony} phone close={() => setMenu(false)} />
            <div className="sheet-slot">
              <HeaderModuleButtons />
            </div>
          </div>
        </Sheet>
      )}
    </header>
  );
}
