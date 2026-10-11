import { useAnyLive } from '../../liveApi';
import { useT } from '../../i18n';
import { indicatorView } from '../../personaStopModel';
import { usePersonaState } from '../../personaStopApi';
import { StopControl } from './StopControl';
import './chat.css';

// The small indicator of the shell: on every screen but the chat, while the persona works or is stopped, with the same control as the chat's header.

export function PersonaIndicator({ screen }: { screen: string }) {
  const t = useT();
  const state = usePersonaState();
  const working = useAnyLive();
  const view = indicatorView({ state, working, screen });
  if (view === 'hidden') return null;
  return (
    <div className={`persona-indicator persona-indicator-${view}`} role="status">
      <span>{t(view === 'stopped' ? 'ui.persona.indicator.stopped' : 'ui.persona.indicator.working')}</span>
      <StopControl className="btn persona-indicator-btn" compact />
    </div>
  );
}
