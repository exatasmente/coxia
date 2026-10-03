import { useState } from 'react';
import { isFlowCycle } from '../../../../shared/runs/flow';
import { isActive, reposToChoose, runOfCard, stageLabelOf } from '../../../../shared/runs/view';
import type { Card } from '../../../../shared/types';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { useCycle } from '../../cycleApi';
import { useT } from '../../i18n';
import { RunBadge, useStatusText } from './RunBadge';
import { squadName } from './names';
import { patchRun, runsApi, useRunConfig, useRuns } from './runsApi';

// What a card of the agent cycle shows of its run: the badge on its row, the facts in its details, and the button that starts or opens the cycle.

function useCardRun(ref: string) {
  const runs = useRuns();
  return runs ? runOfCard(runs, ref) : null;
}

/** The run's state on the card's row. */
export function CardRunBadge({ cardRef }: { cardRef: string }) {
  const run = useCardRun(cardRef);
  return run ? <RunBadge run={run} /> : null;
}

/** The facts of the run in the card's details: stage, what it waits for, the squad. */
export function CardRunFacts({ cardRef }: { cardRef: string }) {
  const t = useT();
  const run = useCardRun(cardRef);
  const config = useRunConfig();
  const statusText = useStatusText();
  if (!run) return null;
  const blocker = run.status === 'question' ? run.question?.text : run.status === 'failed' ? (run.error?.detail ?? null) : null;
  const squad = squadName(config?.squads, run.squad);
  return (
    <>
      <dt>{t('ui.cycle.card.run')}</dt>
      <dd>{t('ui.cycle.card.runValue', { stage: stageLabelOf(run), status: statusText(run.status) })}</dd>
      {blocker && (
        <>
          <dt>{t(run.status === 'failed' ? 'ui.cycle.card.failedLabel' : 'ui.cycle.card.questionLabel')}</dt>
          <dd>{blocker}</dd>
        </>
      )}
      {squad && (
        <>
          <dt>{t('ui.cycle.card.squad')}</dt>
          <dd>{squad}</dd>
        </>
      )}
    </>
  );
}

/** "Open cycle" for a card that has a run, "Start cycle" for one that has none. */
export function CardRunActions({ card, go }: { card: Card; go: (s: Screen) => void }) {
  const t = useT();
  const run = useCardRun(card.ref);
  const cycle = useCycle();
  const config = useRunConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState('');
  if (!cycle || !isFlowCycle(cycle.stages)) return null;
  const open = run && (
    <button type="button" className="btn" onClick={() => go({ name: 'run', id: run.id })}>
      {t('ui.cycle.card.open')}
    </button>
  );
  // One run per issue at a time: a new one can start only when the last one ended.
  if (run && isActive(run)) return <>{open}</>;
  const choices = config ? reposToChoose(config.projects.repos, config.projects.issues.project) : null;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await runsApi.start(card.ref, choices ? repo : undefined);
      patchRun(started);
      go({ name: 'run', id: started.id });
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };
  return (
    <>
      {open}
      {choices && (
        <select className="text-input cy-repo" aria-label={t('ui.cycle.card.repoLabel')} value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">{t('ui.cycle.card.repoPick')}</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>{r.id}</option>
          ))}
        </select>
      )}
      <button type="button" className="btn btn-dark" disabled={busy || (!!choices && !repo)} onClick={() => void start()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.cycle.card.start')}
      </button>
      {error && <span className="error cy-inline-error" role="alert">{error}</span>}
    </>
  );
}

