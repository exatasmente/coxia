import { useMemo, useState } from 'react';
import { applyRecommendations, recommendations } from '../../../../shared/config/team';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { SHELL_LABEL, TRACKER_LABEL } from './labels';
import { useSandboxStatus } from './sandboxStatus';
import { agentNameById } from './text';
import type { SectionProps } from './ui';

/**
 * The permissions the roles of the shipped teams are recommended to have, for the agents whose own differ. It only offers: one button applies them all, and nothing is
 * changed by itself. Not shown in a paired browser, where raising permissions is refused.
 */
export function Recommended({ config, save }: Pick<SectionProps, 'config' | 'save'>) {
  const t = useT();
  const { status } = useSandboxStatus();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useMemo(() => (status ? recommendations(config, status.available) : []), [config, status]);
  if (!list.length) return null;
  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      await save(applyRecommendations(config, list));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel" aria-label={t('ui.team.rec.title')} style={{ padding: 16, gap: 8 }}>
      <strong>{t('ui.team.rec.title')}</strong>
      <p className="small muted">{t('ui.team.rec.hint')}</p>
      <ul className="tm-readonly-list">
        {list.map((r) => (
          <li key={r.id} className="small">
            {t('ui.team.rec.row', { name: agentNameById(config, r.id), fromTracker: t(TRACKER_LABEL[r.from.tracker]), toTracker: t(TRACKER_LABEL[r.tracker]), fromShell: t(SHELL_LABEL[r.from.shell]), toShell: t(SHELL_LABEL[r.shell]) })}
          </li>
        ))}
      </ul>
      {!status?.available && <p className="small muted">{t('ui.team.rec.noSandbox')}</p>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="wz-actions">
        <button type="button" className="btn btn-dark" disabled={saving} onClick={() => void apply()}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.rec.apply')}</button>
      </div>
    </section>
  );
}
