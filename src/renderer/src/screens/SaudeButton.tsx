import { useEffect, useState } from 'react';
import type { ErrorsSummary } from '../../../shared/errorlog';
import type { SaudeSnapshot } from '../../../shared/saude';
import type { Screen } from '../App';
import { errorsApi } from '../errorsApi';
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
  if (b.problems) parts.push(`${b.problems} problema(s) nas tarefas ou dependências`);
  if (b.errors) parts.push(`${b.errors} erro(s) novo(s) nas últimas 24 h`);
  return parts.join('; ');
}

export function SaudeButton({ go }: { go: (s: Screen) => void }) {
  const badge = useSaudeBadge();
  return (
    <button
      type="button"
      className={`btn ${badge.total ? 'btn-amber' : ''}`}
      style={{ minHeight: 34 }}
      title={badge.total ? badgeTitle(badge) : 'Erros, tarefas e dependências do app'}
      onClick={() => go({ name: 'saude' })}
    >
      Saúde{badge.total ? ` · ${badge.total}` : ''}
    </button>
  );
}
