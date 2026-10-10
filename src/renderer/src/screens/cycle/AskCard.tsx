import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { ASK_TIMEOUT_MS, type AskDecision, type PendingAsk } from '../../../../shared/browser';
import { HANDOFF_ASK_MS } from '../../../../shared/handoff';
import { describeStep } from '../../../../shared/stepWords';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { useExternalEffects } from '../../useExternalEffects';
import { AgentWords } from './AgentWords';
import { CONFIRM_KIND_KEY, WHY_KEY, choicesOf } from './askView';
import { HandoffActions, HandoffBody } from './HandoffCard';
import { agentName } from './names';
import { screenApi } from './screenApi';

// A question the app's screen asks the person: a step the app holds before an irreversible act, or a confirmation an agent asked for. The card says what is about to happen in the
// app's own words (read from the page), why it was held, and, marked as the agent's own, what the agent wrote. The computer answers; a paired browser only with the switch for
// actions with external effects, and otherwise it is shown the question and told where to answer. One body per kind of question, so a kind added later adds a body.

const DECISION_KEY: Record<AskDecision, string> = {
  yes: 'ui.screen.ask.yes',
  no: 'ui.screen.ask.no',
  site: 'ui.screen.ask.site',
};

/** What the card says of the question itself, by kind. */
function AskBody({ ask, team }: { ask: PendingAsk; team: readonly AgentDef[] | undefined }) {
  const t = useT();
  const agent = agentName(team, ask.agent);
  if (ask.kind === 'confirm') {
    return (
      <>
        <p className="cy-ask-line">{t('ui.screen.ask.confirm', { agent, kind: t(CONFIRM_KIND_KEY[ask.confirmKind ?? 'other']) })}</p>
        {ask.site && <p className="faint small">{t('ui.screen.ask.onSite', { site: ask.site })}</p>}
        <AgentWords words={ask.agentWords} />
      </>
    );
  }
  if (ask.kind === 'hold') {
    return (
      <>
        <p className="cy-ask-line">{t('ui.screen.ask.hold', { agent, step: ask.step ? describeStep(ask.step, ask.site, t) : '' })}</p>
        <p className="faint small">{t('ui.screen.ask.why', { why: t(WHY_KEY[ask.why]) })}</p>
        <AgentWords words={ask.agentWords} />
      </>
    );
  }
  if (ask.kind === 'handoff') return <HandoffBody ask={ask} team={team} />;
  return null;
}

/** `answerable` false: the card shows the question and says where to answer it; null: the switch is not known yet, and nothing is offered. */
export function AskCard({ ask, team, answerable, onWatch }: { ask: PendingAsk; team: readonly AgentDef[] | undefined; answerable: boolean | null; onWatch?: (key: string) => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = agentName(team, ask.agent);
  const choices = choicesOf(ask);
  const send = (decision: AskDecision): void => {
    setBusy(true);
    setError(null);
    void screenApi.answer(ask.id, decision, decision === 'no' && note.trim() ? note.trim() : undefined).then(
      (r) => {
        if (r.ok) setSent(true);
        else setError(t(r.reason === 'gone' ? 'ui.screen.ask.gone' : 'ui.screen.ask.refused'));
        setBusy(false);
      },
      (e: unknown) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  const since = new Date(ask.since).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <section className="cy-ask" role="group" aria-label={t('ui.screen.ask.label', { agent })} data-kind={ask.kind}>
      <h3 className="cy-ask-title">{t('ui.screen.ask.title', { agent })}</h3>
      <AskBody ask={ask} team={team} />
      {/* A taken hand-off has no wait left to count: the person has the screen. */}
      {!(ask.kind === 'handoff' && ask.handoff?.taken) && (
        <p className="faint small">{ask.kind === 'handoff' ? t('ui.screen.handoff.since', { time: since, minutes: Math.round(HANDOFF_ASK_MS / 60_000) }) : t('ui.screen.ask.since', { time: since, minutes: Math.round(ASK_TIMEOUT_MS / 60_000) })}</p>
      )}
      {ask.kind === 'handoff' ? (
        // Declining is open to a paired browser and needs no switch; taking and giving back are the computer's.
        <HandoffActions ask={ask} team={team} onWatch={onWatch} />
      ) : sent ? (
        <p className="small" role="status">{t('ui.screen.ask.sent')}</p>
      ) : answerable ? (
        <>
          {choices.includes('no') && (
            <label className="small cy-ask-note">
              {t('ui.screen.ask.note')}
              <input className="text-input" value={note} maxLength={500} disabled={busy} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          <div className="row cy-ask-actions">
            {choices.map((d) => (
              <button key={d} type="button" className={`btn ${d === 'yes' ? 'btn-dark' : d === 'no' ? 'btn-red' : ''}`} disabled={busy} onClick={() => send(d)}>
                {t(DECISION_KEY[d], { site: ask.site })}
              </button>
            ))}
            {onWatch && <button type="button" className="btn cy-mini" onClick={() => onWatch(ask.key)}>{t('ui.screen.watch')}</button>}
          </div>
          {choices.includes('site') && <p className="faint small">{t('ui.screen.ask.siteHint')}</p>}
        </>
      ) : (
        <>
          {answerable === false && <p className="small cy-ask-computer" role="note">{t('ui.screen.ask.computerOnly')}</p>}
          {onWatch && <div className="row cy-ask-actions"><button type="button" className="btn cy-mini" onClick={() => onWatch(ask.key)}>{t('ui.screen.watch')}</button></div>}
        </>
      )}
      {error && <p className="small error" role="alert">{error}</p>}
    </section>
  );
}

/** The questions waiting in a conversation or in a viewer, each as a card; nothing at all while none waits. */
export function AskCards({ asks, team, onWatch }: { asks: readonly PendingAsk[]; team: readonly AgentDef[] | undefined; onWatch?: (key: string) => void }) {
  const t = useT();
  // True on the computer; in a paired browser the switch for actions with external effects, null until the server has said.
  const answerable = useExternalEffects();
  if (asks.length === 0) return null;
  return (
    <div className="cy-asks" role="region" aria-label={t('ui.screen.ask.list')}>
      {asks.map((a) => <AskCard key={a.id} ask={a} team={team} answerable={answerable} onWatch={onWatch} />)}
    </div>
  );
}
