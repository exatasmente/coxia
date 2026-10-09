import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { PendingAsk } from '../../../../shared/browser';
import type { HandoffAnswer } from '../../../../shared/handoff';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { AgentWords } from './AgentWords';
import { agentName } from './names';
import { screenApi } from './screenApi';

// The agent's request to hand its screen over (#178), as a card where the agent works. The words are the agent's (what it needs, and why), shown as its own. The computer takes
// the screen (the viewer opens on the warning), gives it back and declines; a paired browser only declines, since taking and giving back are on the `screen:` family the web
// policy refuses, and it is told the agent waits on the computer. Declining takes no switch: it gives the agent nothing and takes nothing from the person.

/** What the card says of the request: who asks, and the agent's words. */
export function HandoffBody({ ask, team }: { ask: PendingAsk; team: readonly AgentDef[] | undefined }) {
  const t = useT();
  const agent = agentName(team, ask.agent);
  return (
    <>
      <p className="cy-ask-line">{t('ui.screen.handoff.line', { agent })}</p>
      <AgentWords words={ask.agentWords} more={ask.handoff?.why} />
    </>
  );
}

export const REFUSAL_KEY: Record<'gone' | 'taken' | 'none', string> = {
  gone: 'ui.screen.handoff.gone',
  taken: 'ui.screen.handoff.alreadyTaken',
  none: 'ui.screen.ended',
};

/** The buttons of the card, by where the person is and whether the screen is taken. */
export function HandoffActions({ ask, team, onWatch }: { ask: PendingAsk; team: readonly AgentDef[] | undefined; onWatch?: (key: string) => void }) {
  const t = useT();
  const web = isWeb();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taken = ask.handoff?.taken === true;
  const agent = agentName(team, ask.agent);
  const run = (call: () => Promise<HandoffAnswer>): void => {
    setBusy(true);
    setError(null);
    void call().then(
      (r) => {
        if (r.ok) setSent(true);
        else setError(t(REFUSAL_KEY[r.reason]));
        setBusy(false);
      },
      (e: unknown) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  const decline = (): void => run(() => screenApi.handoffDecline(ask.id));
  const giveBack = (): void => run(() => screenApi.handoffGive(ask.key));
  return (
    <>
      {web ? (
        <p className="small cy-ask-computer" role="note">{t(taken ? 'ui.screen.handoff.takenWeb' : 'ui.screen.handoff.computerOnly')}</p>
      ) : taken && <p className="small cy-ask-computer" role="note">{t('ui.screen.handoff.taken', { agent })}</p>}
      {sent ? (
        <p className="small" role="status">{t('ui.screen.ask.sent')}</p>
      ) : (
        <div className="row cy-ask-actions">
          {!web && !taken && onWatch && <button type="button" className="btn btn-dark" disabled={busy} onClick={() => onWatch(ask.key)}>{t('ui.screen.handoff.take')}</button>}
          {!web && taken && <button type="button" className="btn btn-dark" disabled={busy} onClick={giveBack}>{t('ui.screen.handoff.giveBack')}</button>}
          {!web && taken && onWatch && <button type="button" className="btn cy-mini" onClick={() => onWatch(ask.key)}>{t('ui.screen.watch')}</button>}
          {!taken && <button type="button" className="btn btn-red" disabled={busy} onClick={decline}>{t('ui.screen.handoff.decline')}</button>}
        </div>
      )}
      {error && <p className="small error" role="alert">{error}</p>}
    </>
  );
}
