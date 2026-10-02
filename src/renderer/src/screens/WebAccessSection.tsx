import { useEffect, useState } from 'react';
import type { WebSettings } from '../../../shared/settings';
import { type PairingCode, type WebView, pairingLink } from '../../../shared/webAccess';
import { api, errorText } from '../api';
import { intlLocale, tNodes, useT } from '../i18n';
import { isWeb } from '../platform';
import { webAccessApi } from '../webAccessApi';
import '../web.css';
import { QrCode } from './QrCode';

const stamp = (iso: string): string => new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Countdown({ until }: { until: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  return <>{left > 0 ? t('ui.webAccess.countdown.left', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : t('ui.webAccess.countdown.expired')}</>;
}

function DeviceRow({ id, name, createdAt, lastSeenAt, onRename, onRevoke }: { id: string; name: string; createdAt: string; lastSeenAt: string; onRename: (id: string, name: string) => void; onRevoke: (id: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="web-device">
      <div>
        {draft === null ? (
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
        ) : (
          <input className="text-input" aria-label={t('ui.webAccess.device.nameAria')} value={draft} maxLength={60} autoFocus onChange={(e) => setDraft(e.target.value)} />
        )}
        <div className="small muted">{t('ui.webAccess.device.seen', { created: stamp(createdAt), seen: stamp(lastSeenAt) })}</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {draft === null ? (
          <button type="button" className="btn" onClick={() => setDraft(name)}>{t('ui.webAccess.device.rename')}</button>
        ) : (
          <>
            <button type="button" className="btn" disabled={!draft.trim()} onClick={() => { onRename(id, draft); setDraft(null); }}>{t('ui.webAccess.device.saveName')}</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>{t('ui.webAccess.device.cancel')}</button>
          </>
        )}
        <button type="button" className="btn" onClick={() => onRevoke(id)}>{t('ui.webAccess.device.revoke')}</button>
      </div>
    </div>
  );
}

// Desktop window only: pairing, the device list and the web server settings. Applied on the spot, no Salvar needed.
export function WebAccessSection() {
  const t = useT();
  const [view, setView] = useState<WebView | null>(null);
  const [pair, setPair] = useState<PairingCode | null>(null);
  const [paired, setPaired] = useState(false);
  const [draft, setDraft] = useState<WebSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | null>(null);

  useEffect(() => {
    if (isWeb()) return;
    const load = () =>
      void webAccessApi.view().then((v) => {
        setView(v);
        // The code was used (or expired) on the server: the QR goes away.
        if (v.pairingExpiresAt === null) {
          setPair((p) => {
            if (p && p.expiresAt > Date.now()) setPaired(true);
            return null;
          });
        }
      }, (e) => setError(errorText(e)));
    load();
    const timer = setInterval(load, pair ? 2000 : 5000);
    return () => clearInterval(timer);
  }, [pair]);

  useEffect(() => {
    if (!pair) return;
    const timer = setTimeout(() => setPair(null), Math.max(0, pair.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pair]);

  // Leaving the screen invalidates the code that was on display.
  useEffect(() => {
    if (isWeb()) return;
    return () => void webAccessApi.cancelPair().catch(() => undefined);
  }, []);

  if (isWeb()) return null;

  const run = async (job: Promise<WebView>) => {
    setError(null);
    try {
      setView(await job);
      setDraft(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const generate = async () => {
    setError(null);
    setPaired(false);
    try {
      setPair(await webAccessApi.pair());
    } catch (e) {
      setError(errorText(e));
    }
  };

  const copyLink = async (link: string) => {
    await api.copy(link);
    setCopied('link');
    setTimeout(() => setCopied(null), 1800);
  };

  if (!view) return <section className="panel web-access" style={{ padding: 20 }}>{error ? <div className="error">{error}</div> : <span className="spinner" />}</section>;

  const { settings, status, devices } = view;
  const form = draft ?? settings;
  const patch = (change: Partial<WebSettings>) => setDraft({ ...form, ...change });
  const link = pair ? pairingLink(settings.publicUrl, pair.code) : '';

  return (
    <section className="panel web-access" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.webAccess.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          {t('ui.webAccess.hint')}
        </p>
      </div>
      {error && <div className="error">{error}</div>}

      <label className="check-row">
        <input type="checkbox" checked={settings.enabled} onChange={() => void run(webAccessApi.configure({ enabled: !settings.enabled }))} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.webAccess.enable.label')}</span>
          <span className="small muted">{t('ui.webAccess.enable.hint')}</span>
        </span>
      </label>

      {settings.enabled && (
        <>
          <div className={status.listening ? 'small' : 'error'} role="status" style={status.listening ? { color: 'var(--teal-ink)' } : undefined}>
            {status.message}
            {status.listening && ` ${t('ui.webAccess.connected', { count: status.clients })}`}
          </div>

          <div className="row">
            <button type="button" className="btn btn-dark" disabled={!status.listening} onClick={() => void generate()}>{t('ui.webAccess.pair.generate')}</button>
            <span className="small muted">{t('ui.webAccess.pair.validity')}</span>
          </div>
          {pair && (
            <div className="web-code-box" role="status">
              <div className="web-pair">
                <QrCode text={link} label={t('ui.webAccess.pair.qrLabel')} />
                <div className="web-pair-side">
                  <span style={{ fontWeight: 600 }}>{t('ui.webAccess.pair.scan')}</span>
                  <span className="small">{tNodes('ui.webAccess.pair.linkHint', { countdown: <Countdown until={pair.expiresAt} /> })}</span>
                  <div className="web-url">
                    <code>{link}</code>
                    <button type="button" className="btn" onClick={() => void copyLink(link)}>{copied === 'link' ? t('ui.webAccess.pair.copied') : t('ui.webAccess.pair.copyLink')}</button>
                  </div>
                  <span className="small">{t('ui.webAccess.pair.orOpen', { url: settings.publicUrl })}</span>
                  <span className="web-code-value">{pair.code}</span>
                </div>
              </div>
            </div>
          )}
          {paired && !pair && <div className="small" style={{ color: 'var(--teal-ink)' }} role="status">{t('ui.webAccess.pair.done')}</div>}

          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('ui.webAccess.devices.title')}</div>
            {devices.length === 0 && <p className="small muted">{t('ui.webAccess.devices.none')}</p>}
            {devices.map((d) => (
              <DeviceRow key={`${d.id}:${d.name}`} {...d} onRename={(id, name) => void run(webAccessApi.rename(id, name))} onRevoke={(id) => void run(webAccessApi.revoke(id))} />
            ))}
          </div>

          <label className="check-row">
            <input type="checkbox" checked={settings.allowExternalEffects} onChange={() => void run(webAccessApi.configure({ allowExternalEffects: !settings.allowExternalEffects }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.webAccess.effects.label')}</span>
              <span className="small muted">{t('ui.webAccess.effects.hint')}</span>
            </span>
          </label>

          <details>
            <summary>{t('ui.webAccess.advanced.title')}</summary>
            <div className="web-advanced" style={{ marginTop: 8 }}>
              <label>
                {t('ui.webAccess.advanced.host')}
                <input className="text-input mono" value={form.host} onChange={(e) => patch({ host: e.target.value.trim() })} />
              </label>
              <label>
                {t('ui.webAccess.advanced.port')}
                <input className="text-input mono" type="number" min={1024} max={65535} value={form.port} onChange={(e) => patch({ port: Number(e.target.value) })} />
              </label>
              <label>
                {t('ui.webAccess.advanced.basePath')}
                <input className="text-input mono" value={form.basePath} onChange={(e) => patch({ basePath: e.target.value.trim() })} />
              </label>
              <label>
                {t('ui.webAccess.advanced.trustedProxy')}
                <input className="text-input mono" value={form.trustedProxy} onChange={(e) => patch({ trustedProxy: e.target.value.trim() })} />
              </label>
              <label className="wide">
                {t('ui.webAccess.advanced.publicUrl')}
                <input className="text-input mono" value={form.publicUrl} onChange={(e) => patch({ publicUrl: e.target.value.trim() })} />
              </label>
              <div className="wide row">
                <button type="button" className="btn" disabled={!draft} onClick={() => draft && void run(webAccessApi.configure(draft))}>{t('ui.webAccess.advanced.apply')}</button>
                {draft && <button type="button" className="btn" onClick={() => setDraft(null)}>{t('ui.webAccess.advanced.discard')}</button>}
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
