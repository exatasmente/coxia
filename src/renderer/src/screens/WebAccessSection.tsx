import { useEffect, useState } from 'react';
import type { WebSettings } from '../../../shared/settings';
import type { PairingCode, WebView } from '../../../shared/webAccess';
import { api, errorText, plural } from '../api';
import { isWeb } from '../platform';
import { webAccessApi } from '../webAccessApi';
import '../web.css';

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

// Desktop window only: pairing, the device list and the web server settings. Applied on the spot, no Salvar needed.
export function WebAccessSection() {
  const [view, setView] = useState<WebView | null>(null);
  const [pair, setPair] = useState<PairingCode | null>(null);
  const [draft, setDraft] = useState<WebSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isWeb()) return;
    const load = () => void webAccessApi.view().then(setView, (e) => setError(errorText(e)));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
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
    try {
      setPair(await webAccessApi.pair());
    } catch (e) {
      setError(errorText(e));
    }
  };

  const copyUrl = async (url: string) => {
    await api.copy(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!view) return <section className="panel web-access" style={{ padding: 20 }}>{error ? <div className="error">{error}</div> : <span className="spinner" />}</section>;

  const { settings, status, devices } = view;
  const form = draft ?? settings;
  const patch = (change: Partial<WebSettings>) => setDraft({ ...form, ...change });
  const pairingLive = pair && pair.expiresAt > Date.now();

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
          <div className="web-url">
            <code>{settings.publicUrl}</code>
            <button type="button" className="btn" onClick={() => void copyUrl(settings.publicUrl)}>{copied ? 'Copiado' : 'Copiar endereço'}</button>
          </div>

          <div className="row">
            <button type="button" className="btn btn-dark" disabled={!status.listening} onClick={() => void generate()}>Gerar código de pareamento</button>
            <span className="small muted">Vale 10 minutos e serve uma vez.</span>
          </div>
          {pairingLive && (
            <div className="web-code-box" role="status">
              <span className="web-code-value">{pair.code}</span>
              <span className="small">Digite no aparelho novo; <Countdown until={pair.expiresAt} />.</span>
            </div>
          )}

          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Aparelhos pareados</div>
            {devices.length === 0 && <p className="small muted">Nenhum aparelho pareado.</p>}
            {devices.map((d) => (
              <div key={d.id} className="web-device">
                <div>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{d.name}</div>
                  <div className="small muted">Pareado em {stamp(d.createdAt)} · visto por último em {stamp(d.lastSeenAt)}</div>
                </div>
                <button type="button" className="btn" onClick={() => void run(webAccessApi.revoke(d.id))}>Revogar</button>
              </div>
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
