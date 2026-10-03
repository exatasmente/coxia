import type { ReleaseAction } from '../../../../shared/types';
import { type FindingThread } from '../../../../shared/runs/view';
import { type ProposalPurpose, proposalPurpose, proposalView } from '../../../../shared/runs/proposal';
import { stageLabelOf } from '../../../../shared/runs/view';
import type { Screen } from '../../App';
import { useT } from '../../i18n';
import { RichText } from '../Diagram';
import { useRun } from './runsApi';
import './cycle.css';

const PURPOSE_KEY: Record<ProposalPurpose, string> = {
  comment: 'ui.proposal.purpose.comment',
  review: 'ui.proposal.purpose.review',
  'run-pr': 'ui.proposal.purpose.pr',
  undo: 'ui.proposal.purpose.undo',
  priority: 'ui.proposal.purpose.priority',
  status: 'ui.proposal.purpose.status',
  'request-issue': 'ui.proposal.purpose.issue',
  squad: 'ui.proposal.purpose.squad',
  push: 'ui.proposal.purpose.push',
  release: 'ui.proposal.purpose.release',
};

const WHAT_KEY: Record<ProposalPurpose, string> = {
  comment: 'ui.proposal.what.comment',
  review: 'ui.proposal.what.review',
  'run-pr': 'ui.proposal.what.pr',
  undo: 'ui.proposal.what.undo',
  priority: 'ui.proposal.what.labels',
  status: 'ui.proposal.what.labels',
  'request-issue': 'ui.proposal.what.issue',
  squad: 'ui.proposal.what.labels',
  push: 'ui.proposal.what.push',
  release: 'ui.proposal.what.release',
};

const THREAD_KEY: Record<FindingThread, string> = {
  open: 'ui.proposal.review.new',
  still: 'ui.proposal.review.reply',
  fixed: 'ui.proposal.review.resolve',
};

/** True for an action the runner proposed: its own preview replaces the raw commands. */
export const isRunProposal = (a: ReleaseAction): boolean => proposalPurpose(a) !== null;

/** What a proposal of the runner will write, as it will read: the comment, the review's lines, the description, the labels; and the writes themselves, folded. */
export function RunProposal({ a, go }: { a: ReleaseAction; go: (s: Screen) => void }) {
  const t = useT();
  const purposeOf = proposalPurpose(a);
  const run = useRun(String(a.unit?.runId ?? ''));
  const view = purposeOf ? proposalView(a, run ?? null) : null;
  if (!view || !purposeOf) return null;
  const where = view.target ? t(view.target === 'mr' ? 'ui.proposal.on.pr' : 'ui.proposal.on.issue') : '';
  return (
    <div className="cy-proposal">
      <div className="row cy-proposal-head">
        <span className="badge cy-tone-working">{t(PURPOSE_KEY[purposeOf])}</span>
        {run && <span className="small muted">{t('ui.proposal.run', { ref: run.issue.ref, stage: stageLabelOf(run) })}</span>}
        <button type="button" className="btn cy-mini" onClick={() => go({ name: 'run', id: view.runId })}>{t('ui.proposal.openRun')}</button>
      </div>
      <p className="small">{t(WHAT_KEY[purposeOf], { where, title: view.title, branch: view.branch ?? '' })}</p>
      {view.edit && purposeOf === 'comment' && <p className="small muted">{t('ui.proposal.editNote')}</p>}
      {view.url && (purposeOf === 'undo' || view.edit) && <p className="small"><a href={view.url} target="_blank" rel="noreferrer">{t('ui.proposal.theComment')}</a></p>}
      {view.progress && <p className="small cy-proposal-progress" role="status">{t('ui.proposal.progress', { done: view.progress.done, total: view.progress.total })}</p>}
      {view.review && (
        <div className="cy-preview" aria-label={t('ui.proposal.review.title')}>
          <p className="small"><strong>{t(view.review.verdict === 'changes' ? 'ui.proposal.review.changes' : 'ui.proposal.review.comment', { round: view.review.round })}</strong></p>
          <ul className="cy-findings">
            {view.review.lines.map((l, i) => (
              <li key={i} className="cy-finding">
                <div className="row cy-finding-head">
                  <span className={`badge ${l.severity === 'blocking' ? 'cy-tone-blocked' : 'cy-tone-quiet'}`}>{t(l.severity === 'blocking' ? 'ui.cycle.review.blocking' : 'ui.cycle.review.suggestion')}</span>
                  {l.where && <code className="mono small cy-where">{l.where}</code>}
                  <span className="badge badge-quiet">{t(THREAD_KEY[l.thread])}</span>
                </div>
                <p className="small cy-finding-body">{l.body}</p>
                {l.suggestion && <pre className="rich-pre small cy-suggestion">{l.suggestion}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.body && (
        <div className="cy-preview" aria-label={t('ui.proposal.preview')}>
          <div className="section-title">{t('ui.proposal.preview')}</div>
          <div className="cy-doc"><RichText text={view.body} /></div>
          <details>
            <summary className="small muted">{t('ui.proposal.raw')}</summary>
            <pre className="rich-pre small">{view.body}</pre>
          </details>
        </div>
      )}
      {view.labels && (view.labels.add.length > 0 || view.labels.remove.length > 0) && (
        <p className="small cy-labels">
          {view.labels.add.map((l) => <span key={`+${l}`} className="badge cy-tone-done">{t('ui.proposal.labels.add', { label: l })}</span>)}
          {view.labels.remove.map((l) => <span key={`-${l}`} className="badge cy-tone-quiet">{t('ui.proposal.labels.remove', { label: l })}</span>)}
        </p>
      )}
      {a.output && (
        <details>
          <summary className="small muted">{t('ui.proposal.commands', { count: a.commands?.length ?? 1 })}</summary>
          <pre className="mono small cy-commands">{a.output}</pre>
        </details>
      )}
    </div>
  );
}
