import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { ReleaseAction } from '../../../../shared/types';
import type { Screen } from '../../App';
import type { Ceremony } from '../../ceremony';
import { HOME, anyCount, resumeWizard } from '../../home';
import { intlLocale, useT } from '../../i18n';
import { useIsPhone } from '../../useIsPhone';
import { runningWorkspace, useWorkspaces } from '../../workspaceApi';
import { BellIcon } from '../dashIcons';
import { HeaderModuleButtons } from '../moduleSlots';
import { Sheet } from '../Sheet';
import { UpdateBadge } from '../UpdateBadge';
import { VoiceToggle } from '../VoiceToggle';
import { agentName } from '../cycle/names';
import { HomeNav, useHomeCounts } from './HomeNav';

// The header of the home: who the person talks to, the date, and the badges the Today header carried (the test workspace, the update, the voice switch, the bell of the jobs).
// On the computer the navigation is the sidebar beside it (HomeShell); a phone has no room for one, so the header carries a menu button that opens it in a sheet, with a dot
// while something is counted.

const MenuIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

interface HeaderProps {
  persona: AgentDef | null;
  go: (s: Screen) => void;
  ceremony: Ceremony;
  actions: ReleaseAction[];
  /** The screen the header sits on, marked in the navigation. */
  current: Screen['name'];
  /** What the title says when it is not the persona's name: the Overview of a workspace that has no persona yet keeps this header, with its menu. */
  title?: string;
  /** Offers to make the persona (the wizard asked again after "Not now"). */
  invite?: boolean;
}

export function ChatHeader({ persona, go, ceremony, actions, current, title, invite }: HeaderProps) {
  const t = useT();
  const phone = useIsPhone();
  const testWorkspace = runningWorkspace(useWorkspaces())?.test === true;
  const counts = useHomeCounts(ceremony, actions);
  const [menu, setMenu] = useState(false);
  const now = new Date();
  const date = now.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const today = date.charAt(0).toUpperCase() + date.slice(1);
  const name = title ?? (persona ? agentName([persona], persona.id) : t('ui.chat.noPersona.title'));
  const counted = anyCount(counts);

  return (
    <header className="chat-head">
      {phone && (
        <button
          type="button"
          className="btn icon-btn chat-menu-btn"
          aria-haspopup="dialog"
          aria-expanded={menu}
          aria-label={counted ? t('ui.chat.menu.buttonCounted') : t('ui.chat.menu.button')}
          onClick={() => setMenu(true)}
        >
          <MenuIcon />
          {counted && <span className="chat-menu-dot" aria-hidden="true" />}
        </button>
      )}
      <div className="chat-head-text">
        <h1 className="chat-name">{name}</h1>
        <div className="faint small">{today}</div>
      </div>
      <div className="chat-head-actions">
        {invite && (
          <button type="button" className="btn btn-dark" onClick={() => {
            resumeWizard();
            go(HOME);
          }}>
            {t('ui.chat.invite')}
          </button>
        )}
        <UpdateBadge go={go} />
        {testWorkspace && <span className="ws-test-chip" title={t('ui.today.testWorkspaceHint')}>{t('ui.today.testWorkspace')}</span>}
        <VoiceToggle />
        <button type="button" className="btn icon-btn" aria-label={t('ui.today.jobs')} title={t('ui.today.jobsRunning')} onClick={() => window.dispatchEvent(new CustomEvent('cerimonias:jobs-open'))}>
          <BellIcon />
        </button>
      </div>
      {menu && phone && (
        <Sheet label={t('ui.chat.menu.button')} onClose={() => setMenu(false)}>
          <div className="sheet-list" onClick={(e) => (e.target as HTMLElement).closest('.sheet-slot button, .sheet-slot a') && setMenu(false)} /* i18n-ignore */>
            <HomeNav go={go} ceremony={ceremony} actions={actions} current={current} persona={!!persona} onPick={() => setMenu(false)} />
            <div className="sheet-slot">
              <HeaderModuleButtons />
            </div>
          </div>
        </Sheet>
      )}
    </header>
  );
}
