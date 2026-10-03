import { useMemo, useState } from 'react';
import type { Run } from '../../../../shared/runs';
import { isActive, needsPerson, stageLabelOf } from '../../../../shared/runs/view';
import type { Screen } from '../../App';
import { useT } from '../../i18n';
import { useStatusText } from './RunBadge';
import { useRuns } from './runsApi';
import './cycle.css';

const SHOWN = 4;

/** What a run waits for the person to do, most urgent first: stuck runs before those waiting for a decision. */
export function waitingRuns(runs: readonly Run[]): Run[] {
  const stuck = (r: Run) => (r.status === 'failed' || r.status === 'question' ? 0 : 1);
  return runs.filter((r) => isActive(r) && needsPerson(r)).sort((a, b) => stuck(a) - stuck(b) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Today's list of the runs that wait for the person, with the way to all of them. Nothing for a workspace that has no run. */
export function RunNeeds({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const runs = useRuns();
  const statusText = useStatusText();
  const [all, setAll] = useState(false);
  const waiting = useMemo(() => waitingRuns(runs ?? []), [runs]);
  if (!runs?.length) return null;
  const shown = all ? waiting : waiting.slice(0, SHOWN);
  return (
    <section className="dash-sec" aria-labelledby="cy-needs-h">
      <div className="row spread dash-sec-head">
        <h2 id="cy-needs-h" className="section-title">{waiting.length ? t('ui.cycle.needs.titleCount', { count: waiting.length }) : t('ui.cycle.needs.title')}</h2>
        <button type="button" className="btn dash-refresh" onClick={() => go({ name: 'runs' })}>{t('ui.cycle.needs.all', { count: runs.length })}</button>
      </div>
      {!waiting.length && <p className="dash-calm">{t('ui.cycle.needs.empty')}</p>}
      {shown.length > 0 && (
        <ul className="needs">
          {shown.map((r) => (
            <li key={r.id} className={`need ${r.status === 'failed' || r.status === 'question' ? 'need-stop' : 'need-warn'}`}>
              <button type="button" className="need-main" aria-label={t('ui.cycle.needs.ariaOpen', { ref: r.issue.ref, title: r.issue.title })} onClick={() => go({ name: 'run', id: r.id })}>
                <span className="need-text">
                  <span className="need-title">{t('ui.cycle.needs.item', { ref: r.issue.ref, title: r.issue.title })}</span>
                  <span className="need-detail">{t('ui.cycle.card.runValue', { stage: stageLabelOf(r), status: statusText(r.status) })}</span>
                </span>
                <span className="need-cta" aria-hidden="true">{t('ui.cycle.needs.open')} ›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {waiting.length > SHOWN && (
        <button type="button" className="btn dash-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? t('ui.cycle.needs.showLess') : t('ui.cycle.needs.showMore', { count: waiting.length - SHOWN })}
        </button>
      )}
    </section>
  );
}
