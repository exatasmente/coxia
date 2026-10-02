import { useEffect, useState } from 'react';
import type { WebSettings } from '../../../shared/settings';
import { type PairingCode, type WebView, pairingLink } from '../../../shared/webAccess';
import { api, errorText, plural } from '../api';
import { isWeb } from '../platform';
import { webAccessApi } from '../webAccessApi';
import '../web.css';
import { QrCode } from './QrCode';

const stamp = (iso: string): string => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  return <>{left > 0 ? `vale por mais ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'expirou'}</>;
}

function DeviceRow({ id, name, createdAt, lastSeenAt, onRename, onRevoke }: { id: string; name: string; createdAt: string; lastSeenAt: string; onRename: (id: string, name: string) => void; onRevoke: (id: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="web-device">
      <div>
        {draft === null ? (
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</div>
        ) : (
          <input className="text-input" aria-label="Nome do aparelho" value={draft} maxLength={60} autoFocus onChange={(e) => setDraft(e.target.value)} />
        )}
        <div className="small muted">Pareado em {stamp(createdAt)} · visto por último em {stamp(lastSeenAt)}</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {draft === null ? (
          <button type="button" className="btn" onClick={() => setDraft(name)}>Renomear</button>
        ) : (
          <>
            <button type="button" className="btn" disabled={!draft.trim()} onClick={() => { onRename(id, draft); setDraft(null); }}>Salvar nome</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancelar</button>
          </>
        )}
        <button type="button" className="btn" onClick={() => onRevoke(id)}>Revogar</button>
      </div>
    </div>
  );
}

// Desktop window only: pairing, the device list and the web server settings. Applied on the spot, no Salvar needed.
export function WebAccessSection() {
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
    const t = setInterval(load, pair ? 2000 : 5000);
    return () => clearInterval(t);
  }, [pair]);

  useEffect(() => {
    if (!pair) return;
    const t = setTimeout(() => setPair(null), Math.max(0, pair.expiresAt - Date.now()));
    return () => clearTimeout(t);
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
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Acesso pelo navegador</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Usa o app de outro aparelho (celular, outro computador), instalado como PWA. Os comandos rodam aqui, neste computador. Vale na hora, sem precisar salvar.
        </p>
      </div>
      {error && <div className="error">{error}</div>}

      <label className="check-row">
        <input type="checkbox" checked={settings.enabled} onChange={() => void run(webAccessApi.configure({ enabled: !settings.enabled }))} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>Permitir acesso pelo navegador</span>
          <span className="small muted">Desligado, nada escuta na rede. Ligado, só entra quem tem um aparelho pareado.</span>
        </span>
      </label>

      {settings.enabled && (
        <>
          <div className={status.listening ? 'small' : 'error'} role="status" style={status.listening ? { color: 'var(--teal-ink)' } : undefined}>
            {status.message}
            {status.listening && ` ${plural(status.clients, 'aparelho conectado agora', 'aparelhos conectados agora')}.`}
          </div>

          <div className="row">
            <button type="button" className="btn btn-dark" disabled={!status.listening} onClick={() => void generate()}>Gerar código de pareamento</button>
            <span className="small muted">Vale 10 minutos e serve uma vez.</span>
          </div>
          {pair && (
            <div className="web-code-box" role="status">
              <div className="web-pair">
                <QrCode text={link} label="QR code de pareamento: abre o site já pareando este aparelho" />
                <div className="web-pair-side">
                  <span style={{ fontWeight: 600 }}>Escaneie com a câmera do celular</span>
                  <span className="small">O link abre o site e pareia na hora; <Countdown until={pair.expiresAt} />.</span>
                  <div className="web-url">
                    <code>{link}</code>
                    <button type="button" className="btn" onClick={() => void copyLink(link)}>{copied === 'link' ? 'Copiado' : 'Copiar link'}</button>
                  </div>
                  <span className="small">Ou abra {settings.publicUrl} e digite o código:</span>
                  <span className="web-code-value">{pair.code}</span>
                </div>
              </div>
            </div>
          )}
          {paired && !pair && <div className="small" style={{ color: 'var(--teal-ink)' }} role="status">Aparelho pareado.</div>}

          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Aparelhos pareados</div>
            {devices.length === 0 && <p className="small muted">Nenhum aparelho pareado.</p>}
            {devices.map((d) => (
              <DeviceRow key={`${d.id}:${d.name}`} {...d} onRename={(id, name) => void run(webAccessApi.rename(id, name))} onRevoke={(id) => void run(webAccessApi.revoke(id))} />
            ))}
          </div>

          <label className="check-row">
            <input type="checkbox" checked={settings.allowExternalEffects} onChange={() => void run(webAccessApi.configure({ allowExternalEffects: !settings.allowExternalEffects }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>Permitir ações com efeito externo pelo navegador</span>
              <span className="small muted">Aprovar ações de release e de GitLab (escrita no GitLab, push). Desligado, só a janela do app aprova. Continuar no Claude Code e as configurações deste acesso nunca funcionam pelo navegador.</span>
            </span>
          </label>

          <details>
            <summary>Avançado</summary>
            <div className="web-advanced" style={{ marginTop: 8 }}>
              <label>
                Endereço de escuta
                <input className="text-input mono" value={form.host} onChange={(e) => patch({ host: e.target.value.trim() })} />
              </label>
              <label>
                Porta
                <input className="text-input mono" type="number" min={1024} max={65535} value={form.port} onChange={(e) => patch({ port: Number(e.target.value) })} />
              </label>
              <label>
                Caminho
                <input className="text-input mono" value={form.basePath} onChange={(e) => patch({ basePath: e.target.value.trim() })} />
              </label>
              <label>
                Proxy confiável (CIDR)
                <input className="text-input mono" value={form.trustedProxy} onChange={(e) => patch({ trustedProxy: e.target.value.trim() })} />
              </label>
              <label className="wide">
                Endereço público
                <input className="text-input mono" value={form.publicUrl} onChange={(e) => patch({ publicUrl: e.target.value.trim() })} />
              </label>
              <div className="wide row">
                <button type="button" className="btn" disabled={!draft} onClick={() => draft && void run(webAccessApi.configure(draft))}>Aplicar</button>
                {draft && <button type="button" className="btn" onClick={() => setDraft(null)}>Descartar</button>}
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
