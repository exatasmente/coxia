import type { WorkspaceConfig } from '../shared/config/types';

// What a paired browser may change in the configuration. config:save is desktop-only because the configuration names programs to run (runner.commands, the
// external tools) and folders to read or write (docs, projects, runner.worktreesDir), and holds the places of the secrets. The team and cycle screens still have
// to work from the phone, so they save through config:cycle-save: a separate channel, which leaves config:save refused by name, and whose handler (configModule.ts)
// accepts a change only when every path that differs from the stored configuration is one of WEB_EDITABLE. The diff is computed here, on the validated
// configuration against the one the app holds, so what the client says it changed does not matter: a full config with a sneaky change elsewhere is refused.

/** The paths (a path and everything under it) a paired browser may change. */
export const WEB_EDITABLE = [
  'agents.team',
  'squads',
  'devCycle.stages',
  'devCycle.flows',
  'devCycle.comments',
  'devCycle.priority',
  'runner.enabled',
  'runner.triggerLabel',
  'runner.maxConcurrentRuns',
  'runner.turns',
  'runner.stageIdleMs',
  'runner.stageMaxMs',
  'runner.commitMessage',
] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!same(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** The dotted paths that differ between two configurations. Objects are walked key by key; an array or a scalar is one path. */
export function changedPaths(before: unknown, after: unknown, at = ''): string[] {
  if (same(before, after)) return [];
  if (isObject(before) && isObject(after)) {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) out.push(...changedPaths(before[k], after[k], at ? `${at}.${k}` : k));
    return out;
  }
  return [at];
}

const covered = (path: string): boolean => WEB_EDITABLE.some((p) => path === p || path.startsWith(`${p}.`));

/** The changed paths a paired browser may not change (empty: the change is allowed). */
export function refusedPaths(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  return changedPaths(before, after).filter((p) => !covered(p));
}
