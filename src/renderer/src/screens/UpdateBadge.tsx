import type { Screen } from '../App';
import { useT } from '../i18n';
import { useUpdatesStatus } from '../updateApi';

// In the top bar of Hoje: something to update (a release downloaded or being downloaded, or main ahead of the installed build).
// It opens Configurações at the Atualizações section, where the details and the button are.
export function UpdateBadge({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [status] = useUpdatesStatus();
  if (!status?.badge) return null;
  const open = () => {
    go({ name: 'settings' });
    // The settings screen mounts after this click: wait for it, then bring the section into view.
    setTimeout(() => document.getElementById('updates')?.scrollIntoView({ block: 'start' }), 120);
  };
  return (
    <button type="button" className="btn btn-accent" style={{ minHeight: 34 }} title={t('updates.badge.title')} onClick={open}>
      {t('updates.badge')}
    </button>
  );
}
