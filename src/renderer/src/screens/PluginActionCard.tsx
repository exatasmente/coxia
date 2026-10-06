import { useEffect, useState } from 'react';
import { isPluginNeed, pluginAnswers, type PluginAnswer } from '../../../shared/plugins/grants';
import type { ReleaseAction } from '../../../shared/types';
import { api, errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';
import { pluginsApi } from '../pluginsApi';

// A plugin in Actions: a request the person answers (once, for the session, always, or refuse), or an allowed irreversible write announced until its
// deadline, which the person may block or take the permission of back. Neither is a write to "approve": the request is answered with how far the yes
// reaches, on the computer; a paired browser may only refuse a request or block a write, the two answers that take something away.

export const isPluginAction = (a: ReleaseAction): boolean => a.kind === 'plugin-ask' || a.kind === 'plugin-write';

const ANSWER_LABEL: Record<PluginAnswer, string> = {
  once: 'ui.actions.plugin.answer.once',
  session: 'ui.actions.plugin.answer.session',
  always: 'ui.actions.plugin.answer.always',
  refuse: 'ui.actions.plugin.answer.refuse',
};

const ASK_TITLE: Record<'network' | 'write', string> = {
  network: 'ui.actions.plugin.ask.title.network',
  write: 'ui.actions.plugin.ask.title.write',
};

const STATE_LABEL: Record<ReleaseAction['state'], string> = {
  pending: 'ui.actions.state.pending',
  running: 'ui.actions.state.running',
  done: 'ui.actions.state.done',
  skipped: 'ui.actions.state.skipped',
  failed: 'ui.actions.state.failed',
};

/** Seconds left until `due`, ticking every second while the card is shown. */
function useSecondsLeft(due: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!due) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [due]);
  if (!due) return null;
  const at = Date.parse(due);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

export function PluginActionCard({ a }: { a: ReleaseAction }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const web = isWeb();
  const unit = a.unit ?? {};
  const plugin = String(unit.name ?? unit.plugin ?? '');
  const to = String(unit.to ?? '');
  const need = isPluginNeed(unit.need) ? unit.need : 'network';
  const reversible = unit.reversible === true;
  const ask = a.kind === 'plugin-ask';
  const open = a.state === 'pending';
  const left = useSecondsLeft(!ask && open ? String(unit.due ?? '') : null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  const title = ask ? t(ASK_TITLE[need], { plugin }) : t('ui.actions.plugin.write.title', { plugin, to });
  const what = ask
    ? need === 'network'
      ? t('ui.actions.plugin.ask.what.network', { plugin, hosts: Array.isArray(unit.hosts) ? unit.hosts.join(', ') : '' })
      : t(reversible ? 'ui.actions.plugin.ask.what.write' : 'ui.actions.plugin.ask.what.writeIrreversible', { plugin, to })
    : t('ui.actions.plugin.write.what', { plugin, to });

  return (
    <section className="panel" style={{ padding: 20, gap: 12, borderColor: open ? 'var(--amber-line)' : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2>
        <span className={`badge ${a.state === 'done' ? 'badge-now' : a.state === 'failed' ? 'badge-block' : open ? 'badge-ask' : 'badge-quiet'}`}>{t(STATE_LABEL[a.state])}</span>
        {!ask && !reversible && <span className="badge badge-block">{t('ui.actions.plugin.irreversible')}</span>}
      </div>
      {a.issueTitle && <div className="small muted">{t('ui.actions.plugin.issue', { issue: a.issue, title: a.issueTitle })}</div>}
      <p className="small" style={{ lineHeight: 1.5 }}>{what}</p>
      {!ask && open && left !== null && <p className="small" role="status">{t('ui.actions.plugin.write.countdown', { count: left, seconds: left })}</p>}
      {a.output && <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 220, overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{a.output}</pre>}
      {error && <div className="error">{error}</div>}
      {open && ask && (
        <>
          {web && <p className="small muted">{t('ui.actions.plugin.ask.webNote')}</p>}
          <div className="row">
            {pluginAnswers(need, reversible)
              .filter((answer) => !web || answer === 'refuse')
              .map((answer) => (
                <button
                  key={answer}
                  type="button"
                  className={`btn ${answer === 'refuse' ? '' : answer === 'always' ? 'btn-dark' : ''}`}
                  disabled={busy}
                  onClick={() => void act(() => (web ? api.skipAction(a.id) : pluginsApi.answer(a.id, answer)))}
                >
                  {t(answer === 'always' && need === 'write' && !reversible ? 'ui.actions.plugin.answer.addToList' : ANSWER_LABEL[answer])}
                </button>
              ))}
          </div>
        </>
      )}
      {open && !ask && (
        <div className="row">
          <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void act(() => api.skipAction(a.id))}>{t('ui.actions.plugin.write.block')}</button>
          {!web && <button type="button" className="btn btn-red" disabled={busy} onClick={() => void act(() => pluginsApi.revokeWrite(a.id))}>{t('ui.actions.plugin.write.revoke')}</button>}
        </div>
      )}
      {a.state === 'running' && <div className="row faint"><span className="spinner" /> {t('ui.actions.busy.run')}</div>}
    </section>
  );
}
