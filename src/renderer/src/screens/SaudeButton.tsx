import { useEffect, useState } from 'react';
import type { ErrorsSummary } from '../../../shared/errorlog';
import type { SaudeSnapshot } from '../../../shared/saude';
import type { Screen } from '../App';
import { errorsApi } from '../errorsApi';
import { t, useT } from '../i18n';
import { saudeApi } from '../saudeApi';

export interface SaudeBadge {
  problems: number;
  // Distinct errors of the last 24 h that the person has not seen in Saúde yet.
  errors: number;
  total: number;
}

export function useSaudeBadge(): SaudeBadge {
  const [snap, setSnap] = useState<SaudeSnapshot | null>(null);
  const [errors, setErrors] = useState<ErrorsSummary | null>(null);
  useEffect(() => {
    void saudeApi.get().then(setSnap);
    return saudeApi.onChanged(setSnap);
  }, []);
  useEffect(() => {
    void errorsApi.summary().then(setErrors, () => {});
    return errorsApi.onChanged(setErrors);
  }, []);
  const problems = snap?.problems ?? 0;
  const unseen = errors?.unseen ?? 0;
  return { problems, errors: unseen, total: problems + unseen };
}

export function badgeTitle(b: SaudeBadge): string {
  const parts = [];
  if (b.problems) parts.push(t('ui.health.badge.problems', { count: b.problems }));
  if (b.errors) parts.push(t('ui.health.badge.errors', { count: b.errors }));
  return parts.join('; ');
}

export function SaudeButton({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const badge = useSaudeBadge();
  return (
    <button
      type="button"
      className={`btn ${badge.total ? 'btn-amber' : ''}`}
      style={{ minHeight: 34 }}
      title={badge.total ? badgeTitle(badge) : t('ui.health.button.title')}
      onClick={() => go({ name: 'saude' })}
    >
      {badge.total ? t('ui.nav.healthCount', { count: badge.total }) : t('ui.nav.health')}
    </button>
  );
}
