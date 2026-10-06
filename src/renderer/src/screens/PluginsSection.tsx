import { useEffect, useState } from 'react';
import type { PluginNeed } from '../../../shared/plugins/grants';
import type { PluginView, PluginsView } from '../../../shared/plugins/view';
import { errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';
import { pluginsApi } from '../pluginsApi';

// The plugins of this workspace, in one list: where they are read from, what each offers, what it asks for, what it was allowed and whether it is on.
// Switching a plugin, changing the folder or the deadline of the warning and taking a permission back are the computer's: a paired browser only reads.

const EVENT_KEY: Record<string, string> = {
  'stage-entered': 'ui.plugins.event.stageEntered',
  'stage-finished': 'ui.plugins.event.stageFinished',
  'gate-decided': 'ui.plugins.event.gateDecided',
  'run-finished': 'ui.plugins.event.runFinished',
};

/** What a plugin was allowed, per need and reach (always, this session, or nothing: it asks every time). */
const ALLOWED_KEY: Record<PluginNeed, Record<'always' | 'session' | 'none', string>> = {
  network: { always: 'ui.plugins.allowed.network.always', session: 'ui.plugins.allowed.network.session', none: 'ui.plugins.allowed.network.none' },
  write: { always: 'ui.plugins.allowed.write.always', session: 'ui.plugins.allowed.write.session', none: 'ui.plugins.allowed.write.none' },
};

function Permission({ p, need, web, revoke }: { p: PluginView; need: PluginNeed; web: boolean; revoke: (need: PluginNeed) => void }) {
  const t = useT();
  const reach = p.allow[need] ? 'always' : p.session[need] ? 'session' : null;
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="small">{t(ALLOWED_KEY[need][reach ?? 'none'])}</span>
      {reach && !web && (
        <button type="button" className="btn" onClick={() => revoke(need)}>
          {t('ui.plugins.revoke')}
        </button>
      )}
    </div>
  );
}

function PluginItem({ p, web, onChange, onError }: { p: PluginView; web: boolean; onChange: (v: PluginsView) => void; onError: (message: string) => void }) {
  const t = useT();
  const run = (fn: () => Promise<PluginsView>) =>
    void fn()
      .then(onChange)
      .catch((e) => onError(errorText(e)));
  return (
    <div className="panel" style={{ padding: 14, gap: 8 }}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{p.name}</div>
          <div className="small faint mono" style={{ overflowWrap: 'anywhere' }}>{p.id || p.folder}</div>
        </div>
        <span className={`badge ${p.refused ? 'badge-block' : p.enabled ? 'badge-now' : 'badge-quiet'}`}>{t(p.refused ? 'ui.plugins.state.refused' : p.enabled ? 'ui.plugins.state.on' : 'ui.plugins.state.off')}</span>
      </div>
      {p.refused ? (
        <p className="small error">{t('ui.plugins.refusedReason', { reason: p.refused })}</p>
      ) : (
        <>
          <label className="check-row">
            <input type="checkbox" checked={p.enabled} disabled={web} onChange={() => run(() => pluginsApi.setEnabled(p.id, !p.enabled))} />
            <span>{t('ui.plugins.enabled')}</span>
          </label>
          <p className="small muted">
            {t('ui.plugins.observes', { events: p.events.map((e) => t(EVENT_KEY[e] ?? e)).join(', ') || t('ui.plugins.nothing') })}
            {p.documents.length > 0 && ` · ${t('ui.plugins.documents', { names: p.documents.map((d) => d.name).join(', ') })}`}
          </p>
          <div className="small">
            {p.network.length ? t('ui.plugins.asks.network', { hosts: p.network.join(', ') }) : t('ui.plugins.asks.noNetwork')}
          </div>
          {p.network.length > 0 && <Permission p={p} need="network" web={web} revoke={(need) => run(() => pluginsApi.revoke(p.id, need))} />}
          <div className="small">
            {p.write ? t(p.write.reversible ? 'ui.plugins.asks.write' : 'ui.plugins.asks.writeIrreversible', { to: p.write.to }) : t('ui.plugins.asks.noWrite')}
          </div>
          {p.write && <Permission p={p} need="write" web={web} revoke={(need) => run(() => pluginsApi.revoke(p.id, need))} />}
          {p.waiting > 0 && <p className="small" role="status">{t('ui.plugins.waiting', { count: p.waiting })}</p>}
        </>
      )}
    </div>
  );
}

export function PluginsSection() {
  const t = useT();
  const web = isWeb();
  const [view, setView] = useState<PluginsView | null>(null);
  const [dir, setDir] = useState('');
  const [seconds, setSeconds] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const show = (v: PluginsView) => {
    setView(v);
    setDir(v.dir);
    setSeconds(String(v.confirmSeconds));
  };

  useEffect(() => {
    pluginsApi.list().then(show).catch((e) => setError(errorText(e)));
  }, []);

  const save = async () => {
    setError(null);
    setMessage(null);
    try {
      show(await pluginsApi.settings(dir, Number(seconds)));
      setMessage(t('ui.plugins.saved'));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.plugins.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.plugins.hint')}</p>
        {web && <p className="small muted">{t('ui.plugins.webNote')}</p>}
      </div>
      <div className="settings-row">
        <label htmlFor="plugins-dir" style={{ fontWeight: 600 }}>{t('ui.plugins.dir')}</label>
        <input id="plugins-dir" className="text-input mono" value={dir} disabled={web} onChange={(e) => setDir(e.target.value)} />
      </div>
      <div className="settings-row">
        <label htmlFor="plugins-seconds" style={{ fontWeight: 600 }}>{t('ui.plugins.confirmSeconds')}</label>
        <input id="plugins-seconds" className="text-input" type="number" min={5} max={3600} value={seconds} disabled={web} onChange={(e) => setSeconds(e.target.value)} />
      </div>
      <p className="small muted">{t('ui.plugins.confirmSecondsHint')}</p>
      {!web && (
        <div className="row">
          <button type="button" className="btn btn-dark" disabled={!view || (dir === view.dir && seconds === String(view.confirmSeconds))} onClick={() => void save()}>
            {t('ui.plugins.save')}
          </button>
          {message && <span className="small muted">{message}</span>}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {view && !view.plugins.length && <p className="small muted">{t('ui.plugins.empty')}</p>}
      {view?.plugins.map((p) => <PluginItem key={p.id || p.folder} p={p} web={web} onChange={show} onError={setError} />)}
    </section>
  );
}
