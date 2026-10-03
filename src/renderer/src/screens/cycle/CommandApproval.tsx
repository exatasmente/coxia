import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { CommandDecision, Run } from '../../../../shared/runs';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { agentName } from './names';
import { patchRun, runsApi } from './runsApi';

/**
 * The command an agent set to `shell: host` waits to run, shown whole, with the three answers: this one, every one until the stage ends, or none (with a note the
 * agent reads). Nothing on the screen when no command waits.
 */
export function CommandApproval({ run, team }: { run: Run; team?: readonly AgentDef[] }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = run.command;
  if (!pending) return null;
  const answer = (decision: CommandDecision) => {
    setBusy(true);
    setError(null);
    void runsApi.command(run.id, pending.id, decision, decision === 'deny' ? note.trim() : '').then(
      (r) => {
        patchRun(r);
        setNote('');
        setBusy(false);
      },
      (e) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  const since = new Date(pending.since).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  return (
    <section className="cy-command" aria-labelledby={`cy-command-${pending.id}`}>
      <h3 id={`cy-command-${pending.id}`} className="cy-question-by">{t('ui.cycle.command.title', { agent: agentName(team, pending.agent) })}</h3>
      <pre className="cy-command-text">{pending.command}</pre>
      <p className="small muted">{t('ui.cycle.command.since', { time: since })}</p>
      <label className="small" htmlFor={`cy-command-note-${pending.id}`}>{t('ui.cycle.command.note')}</label>
      <input id={`cy-command-note-${pending.id}`} className="text-input" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      <div className="row cy-command-actions">
        <button type="button" className="btn btn-dark" disabled={busy} onClick={() => answer('once')}>{t('ui.cycle.command.once')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => answer('stage')}>{t('ui.cycle.command.stage')}</button>
        <button type="button" className="btn btn-red" disabled={busy} onClick={() => answer('deny')}>{t('ui.cycle.command.deny')}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
