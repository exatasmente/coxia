import { useMemo, useState, useSyncExternalStore } from 'react';
import { effectiveTeam, runKindFlowOf, squadView } from '../../../../shared/config/squads';
import { runThreadId } from '../../../../shared/forum';
import { unreadOf } from '../../../../shared/forumView';
import { type Run, flowOf, flowOfRun, snapshotOf } from '../../../../shared/runs';
import { currentStage, followsOlderFlow } from '../../../../shared/runs/view';
import type { ReleaseAction } from '../../../../shared/types';
import type { Screen } from '../../App';
import { AgentActivity } from '../../AgentActivity';
import { callGroups } from '../../activity';
import { errorText } from '../../api';
import type { Ceremony } from '../../ceremony';
import { useT } from '../../i18n';
import { useActivity } from '../../useActivity';
import { BackIcon } from '../icons';
import { EvidenceBlock, useEvidenceList } from './Evidence';
import { evidenceKey } from './recording';
import { useSeen, useThreads } from './forumApi';
import { ReviewRounds } from './ReviewRounds';
import { CommandsSection } from './CommandsSection';
import { AutonomyNote } from './AutonomyNote';
import { CommandApproval } from './CommandApproval';
import { RunActions } from './RunActions';
import { RunHandoff } from './RunHandoff';
import { RunBadge } from './RunBadge';
import { StageTimeline } from './StageTimeline';
import { Thread } from './Thread';
import { agentName, squadName } from './names';
import { patchRun, runsApi, useRun, useRunConfig } from './runsApi';
import './cycle.css';

const ROUTED_KEY = {
  repo: 'ui.cycle.routed.repo',
  label: 'ui.cycle.routed.label',
  path: 'ui.cycle.routed.path',
  unclaimed: 'ui.cycle.routed.unclaimed',
  agent: 'ui.cycle.routed.agent',
  person: 'ui.cycle.routed.person',
  request: 'ui.cycle.routed.request',
} as const;

const NARROW = '(max-width: 900px)'; // i18n-ignore: media query

/** The screen is too narrow for the stages and the thread side by side: they become two tabs. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

interface Props {
  id: string;
  go: (s: Screen) => void;
  ceremony: Ceremony;
  actions: ReleaseAction[];
  back?: Screen;
  tab?: 'cycle' | 'forum';
}

function FlowNote({ run, current }: { run: Run; current: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!followsOlderFlow(run, current)) return null;
  const move = () => {
    setBusy(true);
    setError(null);
    void runsApi.migrateFlow(run.id).then(
      (r) => {
        patchRun(r);
        setBusy(false);
      },
      (e) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  return (
    <div className="cy-flow-note" role="note">
      <span className="small">{t('ui.cycle.flow.older')}</span>
      <button type="button" className="btn cy-mini" disabled={busy} onClick={move}>{t('ui.cycle.flow.migrate')}</button>
      {error && <span className="error cy-inline-error" role="alert">{error}</span>}
    </div>
  );
}

/** One run: who it waits for and what to do about it, the stages as a timeline, the live work of the agent, and the review rounds. */
export function RunScreen({ id, go, ceremony, actions, back = { name: 'today' }, tab: initialTab = 'cycle' }: Props) {
  const t = useT();
  const narrow = useNarrow();
  const [tab, setTab] = useState<'cycle' | 'forum'>(initialTab);
  const [sendBackAsk, setSendBackAsk] = useState(0);
  const threads = useThreads();
  const seen = useSeen();
  const run = useRun(id);
  const config = useRunConfig();
  // The flow the run keeps (its own copy), with the agents as they are now; and the hash of the cycle's flow today.
  const flow = useMemo(() => (run && config ? flowOfRun(run, config) : (run?.flow?.stages ?? [])), [run, config]);
  const currentHash = useMemo(() => {
    if (!run || !config) return '';
    // A release run and a documentation run follow the flow of their own kind, not the flow of the issues.
    const own = runKindFlowOf(config, run);
    return snapshotOf(own ? flowOf({ agents: { team: effectiveTeam(config) }, devCycle: { stages: own } }, own) : flowOf(squadView(config, run.squad))).hash;
  }, [run, config]);

  const activity = useActivity(run ? `run:${run.id}` : undefined);
  // The evidence the run kept, for the stage list and for what a scenario cites.
  const evidence = useEvidenceList(run?.id ?? '', evidenceKey(run));
  // A call a message made to an agent of this run's thread: the panel appears for it whatever the run's own status, under the called agent's name.
  const call = useMemo(() => (run ? callGroups(activity).find((g) => g.thread === runThreadId(run.id)) ?? null : null), [activity, run]);

  const header = (title: string) => (
    <header className="row spread cy-top">
      <div className="row cy-top-main">
        <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go(back)}><BackIcon /></button>
        <h1 className="cy-title">{title}</h1>
      </div>
    </header>
  );

  if (run === undefined) return <div className="page"><div className="wrap cy-wrap">{header(t('ui.cycle.loading'))}<span className="spinner" aria-hidden="true" /></div></div>;
  if (run === null) return <div className="page"><div className="wrap cy-wrap">{header(t('ui.cycle.notFound.title'))}<p className="dash-calm">{t('ui.cycle.notFound.text')}</p></div></div>;

  const card = ceremony.cards?.cards.find((c) => c.ref === run.issue.ref);
  const squad = squadName(config?.squads, run.squad);
  const pr = run.comments.pr?.url ?? null;
  const record = run.stages.find((s) => s.stage === run.stage);
  const summary = threads?.find((s) => s.id === runThreadId(run.id));
  const unread = summary ? unreadOf(summary, seen) : 0;
  const startedAt = record?.startedAt ? Date.parse(record.startedAt) : undefined;
  const stage = currentStage(run, flow);

  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go(back)}><BackIcon /></button>
            <h1 className="cy-title">
              {(run.issue.url ?? run.subject?.tracking?.url) ? <a href={(run.issue.url ?? run.subject?.tracking?.url) as string} target="_blank" rel="noreferrer" className="mono cy-ref">{run.issue.ref}</a> : <span className="mono cy-ref">{run.issue.ref}</span>} {run.issue.title}
            </h1>
          </div>
          <RunBadge run={run} withStage />
        </header>
        <dl className="cy-facts" aria-label={t('ui.cycle.facts')}>
          <div><dt>{t('ui.cycle.facts.branch')}</dt><dd className="mono">{run.branch}</dd></div>
          {squad && (
            <div>
              <dt>{t('ui.cycle.facts.squad')}</dt>
              <dd>{squad}{run.routedBy ? <span className="faint"> · {t(ROUTED_KEY[run.routedBy])}</span> : null}</dd>
            </div>
          )}
          {pr && <div><dt>{t('ui.cycle.facts.pr')}</dt><dd><a href={pr} target="_blank" rel="noreferrer">{run.comments.pr?.title || t('ui.cycle.facts.prOpen')}</a></dd></div>}
          {run.links?.length ? (
            <div>
              <dt>{t('ui.cycle.facts.links')}</dt>
              <dd>{run.links.map((l) => `${l.issue ?? l.title} (${squadName(config?.squads, l.squad)})`).join(' · ')}</dd>
            </div>
          ) : null}
        </dl>
        <FlowNote run={run} current={currentHash} />
        <RunHandoff run={run} team={config?.agents.team} />
        {narrow && (
          <div className="cy-tabs" role="tablist" aria-label={t('ui.cycle.tabs')}>
            <button type="button" role="tab" id="cy-tab-cycle" aria-selected={tab === 'cycle'} aria-controls="cy-panel-cycle" className={`cy-tab ${tab === 'cycle' ? 'on' : ''}`} onClick={() => setTab('cycle')}>{t('ui.cycle.tab.cycle')}</button>
            <button type="button" role="tab" id="cy-tab-forum" aria-selected={tab === 'forum'} aria-controls="cy-panel-forum" className={`cy-tab ${tab === 'forum' ? 'on' : ''}`} onClick={() => setTab('forum')}>
              {t('ui.cycle.tab.forum')}
              {unread > 0 && tab !== 'forum' && <span className="badge cy-unread" aria-label={t('ui.forum.list.unread', { count: unread })}>{unread}</span>}
            </button>
          </div>
        )}
        <div className="cy-cols">
          {(!narrow || tab === 'cycle') && (
            <div className="cy-main" id="cy-panel-cycle" role={narrow ? 'tabpanel' : undefined} aria-labelledby={narrow ? 'cy-tab-cycle' : undefined}>
              <CommandApproval run={run} team={config?.agents.team} />
              <RunActions run={run} flow={flow} config={config} card={card} actions={actions} go={go} sendBackAsk={sendBackAsk} />
              {call || (run.status === 'working' && stage) ? (
                <AgentActivity jobId={`run:${run.id}`} since={call ? call.since : startedAt} agent={call ? agentName(config?.agents.team, call.agent) : undefined} />
              ) : null}
              <StageTimeline run={run} flow={flow} config={config} go={go} />
              <EvidenceBlock runId={run.id} stage={run.stage} list={evidence.list} onRemoved={evidence.remove} />
              <CommandsSection thread={runThreadId(run.id)} team={config?.agents.team} />
              <ReviewRounds run={run} config={config} evidence={evidence.list} />
            </div>
          )}
          {(!narrow || tab === 'forum') && (
            <div className="cy-side" id="cy-panel-forum" role={narrow ? 'tabpanel' : undefined} aria-labelledby={narrow ? 'cy-tab-forum' : undefined}>
              <Thread
                handoffAbove
                thread={runThreadId(run.id)}
                run={run}
                team={config?.agents.team}
                title={t('ui.cycle.forum')}
                onSendBack={() => {
                  setTab('cycle');
                  setSendBackAsk((n) => n + 1);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
