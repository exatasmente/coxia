import { type ReactNode, useState } from 'react';
import type { ReleaseAction } from '../../../../shared/types';
import type { Screen } from '../../App';
import type { Ceremony } from '../../ceremony';
import { useT } from '../../i18n';
import { useIsPhone } from '../../useIsPhone';
import { runningWorkspace, useWorkspaces } from '../../workspaceApi';
import { HeaderModuleButtons } from '../moduleSlots';
import { PhoneMenu } from './ChatHeader';
import { HomeNav } from './HomeNav';
import { SidebarIcon } from './navIcons';

// The frame of the home on the computer: the navigation in a sidebar that stays, and the screen beside it with the whole height. The sidebar folds to icons; the choice is a
// convenience of this computer, kept in the browser's storage and never needed. A phone has no sidebar: its header opens the same navigation in a sheet (ChatHeader), and a
// screen without that header gets a slim bar with the same menu button over its own header (`bar`).

const FOLD_KEY = 'cerimonias.homeNavFolded'; // i18n-ignore: storage key

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFolded(v: boolean): void {
  try {
    localStorage.setItem(FOLD_KEY, v ? '1' : '0');
  } catch {
    // storage refused: the sidebar stays as chosen for this session
  }
}

function Brand({ name }: { name: string | undefined }) {
  return (
    <div className="home-brand">
      <span className="dash-logo home-logo" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
        </svg>
      </span>
      {name && <span className="home-brand-name">{name}</span>}
    </div>
  );
}

interface Props {
  go: (s: Screen) => void;
  ceremony: Ceremony;
  actions: ReleaseAction[];
  current: Screen['name'];
  persona: boolean;
  /** On a phone, draw the bar with the menu button: the screen's own header does not carry it. */
  bar?: boolean;
  children: ReactNode;
}

export function HomeShell({ go, ceremony, actions, current, persona, bar = false, children }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const workspace = runningWorkspace(useWorkspaces());
  const [folded, setFolded] = useState(readFolded);
  if (phone) {
    if (!bar) return <>{children}</>;
    return (
      <>
        <div className="home-phone-bar">
          <PhoneMenu go={go} ceremony={ceremony} actions={actions} current={current} persona={persona} />
          <Brand name={workspace?.name} />
        </div>
        {children}
      </>
    );
  }

  const toggle = () => {
    const next = !folded;
    setFolded(next);
    writeFolded(next);
  };

  return (
    <div className={`home-shell ${folded ? 'home-shell-folded' : ''}`}>
      <aside className="home-side" aria-label={t('ui.chat.nav.sidebar')}>
        <div className="home-side-top">
          {!folded && <Brand name={workspace?.name} />}
          <button type="button" className="btn icon-btn home-fold" aria-expanded={!folded} aria-label={t('ui.chat.nav.toggle')} title={folded ? t('ui.chat.nav.unfold') : t('ui.chat.nav.fold')} onClick={toggle}>
            <SidebarIcon />
          </button>
        </div>
        <div className="home-side-scroll">
          <HomeNav go={go} ceremony={ceremony} actions={actions} current={current} persona={persona} folded={folded} />
          {!folded && (
            <div className="home-side-slot">
              <HeaderModuleButtons />
            </div>
          )}
        </div>
      </aside>
      <div className="home-main">{children}</div>
    </div>
  );
}
