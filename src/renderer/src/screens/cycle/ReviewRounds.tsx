import type { WorkspaceConfig } from '../../../../shared/config/types';
import { type Run, whereOf } from '../../../../shared/runs';
import { type FindingThread, reviewRounds } from '../../../../shared/runs/view';
import { intlLocale, useT } from '../../i18n';
import { agentName } from './names';

const THREAD_KEY: Record<FindingThread, string> = {
  open: 'ui.cycle.review.threadOpen',
  still: 'ui.cycle.review.threadStill',
  fixed: 'ui.cycle.review.threadFixed',
};

const THREAD_HINT: Record<FindingThread, string> = {
  open: 'ui.cycle.review.threadOpenHint',
  still: 'ui.cycle.review.threadStillHint',
  fixed: 'ui.cycle.review.threadFixedHint',
};

const RESULT_KEY = { pass: 'ui.cycle.qa.pass', fail: 'ui.cycle.qa.fail', 'not-run': 'ui.cycle.qa.notRun' } as const;

function stamp(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Each review pass of the run: its verdict and what the reviewer found, with where each finding stands on the pull request (its thread). */
export function ReviewRounds({ run, config }: { run: Run; config: WorkspaceConfig | null }) {
  const t = useT();
  const rounds = reviewRounds(run);
  if (!rounds.length && !run.qa.length) return null;
  const team = config?.agents.team;
  return (
    <section className="panel cy-review" aria-labelledby="cy-review-h">
      <h2 id="cy-review-h" className="cy-h">{t('ui.cycle.review.title')}</h2>
      {rounds.map(({ round, findings }) => (
        <article key={round.round} className="cy-round">
          <div className="row cy-round-head">
            <h3 className="cy-stage-name">{t('ui.cycle.review.round', { round: round.round })}</h3>
            <span className={`badge ${round.verdict === 'approved' ? 'cy-tone-done' : 'cy-tone-person'}`}>{t(round.verdict === 'approved' ? 'ui.cycle.review.approved' : 'ui.cycle.review.changes')}</span>
            <span className="faint small">{agentName(team, round.by)} · {stamp(round.at)}</span>
          </div>
          {round.summary && <p className="small">{round.summary}</p>}
          {findings.length === 0 && <p className="small faint">{t('ui.cycle.review.noFindings')}</p>}
          <ul className="cy-findings">
            {findings.map(({ finding, thread }, i) => (
              <li key={i} className="cy-finding">
                <div className="row cy-finding-head">
                  <span className={`badge ${finding.severity === 'blocking' ? 'cy-tone-blocked' : 'cy-tone-quiet'}`}>{t(finding.severity === 'blocking' ? 'ui.cycle.review.blocking' : 'ui.cycle.review.suggestion')}</span>
                  <code className="mono small cy-where">{whereOf(finding)}</code>
                  <span className={`badge cy-thread cy-thread-${thread}`} title={t(THREAD_HINT[thread])}>{t(THREAD_KEY[thread])}</span>
                </div>
                <p className="small cy-finding-body">{finding.body}</p>
                {finding.suggestion && <pre className="rich-pre small cy-suggestion">{finding.suggestion}</pre>}
              </li>
            ))}
          </ul>
        </article>
      ))}
      {run.qa.map((q, i) => (
        <article key={`qa-${i}`} className="cy-round">
          <div className="row cy-round-head">
            <h3 className="cy-stage-name">{t('ui.cycle.qa.title')}</h3>
            <span className="faint small">{agentName(team, q.by)} · {stamp(q.at)}</span>
          </div>
          {q.summary && <p className="small">{q.summary}</p>}
          <ul className="cy-findings">
            {q.scenarios.map((s, j) => (
              <li key={j} className="cy-finding">
                <div className="row cy-finding-head">
                  <span className={`badge ${s.result === 'pass' ? 'cy-tone-done' : s.result === 'fail' ? 'cy-tone-blocked' : 'cy-tone-quiet'}`}>{t(RESULT_KEY[s.result])}</span>
                  <span className="small"><strong>{s.name}</strong></span>
                </div>
                {s.detail && <p className="small cy-finding-body">{s.detail}</p>}
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p className="faint small">{t('ui.cycle.review.derived')}</p>
    </section>
  );
}
