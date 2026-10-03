import { useEffect, useMemo, useRef, useState } from 'react';
import { isReadyForQa } from '../../../shared/cycles/stages';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api } from '../api';
import type { Ceremony } from '../ceremony';
import { useCycle } from '../cycleApi';
import { type AgoraAction, agoraPlan, greeting, needsYou, pendingQuestions, retroDue } from '../dashboard';
import { useIsPhone } from '../useIsPhone';
import { useWatcherAlerts } from '../watchersApi';
import { BellIcon } from './dashIcons';
import { HeaderModuleButtons } from './moduleSlots';
import { RadarButton } from './radarSlots';
import { SaudeButton } from './SaudeButton';
import { TempoHoje } from './TempoHoje';
import { UpdateBadge } from './UpdateBadge';
import { ActivityRow, AgoraCard, NeedsList, Tiles } from './TodayParts';
import { VoiceToggle } from './VoiceToggle';
import { runningWorkspace, useWorkspaces } from '../workspaceApi';
import { intlLocale, useT, useTv } from '../i18n';
import { useDay } from '../minutesApi';

type Filter = 'all' | 'blocked' | 'ask';

const TOP = 3;

export function Today({ ceremony: c, go, pendingActions, actions }: { ceremony: Ceremony; go: (s: Screen) => void; pendingActions: number; actions: ReleaseAction[] }) {
  const t = useT();
  const tv = useTv();
  const phone = useIsPhone();
  const testWorkspace = runningWorkspace(useWorkspaces())?.test === true;
  const cycle = useCycle();
  const on = cycle?.ceremonies;
  const [filter, setFilter] = useState<Filter>('all');
  const [listOpen, setListOpen] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [retro, setRetro] = useState<{ day: number; time: string } | null>(null);
  const { alerts, dismiss } = useWatcherAlerts();
  const actsRef = useRef<HTMLElement>(null);

  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  const ready = cards.filter((card) => c.turns[card.ref]).length;
  // `cards` is already in the agenda's order (blocked, priority, last update): Today lists them as the call will, without sorting again.
  const blocked = cards.filter((card) => card.blockers.length);
  const asking = pendingQuestions(cards, c.turns, c.answered);
  const forQa = cycle ? cards.filter((card) => isReadyForQa(cycle, card.stage, !!card.spec)) : [];
  const shown = filter === 'blocked' ? blocked : filter === 'ask' ? asking : cards;
  const visible = listOpen || filter !== 'all' ? shown : shown.slice(0, TOP);
  const needs = needsYou({ cards, turns: c.turns, answered: c.answered, actions, alerts });
  const colors = useMemo(() => new Map(cards.map((card) => [`#${card.iid}`, c.colorOf(card.ref)])), [cards, c.colorOf]);

  const now = new Date();
  const date = now.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  // Turns already prepared (or restored from disk) come from the cache; only the missing ones call an agent.
  useEffect(() => {
    if (c.cards) void c.prepareAll();
  }, [c.cards, c.prepareAll]);

  useEffect(() => {
    void api.getSettings().then((s) => setRetro({ day: s.schedule.retroDay, time: s.schedule.retroTime }), () => undefined);
  }, []);

  const { day: todayDay } = useDay(c.snapshot.id.slice(0, 10), c.startedAt);
  const todayVersion = todayDay?.versions.find((v) => v.ceremonyId === c.snapshot.id)?.n ?? null;
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
      version: todayVersion,
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

  const showFilter = (f: Filter) => {
    setFilter(f);
    setListOpen(true);
    requestAnimationFrame(() => actsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };

  const header = (
    <header className="dash-top">
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
          <h1>{cycle?.userName ? t('ui.today.greetingName', { greeting: greeting(now.getHours()), name: cycle.userName }) : greeting(now.getHours())}</h1>
        </div>
      </div>
      <div className="dash-top-actions">
        <UpdateBadge go={go} />
        {testWorkspace && <span className="ws-test-chip" title={t('ui.today.testWorkspaceHint')}>{t('ui.today.testWorkspace')}</span>}
        {!phone && (
          <nav className="dash-nav" aria-label={t('ui.today.navLabel')}>
            <button type="button" className="btn" onClick={() => go({ name: 'history' })}>{t('ui.nav.history')}</button>
            <button type="button" className="btn" onClick={() => go({ name: 'settings' })}>{t('ui.nav.settings')}</button>
            <button type="button" className="btn" onClick={() => go({ name: 'custo' })}>{t('ui.nav.cost')}</button>
            <RadarButton go={go} />
            <SaudeButton go={go} />
            <button type="button" className="btn" onClick={() => go({ name: 'auditoria' })}>{t('ui.nav.audit')}</button>
            <button type="button" className="btn" title={t('ui.today.helpShortcut')} onClick={() => go({ name: 'help' })}>{t('ui.nav.help')}</button>
            <HeaderModuleButtons />
          </nav>
        )}
        <VoiceToggle />
        <button type="button" className="btn icon-btn" aria-label={t('ui.today.jobs')} title={t('ui.today.jobsRunning')} onClick={() => window.dispatchEvent(new CustomEvent('cerimonias:jobs-open'))}>
          <BellIcon />
        </button>
      </div>
    </header>
  );

  // A cycle with no daily preparation has no call to start: the card and the filters that lead to it are left out.
  const agora = on?.preDaily === false ? null : <AgoraCard plan={plan} onAction={onAgora} />;
  const tiles = <Tiles blocked={blocked.length} asking={asking.length} actions={pendingActions} onBlocked={() => showFilter('blocked')} onAsking={() => showFilter('ask')} onActions={() => go({ name: 'actions' })} />;
  const needsBlock = (
    <>
      <NeedsList items={needs} go={go} dismiss={dismiss} />
      {/* slot: banners of feature modules */}
    </>
  );
  const tempo = (
    <TempoHoje refreshKey={`${c.startedAt}-${c.callEnded}-${Object.values(c.deep).reduce((n, d) => n + d.msgs.length, 0)}`} colorFor={(issue) => (issue ? colors.get(issue) : undefined)} />
  );

  const activities = (
    <section className="dash-sec" ref={actsRef} aria-labelledby="acts-h">
      <div className="row spread dash-sec-head">
        <h2 id="acts-h" className="section-title">{c.cards ? t('ui.today.activitiesCount', { count: cards.length }) : t('ui.today.activities')}</h2>
        <button type="button" className="btn dash-refresh" disabled={c.loadingCards} onClick={() => void c.loadCards(true)}>
          {c.loadingCards ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.today.refreshGitlab')}
        </button>
      </div>

      {(listOpen || filter !== 'all') && (
        <div className="filters" role="group" aria-label={t('ui.today.filter.label')}>
          {([
            ['all', t('ui.today.filter.all', { count: cards.length })],
            ['blocked', t('ui.today.filter.blocked', { count: blocked.length })],
            ['ask', t('ui.today.filter.ask', { count: asking.length })],
          ] as [Filter, string][]).map(([key, label]) => (
            <button key={key} type="button" className={`filter ${filter === key ? 'on' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <ul className="acts">
        {!c.cards &&
          Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="act">
              <div className="act-head" aria-hidden="true">
                <div className="skeleton" style={{ width: 32, height: 32 }} />
                <div className="skeleton" style={{ height: 16, flex: '1 1 auto' }} />
              </div>
            </li>
          ))}
        {visible.map((card) => (
          <ActivityRow key={card.ref} card={card} c={c} go={go} open={openRef === card.ref} onToggle={() => setOpenRef((r) => (r === card.ref ? null : card.ref))} />
        ))}
      </ul>
      {c.cards && !visible.length && <p className="dash-calm">{t('ui.today.noActivities')}</p>}
      {c.cards && c.cards.total > cards.length && <p className="faint small">{t('ui.today.outside', { count: c.cards.total - cards.length })}</p>}

      {c.cards && (cards.length > TOP || filter !== 'all') && (
        <button
          type="button"
          className="btn dash-more"
          aria-expanded={listOpen || filter !== 'all'}
          onClick={() => {
            if (listOpen || filter !== 'all') {
              setListOpen(false);
              setFilter('all');
            } else setListOpen(true);
          }}
        >
          {listOpen || filter !== 'all' ? t('ui.today.showUrgent') : t('ui.today.seeAll', { count: cards.length })}
        </button>
      )}

      <p className="faint dash-foot">
        {t('ui.today.foot')}
        {c.statusAt && ` ${t('ui.today.footStatus', { time: new Date(c.statusAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) })}`}
      </p>
    </section>
  );

  const firstBlocked = blocked[0];
  const ceremonies = (
    <section className="dash-sec" aria-labelledby="cer-h">
      <h2 id="cer-h" className="section-title">{t('ui.today.ceremonies')}</h2>
      <div className="cer-row">
        {on?.preDaily !== false && (
        <div className="cer">
          <h3>{cycle?.preDailyLabel ? cycle.preDailyLabel.charAt(0).toUpperCase() + cycle.preDailyLabel.slice(1) : t('ui.today.preDaily')}</h3>
          <p className="small muted">{c.cards ? t('ui.today.agentsReady', { ready, total: cards.length }) : t('ui.today.buildingCards')}</p>
          <button type="button" className="btn" disabled={!c.cards} onClick={() => go({ name: 'call' })}>
            {c.startedAt && !c.callEnded ? tv('call.back') : tv('call.enter')}
          </button>
        </div>
        )}
        {on?.unblock !== false && (
        <div className="cer">
          <h3>{t('ui.today.unblock')}</h3>
          <p className="small muted">{blocked.length ? t('ui.today.withBlockers', { count: blocked.length }) : t('ui.today.noneBlocked')}</p>
          <button type="button" className="btn" disabled={!firstBlocked} onClick={() => firstBlocked && go({ name: 'deep', ref: firstBlocked.ref, back: 'today' })}>
            {firstBlocked ? t('ui.today.deepenIssue', { iid: firstBlocked.iid }) : t('ui.today.deepen')}
          </button>
        </div>
        )}
        {on?.qaHandoff !== false && (
        <div className="cer">
          <h3>{t('ui.today.qaHandoff')}</h3>
          <p className="small muted">{forQa.length ? t('ui.today.readyForQa', { count: forQa.length }) : t('ui.today.whenRelease')}</p>
          <select
            className="text-input"
            aria-label={t('ui.today.pickForQa')}
            value=""
            onChange={(e) => {
              const card = cards.find((x) => x.ref === e.target.value);
              if (card) go({ name: 'qa', ref: card.ref, card });
            }}
          >
            <option value="">{t('ui.today.choose')}</option>
            {[...forQa, ...cards.filter((x) => x.spec && !forQa.includes(x))].map((x) => (
              <option key={x.ref} value={x.ref}>#{x.iid} {x.title.slice(0, 50)}</option>
            ))}
          </select>
        </div>
        )}
        {on?.retro !== false && (
        <div className="cer">
          <h3>{t('ui.today.retro')}</h3>
          <p className="small muted">{retroToday ? t('ui.today.retroToday') : t('ui.today.retroWeekly')}</p>
          <button type="button" className="btn" onClick={() => go({ name: 'retro' })}>{t('ui.today.openRetro')}</button>
        </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="page">
      <div className="wrap dash">
        {header}
        {c.cardsError && <div className="error">{t('ui.today.cardsError', { error: c.cardsError })}</div>}
        <div className="dash-cols">
          <div className="dash-col">
            <div className="d-o1">{agora}</div>
            <div className="d-o2">{tiles}</div>
            <div className="d-o3">{needsBlock}</div>
            <div className="d-o6">{tempo}</div>
          </div>
          <div className="dash-col">
            <div className="d-o4">{activities}</div>
            <div className="d-o5">{ceremonies}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
