import { useEffect, useMemo, useRef, useState } from 'react';
import { isReadyForQa } from '../../../shared/cycles/stages';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api } from '../api';
import type { Ceremony } from '../ceremony';
import { useCycle } from '../cycleApi';
import { type AgoraAction, agoraPlan, greeting, needsYou, pendingQuestions, retroDue, sortByUrgency } from '../dashboard';
import { useIsPhone } from '../useIsPhone';
import { useWatcherAlerts } from '../watchersApi';
import { BellIcon } from './dashIcons';
import { HeaderModuleButtons } from './moduleSlots';
import { RadarButton } from './radarSlots';
import { SaudeButton } from './SaudeButton';
import { TempoHoje } from './TempoHoje';
import { ActivityRow, AgoraCard, NeedsList, Tiles } from './TodayParts';
import { VoiceToggle } from './VoiceToggle';
import { runningWorkspace, useWorkspaces } from '../workspaceApi';

type Filter = 'all' | 'blocked' | 'ask';

const TOP = 3;

export function Today({ ceremony: c, go, pendingActions, actions }: { ceremony: Ceremony; go: (s: Screen) => void; pendingActions: number; actions: ReleaseAction[] }) {
  const phone = useIsPhone();
  const testWorkspace = runningWorkspace(useWorkspaces())?.test === true;
  const cycle = useCycle();
  const stages = useMemo(() => cycle?.stages ?? [], [cycle]);
  const on = cycle?.ceremonies;
  const [filter, setFilter] = useState<Filter>('all');
  const [listOpen, setListOpen] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [retro, setRetro] = useState<{ day: number; time: string } | null>(null);
  const { alerts, dismiss } = useWatcherAlerts();
  const actsRef = useRef<HTMLElement>(null);

  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  const ready = cards.filter((card) => c.turns[card.ref]).length;
  const sorted = useMemo(() => sortByUrgency(cards, c.turns, c.answered, stages), [cards, c.turns, c.answered, stages]);
  const blocked = sorted.filter((card) => card.blockers.length);
  const asking = pendingQuestions(sorted, c.turns, c.answered);
  const forQa = cycle ? cards.filter((card) => isReadyForQa(cycle, card.stage, !!card.spec)) : [];
  const shown = filter === 'blocked' ? blocked : filter === 'ask' ? asking : sorted;
  const visible = listOpen || filter !== 'all' ? shown : shown.slice(0, TOP);
  const needs = needsYou({ cards, turns: c.turns, answered: c.answered, actions, alerts });
  const colors = useMemo(() => new Map(cards.map((card) => [`#${card.iid}`, c.colorOf(card.ref)])), [cards, c.colorOf]);

  const now = new Date();
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = date.charAt(0).toUpperCase() + date.slice(1);

  // Turns already prepared (or restored from disk) come from the cache; only the missing ones call an agent.
  useEffect(() => {
    if (c.cards) void c.prepareAll();
  }, [c.cards, c.prepareAll]);

  useEffect(() => {
    void api.getSettings().then((s) => setRetro({ day: s.schedule.retroDay, time: s.schedule.retroTime }), () => undefined);
  }, []);

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
          <h1>{greeting(now.getHours())}{cycle?.userName ? `, ${cycle.userName}` : ''}</h1>
        </div>
      </div>
      <div className="dash-top-actions">
        {testWorkspace && <span className="ws-test-chip" title="Nada sai da máquina daqui: sem escrita no GitLab, no Plan das specs nem no daily-report.">Workspace de testes</span>}
        {!phone && (
          <nav className="dash-nav" aria-label="Telas do app">
            <button type="button" className="btn" onClick={() => go({ name: 'history' })}>Histórico</button>
            <button type="button" className="btn" onClick={() => go({ name: 'settings' })}>Configurações</button>
            <button type="button" className="btn" onClick={() => go({ name: 'custo' })}>Custo</button>
            <RadarButton go={go} />
            <SaudeButton go={go} />
            <button type="button" className="btn" onClick={() => go({ name: 'auditoria' })}>Auditoria</button>
            <button type="button" className="btn" title="Atalho: F1" onClick={() => go({ name: 'help' })}>Ajuda</button>
            <HeaderModuleButtons />
          </nav>
        )}
        <VoiceToggle />
        <button type="button" className="btn icon-btn" aria-label="Execuções" title="Execuções em andamento" onClick={() => window.dispatchEvent(new CustomEvent('cerimonias:jobs-open'))}>
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
        <h2 id="acts-h" className="section-title">Atividades{c.cards ? ` · ${cards.length}` : ''}</h2>
        <button type="button" className="btn dash-refresh" disabled={c.loadingCards} onClick={() => void c.loadCards(true)}>
          {c.loadingCards ? <span className="spinner" aria-hidden="true" /> : null} Atualizar do GitLab
        </button>
      </div>

      {(listOpen || filter !== 'all') && (
        <div className="filters" role="group" aria-label="Filtro das atividades">
          {([
            ['all', `Todas · ${cards.length}`],
            ['blocked', `Com bloqueio · ${blocked.length}`],
            ['ask', `Com pergunta · ${asking.length}`],
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
      {c.cards && !visible.length && <p className="dash-calm">Nenhuma atividade neste filtro.</p>}

      {c.cards && (sorted.length > TOP || filter !== 'all') && (
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
          {listOpen || filter !== 'all' ? 'Mostrar só as mais urgentes' : `Ver todas as ${sorted.length}`}
        </button>
      )}

      <p className="faint dash-foot">
        Cada agente é montado a cada cerimônia a partir do cartão do GitLab, do spec e do playbook.
        {c.statusAt && ` Status conferido às ${new Date(c.statusAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`}
      </p>
    </section>
  );

  const firstBlocked = blocked[0];
  const ceremonies = (
    <section className="dash-sec" aria-labelledby="cer-h">
      <h2 id="cer-h" className="section-title">Cerimônias</h2>
      <div className="cer-row">
        {on?.preDaily !== false && (
        <div className="cer">
          <h3>{cycle?.preDailyLabel ? cycle.preDailyLabel.charAt(0).toUpperCase() + cycle.preDailyLabel.slice(1) : 'Pré-daily'}</h3>
          <p className="small muted">{c.cards ? `${ready} de ${cards.length} agentes prontos` : 'Montando cartões…'}</p>
          <button type="button" className="btn" disabled={!c.cards} onClick={() => go({ name: 'call' })}>
            {c.startedAt && !c.callEnded ? 'Voltar à call' : 'Entrar na call'}
          </button>
        </div>
        )}
        {on?.unblock !== false && (
        <div className="cer">
          <h3>Desbloqueio</h3>
          <p className="small muted">{blocked.length ? `${blocked.length} com bloqueio` : 'Nenhuma bloqueada'}</p>
          <button type="button" className="btn" disabled={!firstBlocked} onClick={() => firstBlocked && go({ name: 'deep', ref: firstBlocked.ref, back: 'today' })}>
            {firstBlocked ? `Aprofundar #${firstBlocked.iid}` : 'Aprofundar'}
          </button>
        </div>
        )}
        {on?.qaHandoff !== false && (
        <div className="cer">
          <h3>Passagem ao QA</h3>
          <p className="small muted">{forQa.length ? `${forQa.length} pronta(s) para o QA` : 'Quando subir release'}</p>
          <select
            className="text-input"
            aria-label="Escolher atividade para o QA"
            value=""
            onChange={(e) => {
              const card = cards.find((x) => x.ref === e.target.value);
              if (card) go({ name: 'qa', ref: card.ref, card });
            }}
          >
            <option value="">Escolher…</option>
            {[...forQa, ...cards.filter((x) => x.spec && !forQa.includes(x))].map((x) => (
              <option key={x.ref} value={x.ref}>#{x.iid} {x.title.slice(0, 50)}</option>
            ))}
          </select>
        </div>
        )}
        {on?.retro !== false && (
        <div className="cer">
          <h3>Retro</h3>
          <p className="small muted">{retroToday ? 'É hoje, semanal' : 'Semanal, últimos 7 dias'}</p>
          <button type="button" className="btn" onClick={() => go({ name: 'retro' })}>Abrir a retro</button>
        </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="page">
      <div className="wrap dash">
        {header}
        {c.cardsError && <div className="error">Não consegui montar os cartões: {c.cardsError}</div>}
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
