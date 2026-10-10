import { useT } from '../../i18n';

/**
 * What the agent wrote, set apart and named as the agent's: it is the agent's claim, and the app's own description beside it is what the app read. `more` is a second sentence of
 * the same hand (a hand-off's reason), kept in the same quote.
 */
export function AgentWords({ words, more }: { words: string | undefined; more?: string }) {
  const t = useT();
  if (!words) return null;
  return (
    <figure className="cy-ask-words">
      <figcaption className="faint small">{t('ui.screen.ask.agentWords')}</figcaption>
      <blockquote>
        {words}
        {more && <span className="cy-ask-more">{more}</span>}
      </blockquote>
    </figure>
  );
}
