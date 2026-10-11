import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BranchHealth, RadarResult, WorktreeHealth } from '../../../shared/radar';
import type { Screen } from '../App';
import { api, moduleEvents } from '../api';
import { t, useT } from '../i18n';

// One shared load for every row of Today: the git scan walks all repositories and worktrees.
let health: WorktreeHealth | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function refreshHealth(): Promise<void> {
  loading ??= api
    .invoke<WorktreeHealth>('worktrees:health')
    .then((h) => {
      health = h;
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
      listeners.forEach((l) => l());
    });
  return loading;
}

export function useWorktreeHealth(): WorktreeHealth | null {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => health,
  );
  useEffect(() => {
    if (!health) void refreshHealth();
  }, []);
  return value;
}

export function describeBranch(b: BranchHealth): string {
  const parts: string[] = [];
  if (b.dirty) parts.push(t('ui.radar.uncommitted', { count: b.dirty }));
  if (b.unpushed) parts.push(t(b.hasUpstream ? 'ui.radar.unpushedCommits' : 'ui.radar.unpushedCommitsNoRemote', { count: b.unpushed }));
  if (b.conventionNote) parts.push(t('ui.radar.offConvention', { note: b.conventionNote }));
  return `${b.repo} · ${b.branch}: ${parts.join('; ')}`;
}

/** The radar's last scan as counts: every finding, and the urgent ones (the same fix made twice). `ran` is false until a scan exists. */
export function useRadarCount(): { ran: boolean; total: number; urgent: number } {
  const [result, setResult] = useState<RadarResult | null>(null);
  useEffect(() => {
    void api.invoke<RadarResult | null>('radar:latest').then(setResult);
    const on = (e: Event) => setResult((e as CustomEvent<RadarResult>).detail);
    moduleEvents.addEventListener('radar', on);
    return () => moduleEvents.removeEventListener('radar', on);
  }, []);
  return { ran: !!result, total: result?.findings.length ?? 0, urgent: result?.findings.filter((f) => f.kind === 'same-fix').length ?? 0 };
}

export function WorktreeBadge({ iid, go }: { iid: string; go: (s: Screen) => void }) {
  const t = useT();
  const h = useWorktreeHealth();
  const items = h?.byIssue[iid];
  if (!items?.length) return null;
  const unpushed = items.reduce((n, b) => n + b.unpushed, 0);
  const dirty = items.filter((b) => b.dirty > 0).length;
  const off = items.some((b) => b.conventionNote);
  const parts = [
    unpushed ? t('ui.radar.unpushedCount', { count: unpushed }) : null,
    dirty ? t('ui.radar.dirtyCount', { count: dirty }) : null,
    off ? t('ui.radar.offConventionBranch') : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <button
      type="button"
      className="badge badge-block"
      style={{ border: 0, cursor: 'pointer' }}
      title={items.map(describeBranch).join('\n')}
      onClick={() => go({ name: 'radar' })}
    >
      {parts.join(' · ')}
    </button>
  );
}
