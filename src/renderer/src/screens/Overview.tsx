import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentDef } from '../../../shared/config/types';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import type { Ceremony } from '../ceremony';
import { useCycle } from '../cycleApi';
import { HOME, type OverviewSection, blockedCards, qaCandidates } from '../home';
import { needsYou, pendingQuestions } from '../dashboard';
import { useWatcherAlerts } from '../watchersApi';
import { BackIcon } from './icons';
import { ChatHeader } from './persona/ChatHeader';
import { RunNeeds } from './cycle/RunNeeds';
import { SquadPicker } from './cycle/SquadPicker';
import { useRuns } from './cycle/runsApi';
import { useAgora } from './useAgora';
import { TempoHoje } from './TempoHoje';
import { ActivityRow, AgoraCard, NeedsList, Tiles } from './TodayParts';
import { intlLocale, useT, useTv } from '../i18n';

type Filter = 'all' | 'blocked' | 'ask';

const TOP = 3;

export function Overview({ ceremony: c, go, pendingActions, actions, section, persona }: { ceremony: Ceremony; go: (s: Screen) => void; pendingActions: number; actions: ReleaseAction[]; section?: OverviewSection; persona: AgentDef | null }) {
  const t = useT();
  const tv = useTv();
  const cycle = useCycle();
  const on = cycle?.ceremonies;
  // The cards come from the card source tool when there is one, else from the host.
  const cardsFrom = cycle?.cardsFrom ?? t('ui.today.row.hostButton');
  const [filter, setFilter] = useState<Filter>('all');
  const [listOpen, setListOpen] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const { alerts, dismiss } = useWatcherAlerts();
  const actsRef = useRef<HTMLElement>(null);
  const needsRef = useRef<HTMLDivElement>(null);

  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  // `cards` is already in the agenda's order (blocked, priority, last update): Today lists them as the call will, without sorting again.
  // A run stopped on a question or a failure blocks its card as much as a blocker the tracker shows.
  const runs = useRuns();
  const blocked = blockedCards(cards, runs);
  const asking = pendingQuestions(cards, c.turns, c.answered);
  const { ready: forQa, all: qaChoices } = qaCandidates(cards, cycle);
  const shown = filter === 'blocked' ? blocked : filter === 'ask' ? asking : cards;
  const visible = listOpen || filter !== 'all' ? shown : shown.slice(0, TOP);
  const needs = needsYou({ cards, turns: c.turns, answered: c.answered, actions, alerts });
  const colors = useMemo(() => new Map(cards.map((card) => [`#${card.iid}`, c.colorOf(card.ref)])), [cards, c.colorOf]);

  const now = new Date();
  const date = now.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  const { plan, onAgora, ready, retroToday } = useAgora(c, go);

  const showFilter = (f: Filter) => {
    setFilter(f);
    setListOpen(true);
    requestAnimationFrame(() => actsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };

  // The strip of the chat opens the Overview at what it counted: the filter of blocked or asking, or the list of what needs the person. Once, when the screen opens.
  useEffect(() => {
    if (section === 'blocked') showFilter('blocked');
    else if (section === 'asking') showFilter('ask');
    else if (section === 'needs') requestAnimationFrame(() => needsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showFilter only sets state and scrolls
  }, [section]);

  // With a persona the Overview is a screen to come back from: a back button, its name and the date (the greeting, the update badge, the voice switch, the bell and the
  // navigation are the chat's). Without one it is where "Not now" left the person, so it keeps the header with the menu, and offers the wizard again.
  const header = persona ? (
    <header className="dash-top">
      <div className="dash-hello">
        <button type="button" className="btn icon-btn" aria-label={t('ui.nav.backToday')} onClick={() => go(HOME)}><BackIcon /></button>
        <div className="dash-hello-text">
          <div className="faint">{today}</div>
          <h1>{t('ui.overview.title')}</h1>
        </div>
      </div>
    </header>
  ) : (
    <ChatHeader persona={null} title={t('ui.overview.title')} go={go} ceremony={c} invite />
  );

  // A cycle with no daily preparation has no call to start: the card and the filters that lead to it are left out.
  const agora = on?.preDaily === false ? null : <AgoraCard plan={plan} onAction={onAgora} />;
  const tiles = <Tiles blocked={blocked.length} asking={asking.length} actions={pendingActions} onBlocked={() => showFilter('blocked')} onAsking={() => showFilter('ask')} onActions={() => go({ name: 'actions' })} />;
  const needsBlock = (
    <>
      <NeedsList items={needs} go={go} dismiss={dismiss} />
      <RunNeeds go={go} />
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
          {c.loadingCards ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.today.refresh', { vcsName: cardsFrom })}
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
      {/* A day with no card at all is not an error: the invitation to open one sits below the list, where the board of this workspace lives. */}
      {c.cards && !cards.length && (
        <p className="dash-calm">
          {t('ui.today.board.empty')}{' '}
          <button type="button" className="btn" onClick={() => go({ name: 'board' })}>{t('ui.today.board.open')}</button>
        </p>
      )}
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
        {t(cycle?.specs === false ? 'ui.today.footPlain' : 'ui.today.foot', { vcsName: cardsFrom })}
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
          <SquadPicker value={c.squad} onChange={(squad) => void c.setSquad(squad)} disabled={!!c.startedAt && !c.callEnded} />
          <button type="button" className="btn" disabled={!c.cards} onClick={() => go({ name: 'call' })}>
            {c.startedAt && !c.callEnded ? tv('call.back') : tv('call.enter')}
          </button>
        </div>
        )}
        {on?.unblock !== false && (
        <div className="cer">
          <h3>{t('ui.today.unblock')}</h3>
          <p className="small muted">{blocked.length ? t('ui.today.withBlockers', { count: blocked.length }) : t('ui.today.noneBlocked')}</p>
          <button type="button" className="btn" disabled={!firstBlocked} onClick={() => firstBlocked && go({ name: 'deep', ref: firstBlocked.ref, back: 'chat' })}>
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
            {qaChoices.map((x) => (
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
            <div className="d-o3" ref={needsRef}>{needsBlock}</div>
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
