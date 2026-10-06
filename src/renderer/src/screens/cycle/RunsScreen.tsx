import { useMemo, useState } from 'react';
import { RUN_FILTERS, type RunFilter, currentAgent, filterCounts, listRuns, needsPerson, stageLabelOf } from '../../../../shared/runs/view';
import type { Run } from '../../../../shared/runs';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { BackIcon } from '../icons';
import { RunBadge } from './RunBadge';
import { agentName, squadName } from './names';
import { patchRun, runsApi, useRunConfig, useRuns } from './runsApi';
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

/** Starts the run of a release: a version, and the stable tag a patch is cut from. Only a workspace that has the release flow offers it. */
function StartRelease({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [version, setVersion] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await runsApi.startRelease(version.trim(), from.trim() || undefined);
      patchRun(run);
      go({ name: 'run', id: run.id, from: 'runs' });
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };
  return (
    <section className="panel cy-release-start" aria-label={t('ui.runs.release.title')}>
      <h2 className="cy-release-title">{t('ui.runs.release.title')}</h2>
      <p className="small muted">{t('ui.runs.release.hint')}</p>
      <div className="row cy-release-fields">
        <label className="cy-field">
          <span className="small muted">{t('ui.runs.release.version')}</span>
          <input className="text-input mono" value={version} spellCheck={false} maxLength={40} placeholder="0.6.0" onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label className="cy-field">
          <span className="small muted">{t('ui.runs.release.from')}</span>
          <input className="text-input mono" value={from} spellCheck={false} maxLength={40} placeholder="v0.5.0" /* i18n-ignore: an example tag */ onChange={(e) => setFrom(e.target.value)} />
        </label>
        <button type="button" className="btn btn-dark" disabled={busy || !version.trim()} onClick={() => void start()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.runs.release.start')}
        </button>
      </div>
      {error && <span className="error cy-inline-error" role="alert">{error}</span>}
    </section>
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
        {/* A paired browser is offered the field too: the server refuses the start when its external effects are off, and the error says so here. */}
        {config?.devCycle.flows?.release && <StartRelease go={go} />}
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
