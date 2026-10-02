import { useState } from 'react';
import { useT } from './i18n';
import { isWeb } from './platform';
import { updateApi, useUpdatesStatus } from './updateApi';
import './update.css';

// A downloaded release waits for "Reiniciar para atualizar". It is only a prompt: nothing restarts by itself, and while a ceremony, a call or
// a job is running it stays out of the way (the badge in Hoje and Configurações › Atualizações still say it is ready).
export function UpdatePrompt() {
  const t = useT();
  const [status] = useUpdatesStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (isWeb() || !status || status.mode.mode !== 'release') return null;
  const { phase, version } = status.release;
  if (phase !== 'downloaded' || !version || dismissed === version || status.busy) return null;
  return (
    <div className="upd-toast upd-prompt" role="status" aria-live="polite">
      <span>{t('updates.prompt.ready', { version })}</span>
      <button type="button" className="upd-prompt-go" onClick={() => void updateApi.install().catch(() => undefined)}>{t('updates.release.restart')}</button>
      <button type="button" aria-label={t('updates.release.later')} onClick={() => setDismissed(version)}>×</button>
    </div>
  );
}
