import { useState } from 'react';
import { suggestionOf } from '../../../shared/suggestions';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { useT } from '../i18n';
import { blankAgent, slugOf, type AgentDraft } from './team/agentEdit';
import { openAgentDraft } from './team/teamNav';

// The three paths of a suggestion the cycle raised: accept creates an ordinary agent in the team; edit opens the agent editor in Settings › Team
// already filled in with it (saving it is what creates the agent); reject keeps the (optional) reason in the record. Nothing is applied silently.

export const isSuggestion = (a: ReleaseAction): boolean => a.kind === 'suggest-agent';

export function SuggestionCard({ a, go }: { a: ReleaseAction; go: (s: Screen) => void }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const open = a.state === 'pending' || a.state === 'failed';
  const suggestion = suggestionOf(a);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  if (!suggestion) return null;

  /** The draft the editor opens with: the name, role, stage and prompt the suggestion carries, and the permissions at the minimum. */
  const draft = (): AgentDraft => ({
    ...blankAgent(),
    id: slugOf(suggestion.name),
    name: suggestion.name,
    job: suggestion.role,
    instructions: suggestion.prompt,
    stages: suggestion.stage ? [suggestion.stage] : [],
  });

  const edit = () => {
    openAgentDraft(draft(), suggestion.suggestionId);
    go({ name: 'settings' });
  };

  return (
    <div className="wz-stack" style={{ gap: 8 }}>
      {open && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-dark" disabled={!!busy} onClick={() => run('accept', () => api.approveAction(a.id))}>
            {busy === 'accept' ? <span className="spinner" /> : null} {t('ui.actions.suggest.accept')}
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={edit}>{t('ui.actions.suggest.edit')}</button>
          {rejecting ? (
            <>
              <input className="text-input" style={{ maxWidth: 320 }} placeholder={t('ui.actions.suggest.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="button" className="btn btn-red" disabled={!!busy} onClick={() => void run('reject', () => api.invoke('suggestions:reject', suggestion.suggestionId, reason.trim() || null))}>
                {busy === 'reject' ? <span className="spinner" /> : null} {t('ui.actions.suggest.rejectConfirm')}
              </button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => setRejecting(false)}>{t('ui.actions.cancel')}</button>
            </>
          ) : (
            <button type="button" className="btn" disabled={!!busy} onClick={() => setRejecting(true)}>{t('ui.actions.suggest.reject')}</button>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
