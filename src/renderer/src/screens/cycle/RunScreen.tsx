import { useMemo, useState } from 'react';
import { squadView } from '../../../../shared/config/squads';
import { type Run, flowOf, flowOfRun, snapshotOf } from '../../../../shared/runs';
import { currentStage, followsOlderFlow } from '../../../../shared/runs/view';
import type { ReleaseAction } from '../../../../shared/types';
import type { Screen } from '../../App';
import { AgentActivity } from '../../AgentActivity';
import { errorText } from '../../api';
import type { Ceremony } from '../../ceremony';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { BackIcon } from '../icons';
import { ReviewRounds } from './ReviewRounds';
import { RunActions } from './RunActions';
import { RunBadge } from './RunBadge';
import { StageTimeline } from './StageTimeline';
import { squadName } from './names';
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

interface Props {
  id: string;
  go: (s: Screen) => void;
  ceremony: Ceremony;
  actions: ReleaseAction[];
  back?: Screen;
  tab?: 'cycle' | 'forum';
}

function FlowNote({ run, current, web }: { run: Run; current: string; web: boolean }) {
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
      <button type="button" className="btn cy-mini" disabled={busy || web} onClick={move}>{t('ui.cycle.flow.migrate')}</button>
      {web && <span className="faint small">{t('ui.cycle.desktopOnly')}</span>}
      {error && <span className="error cy-inline-error" role="alert">{error}</span>}
    </div>
  );
}

/** One run: who it waits for and what to do about it, the stages as a timeline, the live work of the agent, and the review rounds. */
export function RunScreen({ id, go, ceremony, actions, back = { name: 'today' } }: Props) {
  const t = useT();
  const run = useRun(id);
  const config = useRunConfig();
  const web = isWeb();
  // The flow the run keeps (its own copy), with the agents as they are now; and the hash of the cycle's flow today.
  const flow = useMemo(() => (run && config ? flowOfRun(run, config) : (run?.flow?.stages ?? [])), [run, config]);
  const currentHash = useMemo(() => (run && config ? snapshotOf(flowOf(squadView(config, run.squad))).hash : ''), [run, config]);

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
  const startedAt = record?.startedAt ? Date.parse(record.startedAt) : undefined;
  const stage = currentStage(run, flow);

  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go(back)}><BackIcon /></button>
            <h1 className="cy-title">
              {run.issue.url ? <a href={run.issue.url} target="_blank" rel="noreferrer" className="mono cy-ref">{run.issue.ref}</a> : <span className="mono cy-ref">{run.issue.ref}</span>} {run.issue.title}
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
        <FlowNote run={run} current={currentHash} web={web} />
        <div className="cy-cols">
          <div className="cy-main">
            <RunActions run={run} flow={flow} config={config} web={web} card={card} actions={actions} go={go} />
            {run.status === 'working' && stage && <AgentActivity jobId={`run:${run.id}`} since={startedAt} />}
            <StageTimeline run={run} flow={flow} config={config} web={web} go={go} />
            <ReviewRounds run={run} config={config} />
          </div>
        </div>
      </div>
    </div>
  );
}
