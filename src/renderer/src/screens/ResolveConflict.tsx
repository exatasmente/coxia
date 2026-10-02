import { useState } from 'react';
import type { Card, ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api } from '../api';
import { useCycle } from '../cycleApi';
import { conflictMrs } from '../dashboard';
import { useT } from '../i18n';
import { jobs, useJobs } from '../useJobs';

export type ConflictPlace = 'deep' | 'need' | 'act';

/** One "Resolver conflito" button per MR of the card that the report blocks for conflicts. Creates (or reuses) the resolution and opens it. */
export function ResolveConflict({ card, go, place, only, className = 'btn btn-amber' }: { card: Card; go: (s: Screen) => void; place: ConflictPlace; only?: string; className?: string }) { // i18n-ignore: class name
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const cycle = useCycle();
  const prefix = `conflictmr:${place}:${card.ref}:`;
  const running = useJobs<ReleaseAction>(prefix, {
    done: (a, _job, late) => {
      if (!late) go({ name: 'conflict', id: a.id });
    },
    failed: (e) => setError(e),
  });
  const mrs = conflictMrs(card).filter((m) => !only || m.ref === only);
  // The release and conflict ceremony is part of the cycle: a cycle without it has no conflict button.
  if (!mrs.length || cycle?.ceremonies.releaseConflicts === false) return null;

  const start = (ref: string) => {
    setError(null);
    jobs.launch(`${prefix}${ref}`, { label: t('ui.resolver.job.label', { ref }), busy: t('ui.resolver.job.busy'), screen: { name: 'deep', ref: card.ref, back: 'today', card } }, () => api.conflictFromMr(card, ref));
  };

  return (
    <>
      {mrs.map((m) => {
        const busy = running.some((j) => j.key === `${prefix}${m.ref}`);
        return (
          <button key={m.ref} type="button" className={className} disabled={busy} aria-label={t('ui.resolver.button.aria', { ref: m.ref })} onClick={() => start(m.ref)}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" /> {t('ui.resolver.button.preparing')}
              </>
            ) : mrs.length > 1 ? (
              t('ui.resolver.button.withRef', { ref: m.ref })
            ) : (
              t('ui.resolver.button.label')
            )}
          </button>
        );
      })}
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}
