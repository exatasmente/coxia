import { useEffect, useRef, useState } from 'react';
import { ASSIST_LIMITS, type AssistDraft } from '../../../../shared/agentAssist';
import type { WorkspaceConfig } from '../../../../shared/config/types';
import { agentThreadId } from '../../../../shared/forum';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { forgetNow, reloadThreads } from '../cycle/forumApi';
import { Thread } from '../cycle/Thread';
import '../cycle/cycle.css';
import { AssistQuestionView } from './AssistQuestion';
import { AssistReview } from './AssistReview';
import { answerOf, canAskAnotherRound, closeRound, hasProgress, roundNumber, roundsLeft, toDraftInput, toInput, withAnswer, withReview, withRound, type AssistState } from './assistEdit';
import { ASSIST_STEP_LABEL } from './labels';
import { assistApi } from './teamApi';
import { agentName, shown } from './text';
import { Confirm, Labeled, SidePanel } from './ui';

// The agent assistant, in the side panel: the request, the rounds of questions, the review of the draft and its settings, and the test in a conversation. The state is
// the section's (it lives above the panels, so the editor this opens can be cancelled and the assistant is still here); every call to the main process happens here, and
// what comes back is applied only to the assistant that asked.

type Action = 'round' | 'review' | 'save' | 'conclude' | 'fromTest' | 'close';

const STEPS = ['request', 'questions', 'review', 'test'] as const;

function Preview({ draft }: { draft: AssistDraft }) {
  const t = useT();
  const any = draft.name || draft.job || draft.instructions;
  return (
    <details className="tm-assist-preview" open>
      <summary>{t('ui.team.assist.preview')}</summary>
      {any ? (
        <dl className="tm-assist-draft">
          <dt>{t('ui.team.f.name')}</dt>
          <dd>{draft.name || t('ui.team.assist.empty')}</dd>
          <dt>{t('ui.team.f.job')}</dt>
          <dd>{draft.job || t('ui.team.assist.empty')}</dd>
          <dt>{t('ui.team.f.instructions')}</dt>
          <dd><pre className="tm-preview tm-assist-instructions">{draft.instructions || t('ui.team.assist.empty')}</pre></dd>
        </dl>
      ) : (
        <p className="small muted">{t('ui.team.assist.preview.none')}</p>
      )}
    </details>
  );
}

export function AgentAssist({
  config,
  state,
  update,
  reload,
  onConclude,
  onClose,
}: {
  config: WorkspaceConfig;
  state: AssistState;
  /** Changes the assistant's state, but only if it is still the assistant `session`; an answer that comes after it was closed is dropped. */
  update: (session: number, change: (s: AssistState) => AssistState) => void;
  /** Reads the configuration again: the draft agent is made and removed in the main process. */
  reload: () => void;
  /** The person is done: the section opens the editor on what the assistant made. */
  onConclude: (state: AssistState) => void;
  /** The assistant is closed (with a problem to tell, when the draft agent could not be removed). */
  onClose: (problem?: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<Action | null>(null);
  // A new step or a new round starts at the top of the panel: the person would otherwise land in the middle of it, where the last one was scrolled to.
  const top = useRef<HTMLOListElement>(null);
  const seen = useRef<string | null>(null);
  const place = `${state.step}:${roundNumber(state)}`;
  useEffect(() => {
    if (seen.current !== null && seen.current !== place) top.current?.scrollIntoView?.({ block: 'nearest' });
    seen.current = place;
  }, [place]);
  const [failure, setFailure] = useState<{ action: Action; message: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const session = state.session;
  const apply = (change: (s: AssistState) => AssistState) => update(session, change);
  const create = state.mode === 'create';
  const open = state.open;
  const testAgent = state.testId ? config.agents.team.find((a) => a.id === state.testId) : undefined;
  const title = create ? t('ui.team.assist.title.create') : t('ui.team.assist.title.adjust', { name: state.base ? shown(state.base.name) || state.base.id : '' });

  const perform = async (action: Action) => {
    setBusy(action);
    setFailure(null);
    try {
      if (action === 'round') {
        const r = await assistApi.round(toInput(closeRound(state)));
        apply((s) => withRound(closeRound(s), r));
      } else if (action === 'review') {
        const r = await assistApi.review(toInput(closeRound(state)));
        apply((s) => withReview(closeRound(s), r));
      } else if (action === 'fromTest') {
        const r = await assistApi.round(toInput(state, true));
        apply((s) => withRound(s, r));
      } else if (action === 'save') {
        const { id } = await assistApi.saveDraft(toDraftInput(state));
        apply((s) => ({ ...s, testId: id, step: 'test' }));
        // The draft agent is new, or its conversation began again: the config and the threads are read again.
        forgetNow();
        reloadThreads();
        reload();
      } else if (action === 'conclude') {
        // Creating with a draft agent saved: its conversation is emptied, and the editor then promotes the agent. An adjustment keeps its copy until the original is saved.
        if (create && state.testId) {
          await assistApi.conclude(state.testId);
          forgetNow();
          reloadThreads();
        }
        onConclude(state);
      } else {
        // closing: the draft agent and its conversation go
        if (state.testId) {
          try {
            await assistApi.discard(state.testId);
          } catch (e) {
            setBusy(null);
            forgetNow();
            reloadThreads();
            reload();
            onClose(errorText(e));
            return;
          }
          forgetNow();
          reloadThreads();
          reload();
        }
        onClose();
        return;
      }
    } catch (e) {
      setFailure({ action, message: errorText(e) });
    }
    setBusy(null);
  };

  // Closing with something to lose asks first. The calls that only move a draft agent are quick and are not interrupted; a call to the model is simply dropped.
  const requestClose = () => {
    if (busy === 'save' || busy === 'conclude' || busy === 'close') return;
    if (hasProgress(state)) setConfirmClose(true);
    else onClose();
  };

  const working = busy !== null;
  const status =
    busy === 'round' || busy === 'fromTest' ? t('ui.team.assist.loading.round') : busy === 'review' ? t('ui.team.assist.loading.review') : busy === 'save' ? t('ui.team.assist.loading.save') : busy === 'conclude' ? t('ui.team.assist.loading.conclude') : busy === 'close' ? t('ui.team.assist.loading.close') : null;

  return (
    <SidePanel label={title} onClose={requestClose}>
      <ol ref={top} className="tm-assist-steps" aria-label={t('ui.team.assist.stepsAria')}>
        {STEPS.map((id) => (
          <li key={id} className="tm-assist-step" aria-current={state.step === id ? 'step' : undefined}>{t(ASSIST_STEP_LABEL[id])}</li>
        ))}
      </ol>

      {confirmClose && (
        <Confirm
          danger
          confirmLabel={t('ui.team.assist.close.confirm')}
          onConfirm={() => {
            setConfirmClose(false);
            void perform('close');
          }}
          onCancel={() => setConfirmClose(false)}
        >
          <strong>{t('ui.team.assist.close.title')}</strong>
          <p>{state.testId ? t('ui.team.assist.close.bodyDraft') : t('ui.team.assist.close.body')}</p>
        </Confirm>
      )}

      {state.step === 'request' && (
        <div className="wz-stack">
          <p className="small muted">{t('ui.team.assist.intro')}</p>
          <Labeled label={create ? t('ui.team.assist.request.create') : t('ui.team.assist.request.adjust')} hint={t('ui.team.assist.request.hint')}>
            {(id) => (
              <textarea
                id={id}
                className="text-input"
                rows={5}
                maxLength={ASSIST_LIMITS.request}
                disabled={working}
                placeholder={create ? t('ui.team.assist.request.placeholderCreate') : t('ui.team.assist.request.placeholderAdjust')}
                value={state.request}
                onChange={(e) => apply((s) => ({ ...s, request: e.target.value }))}
              />
            )}
          </Labeled>
          <div className="wz-actions">
            <button type="button" className="btn btn-dark" disabled={working || !state.request.trim()} onClick={() => void perform('round')}>
              {busy === 'round' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.ask')}
            </button>
          </div>
        </div>
      )}

      {state.step === 'questions' && open && (
        <div className="wz-stack">
          <div className="row spread">
            <strong>{t('ui.team.assist.round', { n: roundNumber(state), max: ASSIST_LIMITS.rounds })}</strong>
            {state.enough && <span className="badge badge-quiet">{t('ui.team.assist.enough.badge')}</span>}
          </div>
          <Preview draft={state.draft} />
          {open.questions.length === 0 ? (
            <>
              <p className="small" role="status">{t('ui.team.assist.noQuestions')}</p>
              <div className="wz-actions">
                <button type="button" className="btn btn-dark" disabled={working} onClick={() => void perform('round')}>
                  {busy === 'round' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.retry')}
                </button>
                <button type="button" className="btn" disabled={working} onClick={() => void perform('review')}>{t('ui.team.assist.goOn')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="small muted">{t('ui.team.assist.skipHint')}</p>
              {open.questions.map((q) => (
                <AssistQuestionView key={`${state.rounds.length}-${q.id}`} question={q} answer={answerOf(open, q.id)} disabled={working} onChange={(a) => apply((s) => (s.open ? { ...s, open: withAnswer(s.open, a) } : s))} />
              ))}
              {state.enough && <p className="small muted">{t('ui.team.assist.enough')}</p>}
              {!state.enough && roundsLeft(state) === 0 && <p className="small muted">{t('ui.team.assist.noMoreRounds', { max: ASSIST_LIMITS.rounds })}</p>}
              <div className="wz-actions">
                {canAskAnotherRound(state) && (
                  <button type="button" className="btn btn-dark" disabled={working} onClick={() => void perform('round')}>
                    {busy === 'round' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.next')}
                  </button>
                )}
                <button type="button" className={`btn${canAskAnotherRound(state) ? '' : ' btn-dark'}`} disabled={working} onClick={() => void perform('review')}>
                  {busy === 'review' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.finish')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {state.step === 'review' && (
        <div className="wz-stack">
          <AssistReview config={config} state={state} disabled={working} onChange={(next) => apply(() => next)} />
          <p className="small muted">{t('ui.team.assist.review.next')}</p>
          <div className="wz-actions">
            <button type="button" className="btn" disabled={working} onClick={() => void perform('save')}>
              {busy === 'save' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.testIt')}
            </button>
            <button type="button" className="btn btn-dark" disabled={working} onClick={() => void perform('conclude')}>
              {busy === 'conclude' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.conclude')}
            </button>
          </div>
        </div>
      )}

      {state.step === 'test' && state.testId && (
        <div className="wz-stack">
          <p className="small muted">{t('ui.team.assist.test.hint')}</p>
          {testAgent ? (
            // Esc in the box closes its list of names first; it must not also ask to close the assistant.
            <div className="tm-assist-thread" onKeyDown={(e) => e.key === 'Escape' && e.defaultPrevented && e.stopPropagation()}>
              <Thread thread={agentThreadId(state.testId)} team={config.agents.team} title={agentName(testAgent)} />
            </div>
          ) : (
            <p className="small muted" role="status"><span className="spinner" aria-hidden="true" /> {t('ui.team.assist.test.preparing')}</p>
          )}
          <Labeled label={t('ui.team.assist.note')} hint={t('ui.team.assist.note.hint')}>
            {(id) => <textarea id={id} className="text-input" rows={3} maxLength={ASSIST_LIMITS.note} disabled={working} value={state.note} onChange={(e) => apply((s) => ({ ...s, note: e.target.value }))} />}
          </Labeled>
          {roundsLeft(state) === 0 && <p className="small muted">{t('ui.team.assist.test.noRounds', { max: ASSIST_LIMITS.rounds })}</p>}
          <div className="wz-actions">
            {roundsLeft(state) > 0 && (
              <button type="button" className="btn" disabled={working} onClick={() => void perform('fromTest')}>
                {busy === 'fromTest' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.fromTest')}
              </button>
            )}
            <button type="button" className="btn" disabled={working} onClick={() => apply((s) => ({ ...s, step: 'review' }))}>{t('ui.team.assist.backToReview')}</button>
            <button type="button" className="btn btn-dark" disabled={working} onClick={() => void perform('conclude')}>
              {busy === 'conclude' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.conclude')}
            </button>
          </div>
        </div>
      )}

      {status && (
        <p className="small muted tm-assist-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> {status}
        </p>
      )}
      {failure && (
        <div className="wz-stack">
          <div className="error" role="alert">{failure.message}</div>
          {failure.action !== 'close' && (
            <div className="wz-actions">
              <button type="button" className="btn" disabled={working} onClick={() => void perform(failure.action)}>{t('ui.team.assist.retry')}</button>
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}
