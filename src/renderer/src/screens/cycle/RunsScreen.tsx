import { useMemo, useState } from 'react';
import { RUN_FILTERS, type RunFilter, currentAgent, filterCounts, listRuns, needsPerson, stageLabelOf } from '../../../../shared/runs/view';
import type { Run } from '../../../../shared/runs';
import type { Screen } from '../../App';
import { intlLocale, useT } from '../../i18n';
import { BackIcon } from '../icons';
import { RunBadge } from './RunBadge';
import { agentName, squadName } from './names';
import { useRunConfig, useRuns } from './runsApi';
import './cycle.css';

const FILTER_KEY: Record<RunFilter, string> = {
  all: 'ui.runs.filter.all',
  you: 'ui.runs.filter.you',
  working: 'ui.runs.filter.working',
  waiting: 'ui.runs.filter.waiting',
  failed: 'ui.runs.filter.failed',
  finished: 'ui.runs.filter.finished',
};

const NO_SQUAD = '-';

function ago(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Row({ run, go }: { run: Run; go: (s: Screen) => void }) {
  const t = useT();
  const config = useRunConfig();
  const agent = currentAgent(run);
  const squad = squadName(config?.squads, run.squad);
  const note = run.status === 'question' ? run.question?.text : run.status === 'failed' ? run.error?.detail : null;
  return (
    <li>
      <button type="button" className={`cy-run-row ${needsPerson(run) ? 'you' : ''}`} onClick={() => go({ name: 'run', id: run.id, from: 'runs' })}>
        <span className="cy-run-main">
          <span className="cy-run-title"><span className="mono">{run.issue.ref}</span> {run.issue.title}</span>
          <span className="faint small">
            {[t('ui.runs.row.stage', { stage: stageLabelOf(run) }), agent ? agentName(config?.agents.team, agent) : null, squad || null, ago(run.updatedAt)].filter(Boolean).join(' · ')}
          </span>
          {note && <span className="small cy-run-note">{note}</span>}
        </span>
        <RunBadge run={run} />
      </button>
    </li>
  );
}

/** Every run of the workspace, filtered by what it waits for and by squad: what waits for the person first. */
export function RunsScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const runs = useRuns();
  const config = useRunConfig();
  const [filter, setFilter] = useState<RunFilter>('all');
  const [squad, setSquad] = useState<string | null>(null);
  const squads = config?.squads ?? [];
  const counts = useMemo(() => filterCounts(runs ?? []), [runs]);
  const shown = useMemo(() => listRuns(runs ?? [], filter, squad === null ? null : squad === NO_SQUAD ? '' : squad), [runs, filter, squad]);
  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 className="cy-title">{t('ui.runs.title')}</h1>
          </div>
          <button type="button" className="btn" onClick={() => go({ name: 'forum' })}>{t('ui.runs.forum')}</button>
        </header>
        <div className="filters cy-filters" role="group" aria-label={t('ui.runs.filter.label')}>
          {RUN_FILTERS.map((f) => (
            <button key={f} type="button" className={`filter ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(FILTER_KEY[f], { count: counts[f] })}
            </button>
          ))}
        </div>
        {squads.length > 0 && (
          <label className="cy-field cy-squad-filter">
            <span className="small muted">{t('ui.runs.squad')}</span>
            <select className="text-input" value={squad ?? ''} onChange={(e) => setSquad(e.target.value || null)}>
              <option value="">{t('ui.runs.squad.all')}</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{squadName(squads, s.id)}</option>)}
              <option value={NO_SQUAD}>{t('ui.runs.squad.none')}</option>
            </select>
          </label>
        )}
        {!runs && <span className="spinner" aria-label={t('ui.runs.loading')} />}
        {runs && !shown.length && <p className="dash-calm">{t(runs.length ? 'ui.runs.emptyFilter' : 'ui.runs.empty')}</p>}
        <ul className="cy-run-list">{shown.map((r) => <Row key={r.id} run={r} go={go} />)}</ul>
      </div>
    </div>
  );
}
