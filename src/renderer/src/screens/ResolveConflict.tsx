import { useState } from 'react';
import type { Card, ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api } from '../api';
import { conflictMrs } from '../dashboard';
import { jobs, useJobs } from '../useJobs';

export type ConflictPlace = 'deep' | 'need' | 'act';

/** One "Resolver conflito" button per MR of the card that the report blocks for conflicts. Creates (or reuses) the resolution and opens it. */
export function ResolveConflict({ card, go, place, only, className = 'btn btn-amber' }: { card: Card; go: (s: Screen) => void; place: ConflictPlace; only?: string; className?: string }) {
  const [error, setError] = useState<string | null>(null);
  const prefix = `conflictmr:${place}:${card.ref}:`;
  const running = useJobs<ReleaseAction>(prefix, {
    done: (a, _job, late) => {
      if (!late) go({ name: 'conflict', id: a.id });
    },
    failed: (e) => setError(e),
  });
  const mrs = conflictMrs(card).filter((m) => !only || m.ref === only);
  if (!mrs.length) return null;

  const start = (ref: string) => {
    setError(null);
    jobs.launch(`${prefix}${ref}`, { label: `Conflito do ${ref}`, busy: 'Lendo o MR no GitLab…', screen: { name: 'deep', ref: card.ref, back: 'today', card } }, () => api.conflictFromMr(card, ref));
  };

  return (
    <>
      {mrs.map((m) => {
        const busy = running.some((j) => j.key === `${prefix}${m.ref}`);
        return (
          <button key={m.ref} type="button" className={className} disabled={busy} aria-label={`Resolver o conflito do ${m.ref}`} onClick={() => start(m.ref)}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Preparando…
              </>
            ) : mrs.length > 1 ? (
              `Resolver conflito · ${m.ref}`
            ) : (
              'Resolver conflito'
            )}
          </button>
        );
      })}
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}
