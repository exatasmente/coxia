import { useEffect, useState } from 'react';
import { errorText } from '../api';
import { claudeSessionsApi } from '../claudeSessionsApi';
import { useT } from '../i18n';
import { isWeb } from '../platform';

// Settings › the switch of the machine's Claude Code sessions, off by default. Never rendered in a paired browser: every channel of the feature is the desktop window's.

export function ClaudeSessionsPanel({ enabled, onToggle }: { enabled: boolean; onToggle: (on: boolean) => void }) {
  const t = useT();
  return (
    <section className="panel" aria-labelledby="claude-sessions-title">
      <div>
        <h3 id="claude-sessions-title" className="wz-sub">{t('ui.settings.claude.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.claude.hint')}</p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={enabled} onChange={() => onToggle(!enabled)} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>{enabled ? t('ui.settings.claude.on') : t('ui.settings.claude.off')}</span>
        </span>
      </label>
    </section>
  );
}

export function ClaudeSessionsSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = isWeb();

  useEffect(() => {
    if (web) return;
    claudeSessionsApi.enabled().then((v) => setEnabled(v === true), (e) => setError(errorText(e)));
  }, [web]);

  if (web) return null;
  if (enabled === null) return error ? <div className="error" role="alert">{error}</div> : null;

  const toggle = async (on: boolean) => {
    setError(null);
    try {
      setEnabled(await claudeSessionsApi.setEnabled(on));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ClaudeSessionsPanel enabled={enabled} onToggle={(on) => void toggle(on)} />
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
