import { useEffect, useState } from 'react';
import { CEREMONY_COMMANDS_EVENT, type CeremonyCommand, type CeremonyDecision } from '../../shared/ceremonyCommands';
import { api, errorText, moduleEvents } from './api';
import { useT } from './i18n';
import './ceremonyCommands.css';

// The commands a ceremony agent waits to run, on every screen: the call or the deep panel that asked is waiting for the answer. "Allow always" adds the rule
// shown to the agent; a command that writes to the code host can only be allowed once.
export function CeremonyCommands() {
  const t = useT();
  const [list, setList] = useState<CeremonyCommand[]>([]);
  useEffect(() => {
    const on = (e: Event) => setList((e as CustomEvent<CeremonyCommand[]>).detail ?? []);
    moduleEvents.addEventListener(CEREMONY_COMMANDS_EVENT, on);
    void api.invoke<CeremonyCommand[]>('ceremony:commands').then(setList, () => undefined);
    return () => moduleEvents.removeEventListener(CEREMONY_COMMANDS_EVENT, on);
  }, []);
  if (!list.length) return null;
  return (
    <div className="cc-stack" role="region" aria-label={t('ui.ceremonyCommand.region')}>
      {list.map((c) => (
        <Request key={c.id} item={c} onDone={(id) => setList((l) => l.filter((x) => x.id !== id))} />
      ))}
    </div>
  );
}

function Request({ item, onDone }: { item: CeremonyCommand; onDone: (id: string) => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = t(`cycle.team.system.${item.agent}.name`);
  const answer = (decision: CeremonyDecision) => {
    setBusy(true);
    setError(null);
    void api.invoke('ceremony:command', item.id, decision, decision === 'deny' ? note.trim() : '').then(
      () => onDone(item.id),
      (e) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  return (
    <section className={`cc-item ${item.write ? 'cc-write' : ''}`} aria-labelledby={`cc-${item.id}`}>
      <h2 id={`cc-${item.id}`} className="cc-title">{t('ui.ceremonyCommand.title', { agent: agent === `cycle.team.system.${item.agent}.name` ? item.agent : agent })}</h2>
      <pre className="cc-command">{item.command}</pre>
      {item.write && <p className="small">{t('ui.ceremonyCommand.writeNote')}</p>}
      <label className="small" htmlFor={`cc-note-${item.id}`}>{t('ui.ceremonyCommand.note')}</label>
      <input id={`cc-note-${item.id}`} className="text-input" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      <div className="row cc-actions">
        <button type="button" className="btn btn-dark" disabled={busy} onClick={() => answer('once')}>{t('ui.ceremonyCommand.once')}</button>
        {item.rule && (
          <button type="button" className="btn" disabled={busy} onClick={() => answer('always')} title={t('ui.ceremonyCommand.alwaysHint', { rule: item.rule })}>
            {t('ui.ceremonyCommand.always', { rule: item.rule })}
          </button>
        )}
        <button type="button" className="btn btn-red" disabled={busy} onClick={() => answer('deny')}>{t('ui.ceremonyCommand.deny')}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
