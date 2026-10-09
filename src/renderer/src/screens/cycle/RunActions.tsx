import { useEffect, useState } from 'react';
import type { AgentDef, SquadDef, WorkspaceConfig } from '../../../../shared/config/types';
import { shownText } from '../../../../shared/cycles/text';
import { autonomousOf, squadOf } from '../../../../shared/config/squads';
import { type FlowStage, type Run, type RunFailure, defaultSendBackTarget, looksLikeSendBack, sendBackTargets } from '../../../../shared/runs';
import { type RunAction, type RunActionId, currentAgent, currentStage, planHeads, runActions, shortSha, skipWaitOutcome } from '../../../../shared/runs/view';
import type { Card, ReleaseAction } from '../../../../shared/types';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { RunBadge } from './RunBadge';
import { SKIP_WAIT_KEY, WAIT_KEY, agentName, agentOf, squadName } from './names';
import { patchRun, reloadConfig, runsApi } from './runsApi';

// What the person can do for a run in the state it is in: the question or the decision that waits, the buttons of `runActions`, and the switches of the agent
// of the current stage and of its squad. The state-to-buttons table is `runActions` (pure, tested); this file draws it and calls the channels.

const NOW_KEY: Record<string, string> = {
  working: 'ui.cycle.now.working',
  gate: 'ui.cycle.now.gate',
  question: 'ui.cycle.now.question',
  'to-start': 'ui.cycle.now.toStart',
  'to-accept': 'ui.cycle.now.toAccept',
  waiting: 'ui.cycle.now.waiting',
  failed: 'ui.cycle.now.failed',
  done: 'ui.cycle.now.done',
  cancelled: 'ui.cycle.now.cancelled',
};

const ACTION_LABEL: Record<RunActionId, string> = {
  startStage: 'ui.cycle.action.startStage',
  accept: 'ui.cycle.action.accept',
  return: 'ui.cycle.action.return',
  approve: 'ui.cycle.action.approve',
  reject: 'ui.cycle.action.reject',
  skip: 'ui.cycle.action.skip',
  answer: 'ui.cycle.action.answer',
  chooseSquad: 'ui.cycle.action.chooseSquad',
  retryPr: 'ui.cycle.action.retryPr',
  skipWait: 'ui.cycle.action.skipWait',
  sendBack: 'ui.cycle.action.sendBack',
  retry: 'ui.cycle.action.retry',
  cancel: 'ui.cycle.action.cancel',
};

const TEXT_LABEL: Partial<Record<Run['status'], string>> = {
  gate: 'ui.cycle.input.gate',
  'to-accept': 'ui.cycle.input.toAccept',
  question: 'ui.cycle.input.question',
  waiting: 'ui.cycle.input.waiting',
};

const ERROR_KEY: Record<RunFailure['code'], string> = {
  'no-agent': 'ui.cycle.error.noAgent',
  'stage-failed': 'ui.cycle.error.stageFailed',
  'no-event': 'ui.cycle.error.noEvent',
  'pr-open-failed': 'ui.cycle.error.prOpenFailed',
};

interface Props {
  run: Run;
  flow: readonly FlowStage[];
  config: WorkspaceConfig | null;
  card?: Card;
  actions: readonly ReleaseAction[];
  go: (s: Screen) => void;
  /** Changes when something else on the screen (the thread's hint) asks for the form that sends the work back. */
  sendBackAsk?: number;
}

/** The text the person reads about what the run waits for, by state. */
/** The commits the plan at this gate was written for, one per pull request: accepting the plan freezes exactly these. */
function PlanHeads({ run }: { run: Run }) {
  const t = useT();
  const heads = planHeads(run);
  if (!heads) return null;
  return (
    <div className="cy-plan-heads small">
      <span className="muted">{t('ui.cycle.planHeads.title')}</span>
      {heads.length === 0 ? (
        <p className="muted">{t('ui.cycle.planHeads.none')}</p>
      ) : (
        <ul>
          {heads.map((h) => (
            <li key={h.pr}>
              <span className="mono">{t('ui.cycle.planHeads.item', { pr: h.pr, sha: shortSha(h.seen) })}</span>
              {h.now && <span className="error"> · {t('ui.cycle.planHeads.moved', { pr: h.pr, now: shortSha(h.now) })}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Waiting({ run, flow, config }: { run: Run; flow: readonly FlowStage[]; config: WorkspaceConfig | null }) {
  const t = useT();
  const team = config?.agents.team;
  const stage = currentStage(run, flow);
  const q = run.question;
  const agent = currentAgent(run, flow);
  return (
    <>
      <p className="cy-now">{t(NOW_KEY[run.status], { stage: shownText(stage?.label ?? run.stage), agent: agent ? agentName(team, agent) : '' })}</p>
      {run.status === 'question' && q && (
        <blockquote className="cy-question">
          <span className="cy-question-by">
            {q.by === 'app' ? t('ui.cycle.question.byApp') : t('ui.cycle.question.by', { agent: agentName(team, q.by) })}
            {q.holder ? ` · ${t('ui.cycle.question.with', { agent: agentName(team, q.holder) })}` : ''}
            {q.hops ? ` · ${t('ui.cycle.question.hops', { count: q.hops })}` : ''}
          </span>
          {q.text}
        </blockquote>
      )}
      {run.status === 'question' && q?.kind === 'review-limit' && <p className="small muted">{t('ui.cycle.question.reviewLimit')}</p>}
      {run.status === 'question' && q?.holder && <p className="small muted">{t('ui.cycle.question.holderNote', { agent: agentName(team, q.holder) })}</p>}
      {run.status === 'waiting' && run.wait && (
        <p className="small muted">
          {t(WAIT_KEY[run.wait.kind] ?? 'ui.cycle.wait.time', { label: run.wait.label ?? '', minutes: run.wait.minutes ?? 0, provider: run.wait.provider ?? '', plugin: run.wait.plugin ?? '' })}
        </p>
      )}
      {run.status === 'failed' && run.error && (
        <p className="error" role="alert">{t(ERROR_KEY[run.error.code], { detail: run.error.detail ?? '' })}</p>
      )}
    </>
  );
}

function SquadChoice({ run, squads, busy, call }: { run: Run; squads: readonly SquadDef[]; busy: boolean; call: (fn: () => Promise<Run>) => void }) {
  const t = useT();
  const routing = run.routing;
  const candidates = (routing?.candidates ?? []).map((id) => squads.find((s) => s.id === id)).filter((s): s is SquadDef => !!s);
  const proposal = routing?.proposal;
  return (
    <div className="cy-squad-choice">
      {proposal && <p className="small">{t('ui.cycle.squad.proposal', { squad: squadName(squads, proposal.squad), reason: proposal.reason })}</p>}
      <div className="row">
        {candidates.map((s) => (
          <button key={s.id} type="button" className={`btn ${proposal?.squad === s.id ? 'btn-dark' : ''}`} disabled={busy} onClick={() => call(() => runsApi.setSquad(run.id, s.id))}>
            {t('ui.cycle.squad.pick', { squad: s.name })}
          </button>
        ))}
        <button type="button" className="btn" disabled={busy} onClick={() => call(() => runsApi.setSquad(run.id, null))}>{t('ui.cycle.squad.none')}</button>
      </div>
    </div>
  );
}

/** The question of a failed pull request: one button per base the run recorded, the click opens it against that base now. */
function PrRetryChoice({ run, busy, call }: { run: Run; busy: boolean; call: (fn: () => Promise<Run>) => void }) {
  const t = useT();
  return (
    <div className="cy-pr-retry" role="group" aria-label={t('ui.cycle.prRetry.title')}>
      <p className="small muted">{t('ui.cycle.prRetry.title')}</p>
      <div className="row">
        {(run.question?.bases ?? []).map((base) => (
          <button key={base} type="button" className="btn btn-dark" disabled={busy} onClick={() => call(() => runsApi.retryPr(run.id, base))}>
            {t('ui.cycle.prRetry.pick', { branch: base })}
          </button>
        ))}
      </div>
      <p className="faint small">{t('ui.cycle.prRetry.hint')}</p>
    </div>
  );
}

function Switch({ on, disabled, label, hint, onChange }: { on: boolean; disabled: boolean; label: string; hint: string; onChange: (next: boolean) => void }) {
  return (
    <div className="cy-switch-row">
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`cy-switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
        <span className="cy-switch-knob" aria-hidden="true" />
      </button>
      <span className="cy-switch-text">
        <span>{label}</span>
        <span className="faint">{hint}</span>
      </span>
    </div>
  );
}

/** The autonomy of the agent that works the current stage and of its squad: each takes effect at the next stage start or publication. */
function Autonomy({ run, agent, config, busy, call }: { run: Run; agent: AgentDef; config: WorkspaceConfig; busy: boolean; call: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const squad = squadOf(config, run.squad ?? agent.squad);
  const effective = autonomousOf(config, agent);
  return (
    <section className="cy-autonomy" aria-label={t('ui.cycle.autonomy.title')}>
      <h3 className="section-title">{t('ui.cycle.autonomy.title')}</h3>
      <Switch
        on={agent.autonomous}
        disabled={busy}
        label={t('ui.cycle.autonomy.agent', { agent: agentName(config.agents.team, agent.id) })}
        hint={t(agent.autonomous ? (effective ? 'ui.cycle.autonomy.agentOn' : 'ui.cycle.autonomy.agentHeld') : 'ui.cycle.autonomy.agentOff')}
        onChange={(on) => call(() => runsApi.setAutonomous(agent.id, on).then(reloadConfig))}
      />
      {squad && (
        <Switch
          on={squad.autonomy}
          disabled={busy}
          label={t('ui.cycle.autonomy.squad', { squad: squad.name })}
          hint={t(squad.autonomy ? 'ui.cycle.autonomy.squadOn' : 'ui.cycle.autonomy.squadOff')}
          onChange={(on) => call(() => runsApi.setSquadAutonomous(squad.id, on).then(reloadConfig))}
        />
      )}
      <p className="faint small">{t('ui.cycle.autonomy.later')}</p>
    </section>
  );
}

/** The form that sends the work back: the stage it goes to (the default is the one the flow and the team say), what to ask, and the one click that does it. */
function SendBackForm({ run, flow, config, note, onNote, target, onTarget, offered, busy, onSend, onSkipAnyway, onClose }: { run: Run; flow: readonly FlowStage[]; config: WorkspaceConfig | null; note: string; onNote: (v: string) => void; target: string; onTarget: (v: string) => void; offered: boolean; busy: boolean; onSend: () => void; onSkipAnyway: () => void; onClose: () => void }) {
  const t = useT();
  const targets = sendBackTargets(flow, run.stage);
  const chosen = targets.find((s) => s.id === target);
  return (
    <div className="cy-sendback" role="group" aria-label={t('ui.cycle.sendBack.title')}>
      <h3 className="section-title">{t('ui.cycle.sendBack.title')}</h3>
      {offered && <p className="small cy-sendback-offer" role="note">{t('ui.cycle.sendBack.offer')}</p>}
      <label className="cy-field">
        <span className="small muted">{t('ui.cycle.sendBack.to')}</span>
        <select className="text-input" value={target} disabled={busy} onChange={(e) => onTarget(e.target.value)}>
          {targets.map((s) => (
            <option key={s.id} value={s.id}>{t('ui.cycle.sendBack.option', { stage: shownText(s.label), agent: s.agent ? agentName(config?.agents.team, s.agent) : '' })}</option>
          ))}
        </select>
      </label>
      <label className="cy-field">
        <span className="small muted">{t('ui.cycle.sendBack.note')}</span>
        <textarea className="text-input cy-textarea" rows={3} value={note} onChange={(e) => onNote(e.target.value)} disabled={busy} />
      </label>
      <p className="small muted">{t(run.status === 'done' ? 'ui.cycle.sendBack.hintDone' : 'ui.cycle.sendBack.hint')}</p>
      <div className="row">
        <button type="button" className="btn btn-dark" disabled={busy || !chosen} onClick={onSend}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.cycle.sendBack.confirm', { stage: chosen ? shownText(chosen.label) : '' })}
        </button>
        {offered && <button type="button" className="btn" disabled={busy || !note.trim()} onClick={onSkipAnyway}>{t('ui.cycle.sendBack.skipAnyway')}</button>}
        <button type="button" className="btn" disabled={busy} onClick={onClose}>{t('ui.cycle.sendBack.keep')}</button>
      </div>
    </div>
  );
}

export function RunActions({ run, flow, config, card, actions, go, sendBackAsk = 0 }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sending, setSending] = useState(false);
  const [offered, setOffered] = useState(false);
  const [sendNote, setSendNote] = useState('');
  const [target, setTarget] = useState('');
  const available = runActions(run, flow);
  const team = config?.agents.team;
  const targets = sendBackTargets(flow, run.stage);
  const preferred = (defaultSendBackTarget(flow, run.stage, (a) => agentOf(team, a)?.permission === 'worktree') ?? targets[targets.length - 1])?.id ?? '';
  const openSendBack = (note: string, offer: boolean) => {
    setSendNote(note);
    setTarget(preferred);
    setOffered(offer);
    setSending(true);
  };
  // The thread's hint asks for the form: it opens with what was typed nowhere yet.
  useEffect(() => {
    if (sendBackAsk > 0 && runActions(run, flow).some((a) => a.id === 'sendBack')) openSendBack('', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendBackAsk]);
  const agentId = run.status === 'done' || run.status === 'cancelled' ? null : currentAgent(run, flow);
  const agent = agentId ? agentOf(config?.agents.team, agentId) : undefined;
  const proposals = actions.filter((a) => a.state === 'pending' && a.unit?.runId === run.id).length;

  const call = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void fn().then(
      (result) => {
        if (result && typeof result === 'object' && 'rev' in result) patchRun(result as Run);
        setText('');
        setConfirmCancel(false);
        setSending(false);
        setOffered(false);
        setBusy(false);
      },
      (e) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };

  const doIt = (a: RunAction) => {
    const note = text.trim();
    switch (a.id) {
      case 'startStage': return call(() => runsApi.startStage(run.id));
      case 'accept': return call(() => runsApi.accept(run.id, note));
      case 'return': return call(() => runsApi.returnStage(run.id, note));
      case 'approve': return call(() => runsApi.gate(run.id, 'approve', note));
      case 'reject': return call(() => runsApi.gate(run.id, 'reject', note));
      case 'skip': return call(() => runsApi.gate(run.id, 'skip', note));
      case 'answer': return call(() => runsApi.answer(run.id, note));
      case 'skipWait': return looksLikeSendBack(note, (team ?? []).map((x) => x.id)) ? openSendBack(note, true) : call(() => runsApi.skipWait(run.id, note));
      case 'sendBack': return openSendBack(note, false);
      case 'retry': return call(() => runsApi.retry(run.id));
      case 'cancel': return confirmCancel ? call(() => runsApi.cancel(run.id)) : setConfirmCancel(true);
      case 'chooseSquad': return undefined;
      // The base comes from the clicked button, not the text field: the group below draws the choices.
      case 'retryPr': return undefined;
    }
  };

  const needsText = available.some((a) => a.id !== 'sendBack' && a.input !== 'none');
  const outcome = run.status === 'waiting' ? skipWaitOutcome(run, flow) : null;
  const gateQuiz = run.status === 'gate' && card;

  return (
    <section className="panel cy-now-panel" aria-label={t('ui.cycle.now.title')}>
      <div className="row spread">
        <h2 className="cy-h">{t('ui.cycle.now.title')}</h2>
        <RunBadge run={run} withStage />
      </div>
      <Waiting run={run} flow={flow} config={config} />
      <PlanHeads run={run} />
      {proposals > 0 && (
        <p className="small cy-proposals">
          {t('ui.cycle.proposals', { count: proposals })}{' '}
          <button type="button" className="cy-link" onClick={() => go({ name: 'actions' })}>{t('ui.cycle.proposals.open')}</button>
        </p>
      )}
      {run.status === 'question' && run.question?.kind === 'squad' && config && (
        <SquadChoice run={run} squads={config.squads ?? []} busy={busy} call={(fn) => call(fn)} />
      )}
      {run.status === 'question' && run.question?.kind === 'pr-retry' && (run.question.bases ?? []).length > 0 && (
        <PrRetryChoice run={run} busy={busy} call={(fn) => call(fn)} />
      )}
      {needsText && (
        <label className="cy-field">
          <span className="small muted">{t(TEXT_LABEL[run.status] ?? 'ui.cycle.input.note')}</span>
          <textarea className="text-input cy-textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        </label>
      )}
      {outcome && (
        <p className="small muted cy-skip-next">
          {outcome.kind === 'stage' && t('ui.cycle.skipWait.next', { stage: shownText(outcome.stage.label) })}
          {outcome.kind === 'end' && t('ui.cycle.skipWait.end')}
          {outcome.kind === 'resume' && t('ui.cycle.skipWait.resume', { agent: outcome.agent ? agentName(team, outcome.agent) : '' })}
          {available.some((a) => a.id === 'sendBack') && ` ${t('ui.cycle.skipWait.sendBackHint')}`}
        </p>
      )}
      {available.length > 0 && (
        <div className="row">
          {available.filter((a) => a.id !== 'chooseSquad' && a.id !== 'retryPr').map((a) => {
            const missing = a.input === 'required' && !text.trim();
            const confirming = a.id === 'cancel' && confirmCancel;
            return (
              <button
                key={a.id}
                type="button"
                className={`btn ${a.id === 'cancel' ? (confirming ? 'btn-red' : '') : a.id === 'approve' || a.id === 'accept' || a.id === 'startStage' || a.id === 'answer' || a.id === 'retry' ? 'btn-dark' : ''}`}
                disabled={busy || missing}
                onClick={() => doIt(a)}
              >
                {busy && !confirming ? <span className="spinner" aria-hidden="true" /> : null} {confirming ? t('ui.cycle.action.cancelConfirm') : t(a.id === 'skipWait' && run.wait ? SKIP_WAIT_KEY[run.wait.kind] : ACTION_LABEL[a.id])}
              </button>
            );
          })}
          {confirmCancel && (
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirmCancel(false)}>{t('ui.cycle.action.keep')}</button>
          )}
          {gateQuiz && (
            <button type="button" className="btn" onClick={() => go({ name: 'gate', ref: run.issue.ref, card })}>{t('ui.cycle.action.quiz')}</button>
          )}
        </div>
      )}
      {sending && (
        <SendBackForm
          run={run}
          flow={flow}
          config={config}
          note={sendNote}
          onNote={setSendNote}
          target={target}
          onTarget={setTarget}
          offered={offered}
          busy={busy}
          onSend={() => call(() => runsApi.sendBack(run.id, target, sendNote.trim()))}
          onSkipAnyway={() => call(() => runsApi.skipWait(run.id, sendNote.trim()))}
          onClose={() => {
            setSending(false);
            setOffered(false);
          }}
        />
      )}
      {confirmCancel && <p className="small muted">{t('ui.cycle.action.cancelHint')}</p>}
      {error && <div className="error" role="alert">{error}</div>}
      {agent && config && <Autonomy run={run} agent={agent} config={config} busy={busy} call={(fn) => call(fn)} />}
    </section>
  );
}
