import { useState } from 'react';
import { api } from '../api';
import type { LlmRole } from '../../../shared/config/types';
import { showContinueInClaude } from '../../../shared/cycles/view';
import { useCycle } from '../cycleApi';
import { useT } from '../i18n';
import { isWeb } from '../platform';

// `role` is the agent role that ran the session: only the Claude engine keeps sessions `claude --resume` can read.
export function ContinueInClaude({ sessionId, prompt, label, dark = false, role = 'deep' }: { sessionId: string | null | undefined; prompt?: string; label?: string; dark?: boolean; role?: LlmRole }) {
  const t = useT();
  const cycle = useCycle();
  const [state, setState] = useState<string | null>(null);
  if (!sessionId || (cycle && !showContinueInClaude(cycle.host, role))) return null;
  const open = async () => {
    const r = await api.continueInClaude(sessionId, prompt);
    if (r.ok) setState(t('ui.continueInClaude.opening'));
    else setState(prompt ? t('ui.continueInClaude.invalidSessionOrPrompt') : t('ui.continueInClaude.invalidSession'));
    setTimeout(() => setState(null), 3000);
  };
  const copy = async () => {
    await api.copy(await api.invoke<string>('claude:command', sessionId, prompt));
    setState(t('ui.continueInClaude.copied'));
    setTimeout(() => setState(null), 2000);
  };
  const style = dark ? { background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' } : undefined;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      {!isWeb() && <button type="button" className="btn" style={style} title={prompt ? t('ui.continueInClaude.hintWithPrompt') : t('ui.continueInClaude.hint')} onClick={() => void open()}>
        {state ?? label ?? t('ui.continueInClaude.label')}
      </button>}
      <button type="button" className="btn icon-btn" style={style} aria-label={t('ui.continueInClaude.copyAria')} title={t('ui.continueInClaude.copy')} onClick={() => void copy()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
    </span>
  );
}
