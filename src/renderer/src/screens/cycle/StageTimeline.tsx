import { useState } from 'react';
import { runKey } from '../../../../shared/browser';
import { runThreadId } from '../../../../shared/forum';
import type { WorkspaceConfig } from '../../../../shared/config/types';
import { shownText } from '../../../../shared/cycles/text';
import { type FlowStage, type Run, type StageUsage, hasUsage } from '../../../../shared/runs';
import type { ProcedureUse } from '../../../../shared/procedures';
import { type CommentRow, type StageRow, type StageState, canUndoPost, commentRows, stageRows, usageParams } from '../../../../shared/runs/view';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { ArtifactView } from './ArtifactView';
import { LiveScreen } from './LiveScreen';
import { asksOf } from './askView';
import { useScreens } from './useScreens';
import { WAIT_KEY, agentName, agentRole } from './names';
import { runsApi } from './runsApi';

const STATE_KEY: Record<StageState, string> = {
  upcoming: 'ui.cycle.stage.upcoming',
  running: 'ui.cycle.stage.running',
  'to-start': 'ui.cycle.stage.toStart',
  'to-accept': 'ui.cycle.stage.toAccept',
  gate: 'ui.cycle.stage.gate',
  question: 'ui.cycle.stage.question',
  waiting: 'ui.cycle.stage.waiting',
  failed: 'ui.cycle.stage.failed',
  done: 'ui.cycle.stage.done',
  skipped: 'ui.cycle.stage.skipped',
  rejected: 'ui.cycle.stage.rejected',
  cancelled: 'ui.cycle.stage.cancelled',
};

const TYPE_KEY: Record<FlowStage['type'], string> = {
  work: 'ui.cycle.type.work',
  gate: 'ui.cycle.type.gate',
  wait: 'ui.cycle.type.wait',
};

const COMMENT_STATUS_KEY: Record<CommentRow['record']['status'], string> = {
  published: 'ui.cycle.comment.published',
  proposed: 'ui.cycle.comment.proposed',
  draft: 'ui.cycle.comment.held',
  refused: 'ui.cycle.comment.refused',
  removed: 'ui.cycle.comment.removed',
};

const KIND_KEY: Record<CommentRow['kind'], string> = {
  stage: 'ui.cycle.comment.kind.stage',
  decision: 'ui.cycle.comment.kind.decision',
  question: 'ui.cycle.comment.kind.question',
  review: 'ui.cycle.comment.kind.review',
  pr: 'ui.cycle.comment.kind.pr',
};

const UNDO_KEY = { refused: 'ui.cycle.comment.undoRefused', nothing: 'ui.cycle.comment.undoNothing', 'no-host': 'ui.cycle.comment.undoNoHost' } as const;

/** One tracker comment of the run: where it stands, the link to it, and "delete" for a post that is up (a proposal that waits in Actions for the person's yes). */
function CommentLine({ run, row, go }: { run: Run; row: CommentRow; go: (s: Screen) => void }) {
  const t = useT();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const status = row.record.status;
  // A comment that never got a title or a status line is called by what it is, not by its key.
  const name = row.label === row.key ? t(KIND_KEY[row.kind]) : row.label;
  const undo = async () => {
    setStep('busy');
    setMessage(null);
    try {
      const r = await runsApi.undoPost(run.id, row.key);
      setMessage(r.proposed ? t('ui.cycle.comment.undoProposed') : t(UNDO_KEY[r.reason ?? 'nothing']));
    } catch (e) {
      setMessage(errorText(e));
    }
    setStep('idle');
  };
  return (
    <li className="cy-comment">
      <div className="row cy-comment-row">
        <span className={`badge cy-cstatus cy-cstatus-${status}`}>{t(COMMENT_STATUS_KEY[status])}</span>
        <span className="cy-comment-label">
          {row.record.url ? <a href={row.record.url} target="_blank" rel="noreferrer">{name}</a> : name}
          <span className="faint"> · {t(row.record.target === 'mr' ? 'ui.cycle.comment.onPr' : 'ui.cycle.comment.onIssue')}</span>
        </span>
        {status === 'proposed' && <button type="button" className="btn cy-mini" onClick={() => go({ name: 'actions' })}>{t('ui.cycle.comment.seeActions')}</button>}
        {canUndoPost(row) && step !== 'confirm' && (
          <button type="button" className="btn cy-mini" disabled={step === 'busy'} onClick={() => setStep('confirm')}>
            {t('ui.cycle.comment.undo')}
          </button>
        )}
        {step === 'confirm' && (
          <>
            <button type="button" className="btn btn-red cy-mini" onClick={() => void undo()}>{t('ui.cycle.comment.undoConfirm')}</button>
            <button type="button" className="btn cy-mini" onClick={() => setStep('idle')}>{t('ui.cycle.action.keep')}</button>
          </>
        )}
      </div>
      {step === 'confirm' && <p className="small muted">{t('ui.cycle.comment.undoHint')}</p>}
      {message && <p className="small" role="status">{message}</p>}
    </li>
  );
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

/** What the stage's model calls used, over its attempts: calls and tokens, and the cost when a provider reported one, said apart from an estimate (a token count never becomes a price here). */
function Usage({ usage }: { usage: StageUsage }) {
  const t = useT();
  const p = usageParams(usage, intlLocale());
  const key = p.cost === null ? 'ui.cycle.stage.usage' : p.estimated ? 'ui.cycle.stage.usageCostEstimated' : 'ui.cycle.stage.usageCost';
  return <p className="faint small cy-usage">{t(key, { calls: p.calls, prompt: p.prompt, cached: p.cached, completion: p.completion, cost: p.cost ?? '' })}</p>;
}

const PROCEDURE_KEY = { ok: 'ui.cycle.stage.procedureUsed', failed: 'ui.cycle.stage.procedureFailed', replaced: 'ui.cycle.stage.procedureReplaced' } as const;

/** The procedures the stage's agent read, one chip each: the title, and whether a step failed or the agent replaced it. A failure stands out, nothing else does. */
function Procedures({ uses }: { uses: readonly ProcedureUse[] }) {
  const t = useT();
  return (
    <ul className="cy-artifacts" aria-label={t('ui.cycle.stage.procedures')}>
      {uses.map((u) => (
        <li key={u.id}>
          <span className={`badge ${u.outcome === 'failed' ? 'badge-block' : 'badge-quiet'}`}>{t(PROCEDURE_KEY[u.outcome], { title: u.title })}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({ run, row, comments, config, go, view }: { run: Run; row: StageRow; comments: CommentRow[]; config: WorkspaceConfig | null; go: (s: Screen) => void; view: (name: string) => void }) {
  const t = useT();
  const { stage, record, state } = row;
  const team = config?.agents.team;
  const agent = stage.agent;
  // What the stage's agent does when it is entered: the record keeps what it was then; a stage not entered yet shows what it would be now.
  const autonomous = record ? record.autonomous : stage.autonomous;
  // The agent's virtual screen, while this is the stage working on one. A viewer that is open stays when the stage ends, so it can say so.
  const [watching, setWatching] = useState(false);
  // The questions waiting on the stage's screen are answered from its viewer; the list is read only while the viewer is open.
  const open = useScreens(watching ? runThreadId(run.id) : null);
  const hasScreen = row.current && state === 'running' && run.screen?.stage === stage.id;
  return (
    <li className="cy-stage" data-state={state} aria-current={row.current ? 'step' : undefined}>
      <span className="cy-dot" aria-hidden="true" />
      <div className="cy-stage-body">
        <div className="row cy-stage-head">
          <h3 className="cy-stage-name">{shownText(stage.label)}</h3>
          <span className="badge badge-quiet">{t(TYPE_KEY[stage.type])}</span>
          <span className={`cy-stage-state cy-s-${state}`}>{t(STATE_KEY[state])}</span>
          {hasScreen && <button type="button" className="btn cy-mini" onClick={() => setWatching(true)}>{t('ui.cycle.live.open')}</button>}
          {record && record.attempts > 1 && <span className="faint small">{t('ui.cycle.stage.attempts', { count: record.attempts })}</span>}
        </div>
        {agent && (
          <p className="small cy-meta">
            <strong>{agentName(team, agent)}</strong>
            {agentRole(team, agent) ? <span className="faint cy-role"> · {agentRole(team, agent)}</span> : null}
            <span className={`badge cy-autonomy ${autonomous ? 'cy-auto-on' : 'cy-auto-off'}`}>{t(autonomous ? 'ui.cycle.stage.autonomous' : 'ui.cycle.stage.waitsForYou')}</span>
          </p>
        )}
        {stage.type === 'wait' && stage.waitsFor && <p className="small faint">{t(WAIT_KEY[stage.waitsFor.kind], { label: stage.waitsFor.label ?? '', minutes: stage.waitsFor.minutes ?? 0 })}</p>}
        {record?.startedAt && <p className="faint small">{t('ui.cycle.stage.since', { when: when(record.startedAt) })}{record.endedAt ? ` · ${t('ui.cycle.stage.until', { when: when(record.endedAt) })}` : ''}</p>}
        {record && hasUsage(record.usage) && <Usage usage={record.usage} />}
        {record?.procedures && record.procedures.length > 0 && <Procedures uses={record.procedures} />}
        {record && record.artifacts.length > 0 && (
          <ul className="cy-artifacts" aria-label={t('ui.cycle.stage.artifacts')}>
            {record.artifacts.map((name) => {
              // A resumed stage merges the artifacts of its attempts; the badge says which attempt each one is from, when the run recorded it.
              const attempt = record.attempts > 1 ? record.artifactAttempts?.[name] : undefined;
              return (
                <li key={name}>
                  <button type="button" className="cy-file mono" onClick={() => view(name)}>{name}</button>
                  {attempt !== undefined && <span className="faint small"> · {t('ui.cycle.stage.attemptOf', { count: attempt })}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {comments.length > 0 && (
          <ul className="cy-comments" aria-label={t('ui.cycle.stage.comments')}>
            {comments.map((c) => <CommentLine key={c.key} run={run} row={c} go={go} />)}
          </ul>
        )}
      </div>
      {watching && <LiveScreen screenKey={runKey(run.id)} state={run.screen ?? null} asks={asksOf(open).filter((a) => a.key === runKey(run.id))} team={team} onClose={() => setWatching(false)} />}
    </li>
  );
}

/** The stages of the flow the run follows, in order, as a timeline: each with its agent, who decides when it starts, its state, its attempts, its documents and its tracker comments. */
export function StageTimeline({ run, flow, config, go }: { run: Run; flow: readonly FlowStage[]; config: WorkspaceConfig | null; go: (s: Screen) => void }) {
  const t = useT();
  const [viewing, setViewing] = useState<string | null>(null);
  const rows = stageRows(run, flow);
  const comments = commentRows(run);
  const known = new Set(flow.map((s) => s.id));
  // A comment whose stage the flow no longer has, and the pull request's description, close the list.
  const loose = comments.filter((c) => c.stage === null || !known.has(c.stage));
  return (
    <section className="panel cy-timeline-panel" aria-labelledby="cy-stages-h">
      <h2 id="cy-stages-h" className="cy-h">{t('ui.cycle.stages.title')}</h2>
      <ol className="cy-timeline">
        {rows.map((row) => (
          <Row key={row.stage.id} run={run} row={row} comments={comments.filter((c) => c.stage === row.stage.id)} config={config} go={go} view={setViewing} />
        ))}
      </ol>
      {loose.length > 0 && (
        <>
          <h3 className="section-title">{t('ui.cycle.stages.other')}</h3>
          <ul className="cy-comments">{loose.map((c) => <CommentLine key={c.key} run={run} row={c} go={go} />)}</ul>
        </>
      )}
      {viewing && <ArtifactView runId={run.id} name={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
