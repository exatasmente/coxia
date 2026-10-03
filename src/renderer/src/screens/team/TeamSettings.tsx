import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { Notice } from '../../wizard/ui';
import { SquadsSection } from './SquadsSection';
import { TeamSection } from './TeamSection';
import { teamApi, useConfigView } from './teamApi';
import { onTeamRequest, takeTeamRequest, TEAM_TABS, type TeamTab } from './teamNav';
import type { SectionProps } from './ui';
import './team.css';

// Settings › Team and cycle: the team, the squads, the flow, the comment templates and the runner, as tabs of one section. Everything here writes the
// configuration (desktop only), so a paired browser sees a note instead.

// The tabs that exist, in order; the labels are `ui.team.tab.<name>`.
const AVAILABLE: Record<TeamTab, ((p: SectionProps & { squad?: string; openFlow: (squad?: string) => void }) => ReactNode) | null> = {
  team: (p) => <TeamSection {...p} />,
  squads: (p) => <SquadsSection {...p} />,
  flow: null,
  comments: null,
  runner: null,
};

export function TeamSettings() {
  const t = useT();
  if (isWeb()) {
    return (
      <section className="wz-stack" aria-labelledby="team-cycle-title">
        <h2 id="team-cycle-title" className="wz-section-title">{t('ui.team.title')}</h2>
        <Notice tone="info">{t('ui.team.webNote')}</Notice>
      </section>
    );
  }
  return <TeamSettingsDesktop />;
}

function TeamSettingsDesktop() {
  const t = useT();
  const { view, error, reload } = useConfigView();
  const [tab, setTab] = useState<TeamTab>('team');
  const [squad, setSquad] = useState<string | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  const tabs = TEAM_TABS.filter((id) => AVAILABLE[id]);

  useEffect(() => {
    const take = () => {
      const r = takeTeamRequest();
      if (!r || !AVAILABLE[r.tab]) return;
      setTab(r.tab);
      setSquad(r.squad);
      root.current?.scrollIntoView({ block: 'start' });
    };
    take();
    return onTeamRequest(take);
  }, []);

  const save = async (next: SectionProps['config']) => {
    await teamApi.save(next);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(tab);
    const to = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
    if (!to) return;
    e.preventDefault();
    setTab(to);
    document.getElementById(`team-tab-${to}`)?.focus();
  };

  const render = AVAILABLE[tab];
  return (
    <section ref={root} className="wz-stack tm-root" aria-labelledby="team-cycle-title">
      <h2 id="team-cycle-title" className="wz-section-title">{t('ui.team.title')}</h2>
      <p className="small muted">{t('ui.team.intro')}</p>
      <div role="tablist" aria-label={t('ui.team.title')} className="tm-tabs" onKeyDown={onKey}>
        {tabs.map((id) => (
          <button key={id} id={`team-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="team-tabpanel" tabIndex={tab === id ? 0 : -1} className={`filter ${tab === id ? 'on' : ''}`} onClick={() => { setTab(id); if (id !== 'flow') setSquad(undefined); }}>
            {t(`ui.team.tab.${id}`)}
          </button>
        ))}
      </div>
      <div id="team-tabpanel" role="tabpanel" aria-labelledby={`team-tab-${tab}`} className="wz-stack">
        {error && <div className="error" role="alert">{error}</div>}
        {!view && !error && <span className="spinner" aria-hidden="true" />}
        {view && render?.({ config: view.config, save, reload, squad, openFlow: (s) => { setSquad(s); setTab('flow'); } })}
      </div>
    </section>
  );
}
