import { useEffect, useRef, useState } from 'react';
import { ASSIST_LIMITS, type AssistDraft } from '../../../../shared/agentAssist';
import type { AgentDef } from '../../../../shared/config/types';
import { agentThreadId } from '../../../../shared/forum';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { forgetNow, reloadThreads } from '../cycle/forumApi';
import { AssistQuestionView } from '../team/AssistQuestion';
import { answerOf, canAskAnotherRound, closeRound, hasProgress, roundNumber, roundsLeft, withAnswer, withRound } from '../team/assistEdit';
import { ASSIST_STEP_LABEL } from '../team/labels';
import { useConfigView } from '../team/teamApi';
import { Confirm, Labeled, SidePanel } from '../team/ui';
import { ChatThread } from './ChatThread';
import { personaApi } from './personaApi';
import { type PersonaState, draftChanged, personaFormOf, startPersona, toFinishInput, toPersonaDraftInput, toPersonaInput, withPersonaReview } from './personaWizardModel';
import '../cycle/cycle.css';
import './chat.css';

// The wizard that makes (or adjusts) the persona: the request, the rounds of questions, the review of three texts, the test in the chat, and the end. It is the agent
// assistant's machinery with the persona's own questions, and it works the same on the computer and on a paired phone. Nothing becomes the persona before the last button.

type Action = 'round' | 'review' | 'save' | 'finish' | 'fromTest' | 'close';

const STEPS = ['request', 'questions', 'review', 'test'] as const;

function Preview({ draft }: { draft: AssistDraft }) {
  const t = useT();
  const any = draft.name || draft.job || draft.instructions;
  return (
    <details className="tm-assist-preview" open>
      <summary>{t('ui.team.assist.preview')}</summary>
      {any ? (
        <dl className="tm-assist-draft">
          <dt>{t('ui.persona.f.name')}</dt>
          <dd>{draft.name || t('ui.team.assist.empty')}</dd>
          <dt>{t('ui.persona.f.job')}</dt>
          <dd>{draft.job || t('ui.team.assist.empty')}</dd>
          <dt>{t('ui.persona.f.instructions')}</dt>
          <dd><pre className="tm-preview tm-assist-instructions">{draft.instructions || t('ui.team.assist.empty')}</pre></dd>
        </dl>
      ) : (
        <p className="small muted">{t('ui.team.assist.preview.none')}</p>
      )}
    </details>
  );
}

interface Props {
  /** `screen`: the home's invitation, full screen. `panel`: the side panel of Settings. */
  presentation: 'screen' | 'panel';
  /** The persona to adjust; absent or null: the first is made. */
  persona?: AgentDef | null;
  /** Saved: the chat is next. Gets the persona's id. */
  onDone: (id: string) => void;
  /** Closed, and the draft with its conversation deleted (a problem to tell, when the draft could not be removed). On the screen it is the "Not now". */
  onClose: (problem?: string) => void;
}

export function PersonaWizard({ presentation, persona = null, onDone, onClose }: Props) {
  const t = useT();
  const { view, reload } = useConfigView();
  const team = view?.config.agents.team;
  const [state, setState] = useState<PersonaState>(() => startPersona(persona ? personaFormOf(persona) : null));
  const [busy, setBusy] = useState<Action | null>(null);
  const [failure, setFailure] = useState<{ action: Action; message: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // A new step or a new round starts at the top: the person would otherwise land in the middle of it, where the last one was scrolled to.
  const top = useRef<HTMLOListElement>(null);
  const seen = useRef<string | null>(null);
  const place = `${state.step}:${roundNumber(state)}`;
  useEffect(() => {
    if (seen.current !== null && seen.current !== place) top.current?.scrollIntoView?.({ block: 'nearest' });
    seen.current = place;
  }, [place]);

  const session = state.session;
  // An answer that comes after the wizard was closed is dropped: it belongs to a session that is gone.
  const apply = (change: (s: PersonaState) => PersonaState) => setState((s) => (s.session === session ? change(s) : s));
  const create = state.mode === 'create';
  const open = state.open;
  const testAgent = state.testId ? team?.find((a) => a.id === state.testId) : undefined;
  const title = create ? t('ui.persona.wizard.title.create') : t('ui.persona.wizard.title.adjust', { name: state.base ? state.base.draft.name || state.base.id : '' });
  const working = busy !== null;

  const refresh = (): void => {
    forgetNow();
    reloadThreads();
    reload();
  };

  const perform = async (action: Action) => {
    setBusy(action);
    setFailure(null);
    try {
      if (action === 'round') {
        const r = await personaApi.round(toPersonaInput(closeRound(state)));
        apply((s) => withRound(closeRound(s), r));
      } else if (action === 'review') {
        const r = await personaApi.review(toPersonaInput(closeRound(state)));
        apply((s) => withPersonaReview(closeRound(s), r));
      } else if (action === 'fromTest') {
        const r = await personaApi.round(toPersonaInput(state, true));
        apply((s) => withRound(s, r));
      } else if (action === 'save') {
        const { id } = await personaApi.saveDraft(toPersonaDraftInput(state));
        apply((s) => ({ ...s, testId: id, step: 'test' }));
        // The draft persona is new, or its conversation began again: the config and the threads are read again.
        refresh();
      } else if (action === 'finish') {
        // From the test it is exactly the draft that was tried; from the review the draft is saved first, with the texts as they are now.
        const id = state.step === 'test' && state.testId ? state.testId : (await personaApi.saveDraft(toPersonaDraftInput(state))).id;
        const done = await personaApi.finish(toFinishInput(state, id));
        refresh();
        onDone(done.id);
        return;
      } else {
        // closing: the draft persona and its conversation go
        if (state.testId) {
          try {
            await personaApi.discard(state.testId);
          } catch (e) {
            setBusy(null);
            refresh();
            onClose(errorText(e));
            return;
          }
          refresh();
        }
        onClose();
        return;
      }
    } catch (e) {
      setFailure({ action, message: errorText(e) });
    }
    setBusy(null);
  };

  // Closing with something to lose asks first. The calls that only move the draft are quick and are not interrupted; a call to the model is simply dropped.
  const requestClose = () => {
    if (busy === 'save' || busy === 'finish' || busy === 'close') return;
    if (hasProgress(state) || draftChanged(state)) setConfirmClose(true);
    else onClose();
  };

  const status =
    busy === 'round' || busy === 'fromTest' ? t('ui.team.assist.loading.round') : busy === 'review' ? t('ui.team.assist.loading.review') : busy === 'save' ? t('ui.persona.wizard.loading.save') : busy === 'finish' ? t('ui.persona.wizard.loading.finish') : busy === 'close' ? t('ui.team.assist.loading.close') : null;
  const finishLabel = create ? t('ui.persona.wizard.save') : t('ui.persona.wizard.saveAdjust');

  const body = (
    <>
      <ol ref={top} className="tm-assist-steps" aria-label={t('ui.persona.wizard.stepsAria')}>
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
          <strong>{t('ui.persona.wizard.close.title')}</strong>
          <p>{state.testId ? t('ui.persona.wizard.close.bodyDraft') : t('ui.persona.wizard.close.body')}</p>
        </Confirm>
      )}

      {state.step === 'request' && (
        <div className="wz-stack">
          <p className="small muted">{t('ui.persona.wizard.intro')}</p>
          <Labeled label={create ? t('ui.persona.wizard.request.create') : t('ui.persona.wizard.request.adjust')} hint={t('ui.team.assist.request.hint')}>
            {(id) => (
              <textarea
                id={id}
                className="text-input"
                rows={5}
                maxLength={ASSIST_LIMITS.request}
                disabled={working}
                placeholder={create ? t('ui.persona.wizard.request.placeholderCreate') : t('ui.persona.wizard.request.placeholderAdjust')}
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
              {state.enough && <p className="small muted">{t('ui.persona.wizard.enough')}</p>}
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
          <p className="small muted">{t('ui.persona.wizard.review.hint')}</p>
          <Labeled label={t('ui.persona.f.name')}>
            {(id) => <input id={id} className="text-input" maxLength={ASSIST_LIMITS.name} disabled={working} value={state.draft.name} onChange={(e) => apply((s) => ({ ...s, draft: { ...s.draft, name: e.target.value } }))} />}
          </Labeled>
          <Labeled label={t('ui.persona.f.job')} hint={t('ui.persona.f.jobHint')}>
            {(id) => <textarea id={id} className="text-input" rows={3} maxLength={ASSIST_LIMITS.job} disabled={working} value={state.draft.job} onChange={(e) => apply((s) => ({ ...s, draft: { ...s.draft, job: e.target.value } }))} />}
          </Labeled>
          <Labeled label={t('ui.persona.f.instructions')} hint={t('ui.persona.f.instructionsHint')}>
            {(id) => <textarea id={id} className="text-input mono" rows={14} maxLength={ASSIST_LIMITS.instructions} disabled={working} value={state.draft.instructions} onChange={(e) => apply((s) => ({ ...s, draft: { ...s.draft, instructions: e.target.value } }))} />}
          </Labeled>
          <p className="small tm-assist-warn" role="note">{t('ui.persona.wizard.review.can')}</p>
          <p className="small muted">{t('ui.persona.wizard.review.next')}</p>
          <div className="wz-actions">
            <button type="button" className="btn" disabled={working || !state.draft.name.trim()} onClick={() => void perform('save')}>
              {busy === 'save' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.testIt')}
            </button>
            <button type="button" className="btn btn-dark" disabled={working || !state.draft.name.trim()} onClick={() => void perform('finish')}>
              {busy === 'finish' ? <span className="spinner" aria-hidden="true" /> : null} {finishLabel}
            </button>
          </div>
        </div>
      )}

      {state.step === 'test' && state.testId && (
        <div className="wz-stack">
          <p className="small muted">{t('ui.persona.wizard.test.hint')}</p>
          {testAgent ? (
            <div className="tm-assist-thread">
              <ChatThread thread={agentThreadId(state.testId)} persona={testAgent} team={team} compact />
            </div>
          ) : (
            <p className="small muted" role="status"><span className="spinner" aria-hidden="true" /> {t('ui.team.assist.test.preparing')}</p>
          )}
          {/* The remark goes into the next round: with none left there is nowhere for it to go. */}
          {roundsLeft(state) > 0 && (
            <Labeled label={t('ui.team.assist.note')} hint={t('ui.team.assist.note.hint')}>
              {(id) => <textarea id={id} className="text-input" rows={3} maxLength={ASSIST_LIMITS.note} disabled={working} value={state.note} onChange={(e) => apply((s) => ({ ...s, note: e.target.value }))} />}
            </Labeled>
          )}
          {roundsLeft(state) === 0 && <p className="small muted">{t('ui.persona.wizard.test.noRounds', { max: ASSIST_LIMITS.rounds })}</p>}
          <div className="wz-actions">
            {roundsLeft(state) > 0 && (
              <button type="button" className="btn" disabled={working} onClick={() => void perform('fromTest')}>
                {busy === 'fromTest' ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.assist.fromTest')}
              </button>
            )}
            <button type="button" className="btn" disabled={working} onClick={() => apply((s) => ({ ...s, step: 'review' }))}>{t('ui.team.assist.backToReview')}</button>
            <button type="button" className="btn btn-dark" disabled={working} onClick={() => void perform('finish')}>
              {busy === 'finish' ? <span className="spinner" aria-hidden="true" /> : null} {finishLabel}
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
    </>
  );

  if (presentation === 'panel') return <SidePanel label={title} onClose={requestClose}>{body}</SidePanel>;
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 820, gap: 16 }}>
        <header className="wz-screen-head">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.persona.wizard.screen.title')}</h1>
            <p className="muted" style={{ marginTop: 4 }}>{t('ui.persona.wizard.screen.lead')}</p>
          </div>
          <button type="button" className="cy-link wz-skip" disabled={busy === 'close'} onClick={requestClose}>{t('ui.persona.wizard.notNow')}</button>
        </header>
        <section className="panel" style={{ padding: 20, gap: 14 }} aria-label={title}>
          {body}
        </section>
      </div>
    </div>
  );
}
