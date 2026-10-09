import { useEffect, useState } from 'react';
import type { McpStateView } from '../../../shared/mcpState';
import { errorText, api } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';

// Settings › Configurações e workspaces › "Servidor de estado no terminal": the opt-in of the local state server, the setup entry a terminal
// session adds, and the person's confirmed merge write into a project folder's own .mcp.json. Never rendered in a paired browser: the channels
// are desktop-only and the view names machine-local paths. The toggling itself is the workspace config save the team screens do.

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

/** The view, once the workspace's answer is in: what the person reads and confirms, and nothing of the channels behind it. */
export function McpStatePanel({ shown, onToggle, onWrite }: { shown: McpStateView; onToggle: (enabled: boolean) => void; onWrite: (target: string) => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const entryBlock = shown.available && shown.entry ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="wz-label">{t('ui.settings.mcp.entry.title')}</div>
      <p className="small muted">{t('ui.settings.mcp.entry.hint', { workspaceId: shown.workspaceId })}</p>
      <pre
        style={{ fontFamily: 'var(--mono)', border: '1px solid var(--line-2)', padding: 10, borderRadius: 8, overflowX: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}
      >{shown.entry}</pre>
      {shown.path && <p className="small muted">{t('ui.settings.mcp.path.hint', { path: shown.path })}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void copyToClipboard(shown.entry ?? '').then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? t('ui.settings.mcp.copied') : t('ui.settings.mcp.copy')}
        </button>
        {shown.targets.map((target) => (
          <button key={target.path} type="button" className="btn" onClick={() => setConfirming(target.path)}>
            {target.exists ? t('ui.settings.mcp.writeAgain') : t('ui.settings.mcp.write')} · {target.path}
          </button>
        ))}
      </div>
      {!shown.targets.length && <p className="small muted">{t('ui.settings.mcp.noTargets')}</p>}
    </div>
  ) : (
    <p className="small muted">{t('ui.settings.mcp.unavailable')}</p>
  );

  return (
    <section className="panel" aria-labelledby="mcp-state-title">
      <div>
        <h3 id="mcp-state-title" className="wz-sub">{t('ui.settings.mcp.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.mcp.hint')}</p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={shown.enabled} onChange={() => onToggle(!shown.enabled)} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>{shown.enabled ? t('ui.settings.mcp.on') : t('ui.settings.mcp.off')}</span>
        </span>
      </label>
      {shown.enabled && <div style={{ marginTop: 10 }}>{entryBlock}</div>}
      {confirming && (
        <div className="error" role="alertdialog" aria-label={t('ui.settings.mcp.confirm.aria')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>{t('ui.settings.mcp.confirm.text', { file: confirming })}</div>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-dark"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                onWrite(target);
              }}
            >
              {t('ui.settings.mcp.confirm.yes')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(null)}>{t('ui.settings.mcp.confirm.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function McpStateSection() {
  const [view, setView] = useState<McpStateView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = isWeb();

  useEffect(() => {
    if (web) return;
    api
      .invoke('mcpstate:get')
      .then((v) => setView((v ?? null) as McpStateView | null), (e) => setError(errorText(e)));
  }, [web]);

  if (!view) return null;

  const toggle = async (enabled: boolean) => {
    setError(null);
    setMessage(null);
    try {
      setView((await api.invoke('mcpstate:set-enabled', enabled)) as McpStateView);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const write = async (target: string) => {
    setError(null);
    try {
      const r = (await api.invoke('mcpstate:write-entry', target)) as { status: 'written' | 'same'; file: string };
      setMessage(r.status === 'same' ? t('ui.settings.mcp.writeSame', { file: r.file }) : t('ui.settings.mcp.writeDone', { file: r.file }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <McpStatePanel shown={view} onToggle={(enabled) => void toggle(enabled)} onWrite={(target) => void write(target)} />
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="small muted">{message}</div>}
    </div>
  );
}
