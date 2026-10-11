import { useState } from 'react';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { controlOf } from '../../personaStopModel';
import { pressPersonaControl, usePersonaState } from '../../personaStopApi';

// The one control of the persona's Stop: Stop while it may act, Resume while it is stopped. In the chat's header on the computer and on the phone, in the indicator of the shell and
// in Settings. Pressing it halts the persona at once (the main process does the work before it answers).

/** `compact` draws the short word where there is no room (the phone's header); the accessible name stays the long one, which contains it. */
export function StopControl({ className = 'btn', compact = false }: { className?: string; compact?: boolean }) {
  const t = useT();
  const state = usePersonaState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const control = controlOf(state);

  const press = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await pressPersonaControl(control.action);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <>
      <button type="button" className={`${className} ${control.action === 'stop' ? 'persona-stop' : 'persona-resume'}`} disabled={busy} title={t(control.title)} aria-label={compact ? t(control.label) : undefined} onClick={() => void press()}>
        {t(compact ? control.short : control.label)}
      </button>
      {error && <span className="error small" role="alert">{error}</span>}
    </>
  );
}
