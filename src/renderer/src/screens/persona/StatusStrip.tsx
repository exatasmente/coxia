import type { Screen } from '../../App';
import { type HomeCounts, stripLabelKey, stripTarget } from '../../home';
import { useT } from '../../i18n';
import { useIsPhone } from '../../useIsPhone';

// Four counts under the header of the chat: what is blocked, what asks, what waits in Actions and what needs the person. The same counts the Overview shows (home.ts, one
// function), each a button that opens the Overview at its section or Actions. A zero is quiet and stays. No model is called to draw it.

export function StatusStrip({ counts, go }: { counts: HomeCounts; go: (s: Screen) => void }) {
  const t = useT();
  const phone = useIsPhone();
  const item = (key: keyof HomeCounts, tone: 'warn' | 'info', aria: string) => {
    const n = counts[key];
    return (
      <button key={key} type="button" className={`strip-item ${n > 0 ? `strip-${tone}` : ''}`} aria-label={aria} onClick={() => go(stripTarget(key))}>
        <span className="strip-n">{n}</span>
        <span className="strip-l">{t(stripLabelKey(key, phone))}</span>
      </button>
    );
  };
  return (
    <div className="chat-strip" role="group" aria-label={t('ui.chat.strip.label')}>
      {item('blocked', 'warn', t('ui.today.tiles.blockersAria', { count: counts.blocked }))}
      {item('asking', 'info', t('ui.today.tiles.questionsAria', { count: counts.asking }))}
      {item('actions', 'warn', t('ui.today.tiles.actionsAria', { count: counts.actions }))}
      {item('needs', 'warn', t('ui.chat.strip.needsAria', { count: counts.needs }))}
    </div>
  );
}
