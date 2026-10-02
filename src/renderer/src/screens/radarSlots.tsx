import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BranchHealth, RadarResult, WorktreeHealth } from '../../../shared/radar';
import type { Screen } from '../App';
import { api, moduleEvents } from '../api';

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
  if (b.dirty) parts.push(`${b.dirty} ${b.dirty === 1 ? 'alteração' : 'alterações'} não commitada${b.dirty === 1 ? '' : 's'}`);
  if (b.unpushed) parts.push(`${b.unpushed} ${b.unpushed === 1 ? 'commit' : 'commits'} sem push${b.hasUpstream ? '' : ' (branch sem remoto próprio)'}`);
  if (b.conventionNote) parts.push(`fora do padrão: ${b.conventionNote}`);
  return `${b.repo} · ${b.branch}: ${parts.join('; ')}`;
}

export function RadarButton({ go }: { go: (s: Screen) => void }) {
  const [result, setResult] = useState<RadarResult | null>(null);
  useEffect(() => {
    void api.invoke<RadarResult | null>('radar:latest').then(setResult);
    const on = (e: Event) => setResult((e as CustomEvent<RadarResult>).detail);
    moduleEvents.addEventListener('radar', on);
    return () => moduleEvents.removeEventListener('radar', on);
  }, []);
  const urgent = result?.findings.filter((f) => f.kind === 'same-fix').length ?? 0;
  const total = result?.findings.length ?? 0;
  return (
    <button
      type="button"
      className={`btn ${urgent ? 'btn-amber' : ''}`}
      style={{ minHeight: 34 }}
      title={result ? `${total} achado(s), ${urgent} de mesma correção` : 'Ainda não rodou'}
      onClick={() => go({ name: 'radar' })}
    >
      Radar{total > 0 ? ` · ${total}` : ''}
    </button>
  );
}

export function WorktreeBadge({ iid, go }: { iid: string; go: (s: Screen) => void }) {
  const h = useWorktreeHealth();
  const items = h?.byIssue[iid];
  if (!items?.length) return null;
  const unpushed = items.reduce((n, b) => n + b.unpushed, 0);
  const dirty = items.filter((b) => b.dirty > 0).length;
  const off = items.some((b) => b.conventionNote);
  const parts = [
    unpushed ? `${unpushed} sem push` : null,
    dirty ? `${dirty} com alterações` : null,
    off ? 'branch fora do padrão' : null,
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
