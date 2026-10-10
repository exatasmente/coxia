import type { PendingAsk } from '../../../../shared/browser';
import { composeWarning } from '../../../../shared/handoff';
import { useT } from '../../i18n';

// What the person reads before anything they type is sent (#178), in place of the control switch. The lines are composed from what this agent has (the app's browser, a shell in the
// sandbox or on the computer, or none), so each guarantee is said only where it holds, and the weaker one is said as weaker. It is shown on every hand-off: nothing remembers a
// "do not show again". Nothing is sent to the screen until the button is clicked.

// The keys composeWarning can give, each written out where a search finds it (it builds them from a prefix); a line it names that is not here is not shown.
const KNOWN = new Set<string>([
  'ui.screen.handoff.warning.always',
  'ui.screen.handoff.warning.recorded',
  'ui.screen.handoff.warning.browser',
  'ui.screen.handoff.warning.programs',
  'ui.screen.handoff.warning.programsHost',
  'ui.screen.handoff.warning.noPrograms',
  'ui.screen.handoff.warning.last',
]);

export function HandoffWarning({ ask, busy, onTake, onDecline }: { ask: PendingAsk; busy: boolean; onTake: () => void; onDecline: () => void }) {
  const t = useT();
  const lines = composeWarning(ask.handoff?.paths ?? { browser: false, shell: 'none' }).filter((key) => KNOWN.has(key));
  return (
    <section className="cy-handoff-warning" role="group" aria-label={t('ui.screen.handoff.warning.title')}>
      <h3 className="cy-handoff-warning-title">{t('ui.screen.handoff.warning.title')}</h3>
      {ask.agentWords && <p className="small cy-handoff-warning-what">{t('ui.screen.handoff.warning.asks', { what: ask.agentWords })}</p>}
      <ul className="cy-handoff-warning-list">
        {lines.map((key) => <li key={key} data-line={key.slice(key.lastIndexOf('.') + 1)}>{t(key)}</li>)}
      </ul>
      <div className="row cy-ask-actions">
        <button type="button" className="btn btn-dark" disabled={busy} onClick={onTake}>{t('ui.screen.handoff.understand')}</button>
        <button type="button" className="btn btn-red" disabled={busy} onClick={onDecline}>{t('ui.screen.handoff.decline')}</button>
      </div>
    </section>
  );
}
