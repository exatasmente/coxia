import { shellRaised, trackerRaised } from '../shared/config/team';
import { ACTIVITIES, type AgentDef, type ModelRef, type WorkspaceConfig } from '../shared/config/types';

// What a paired browser may change in the configuration. config:save is desktop-only because the configuration names programs to run (runner.commands, the
// external tools) and folders to read or write (docs, projects, runner.worktreesDir), and holds the places of the secrets. The team and cycle screens still have
// to work from the phone, so they save through config:cycle-save: a separate channel, which leaves config:save refused by name, and whose handler (configModule.ts)
// accepts a change only when every path that differs from the stored configuration is one of WEB_EDITABLE. The diff is computed here, on the validated
// configuration against the one the app holds, so what the client says it changed does not matter: a full config with a sneaky change elsewhere is refused.
//
// `runner.evidence` is deliberately absent from the list, like `runner.worktreesDir`, `runner.commands`, `runner.identity`, `runner.sandbox` and
// `runner.release`: it decides what enters a commit and only the computer changes it (see RunnerSection.tsx).

/** The paths (a path and everything under it) a paired browser may change. */
export const WEB_EDITABLE = [
  'agents.team',
  'squads',
  'devCycle.stages',
  'devCycle.flows',
  'devCycle.autonomy',
  'devCycle.comments',
  'devCycle.priority',
  'runner.enabled',
  'runner.triggerLabel',
  'runner.maxConcurrentRuns',
  'runner.turns',
  'runner.stageIdleMs',
  'runner.stageMaxMs',
  'runner.commitMessage',
  'runner.prTitle',
  'runner.linkDependencies',
  'attachments',
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

/**
 * What a paired browser may do with the two permissions of an agent: lower them, never raise them. `agents.team` is one editable path, so the field-by-field check is
 * made here: an agent whose `shell` or `tracker` goes up is refused by name, and an agent that did not exist may only be made with `none` for both (what it can run and
 * read is what the person at the computer gave it). The screen, the hosts and the logged-in browser follow the same rule (`screenRaised`).
 */
export function raisedPermissions(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const was = new Map(before.agents.team.map((a) => [a.id, a]));
  const out: string[] = [];
  for (const a of after.agents.team) {
    const old = was.get(a.id) ?? { shell: 'none' as const, tracker: 'none' as const };
    // From here a change of `shell` is only ever to `none`: "lowering" sandbox to the listed commands would swap one reach for another that is not below it.
    if (a.shell !== old.shell && (a.shell !== 'none' || shellRaised(old.shell, a.shell))) out.push(`agents.team[${a.id}].shell`);
    if (trackerRaised(old.tracker, a.tracker)) out.push(`agents.team[${a.id}].tracker`);
    out.push(...screenRaised(was.get(a.id), a, a.id));
  }
  // What an agent with commands can reach depends on its permission too: a reader with a sandbox works in a throwaway copy, an agent that changes files in the real
  // worktree. Giving it that permission while it runs commands is a raise, even though neither command field moved.
  for (const a of after.agents.team) {
    const old = was.get(a.id);
    if (old && old.permission === 'read' && a.permission === 'worktree' && a.shell !== 'none') out.push(`agents.team[${a.id}].permission`);
  }
  return out;
}

/**
 * The three fields that give an agent a virtual screen: the switch, the hosts it may reach and the logged-in browser. A paired browser may lower them and never raise
 * them: a switch off to on, a host added to the list, or a new agent made with any of them is refused by name.
 */
export function screenRaised(old: AgentDef | undefined, now: AgentDef, id: string): string[] {
  const out: string[] = [];
  if (now.screen === true && old?.screen !== true) out.push(`agents.team[${id}].screen`);
  const had = new Set(old?.allowedHosts ?? []);
  if ((now.allowedHosts ?? []).some((h) => !had.has(h))) out.push(`agents.team[${id}].allowedHosts`);
  if (now.browserProfile === true && old?.browserProfile !== true) out.push(`agents.team[${id}].browserProfile`);
  return out;
}

/**
 * The reserve models of an agent's own model decide where a stage's content goes when the first model is busy, so a paired browser may take entries out and reorder the
 * list, never add one: an entry that was not in the same list before is refused by name (also for an agent made there). The pools of the five roles are `llm.roles`, which
 * the browser cannot change at all.
 */
export function poolRaised(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const was = new Map(before.agents.team.map((a) => [a.id, a.model]));
  const key = (r: ModelRef) => `${r.provider}\n${r.model}`;
  const added = (old: ModelRef[] | undefined, now: ModelRef[] | undefined): boolean => {
    const had = new Set((old ?? []).map(key));
    return (now ?? []).some((r) => !had.has(key(r)));
  };
  const out: string[] = [];
  for (const a of after.agents.team) {
    const old = was.get(a.id);
    if (added(old?.fallbacks, a.model.fallbacks)) out.push(`agents.team[${a.id}].model.fallbacks`);
    for (const act of ACTIVITIES) if (added(old?.activities?.[act], a.model.activities?.[act])) out.push(`agents.team[${a.id}].model.activities.${act}`);
  }
  return out;
}

/** The changed paths a paired browser may not change (empty: the change is allowed). */
export function refusedPaths(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  return [...changedPaths(before, after).filter((p) => !covered(p)), ...raisedPermissions(before, after), ...poolRaised(before, after), ...raisedAutonomy(before, after)];
}

const AUTONOMY_FIELDS = ['cycle', 'hostCommands', 'gates', 'push', 'pullRequest'] as const;

/**
 * What a paired browser may do with a flow's autonomy block: lower it, never raise it. `devCycle.autonomy` is one editable path (the phone may turn a choice off),
 * so the field-by-field check is made here: any field that goes from off to on, and `useWorkspace` going from on to off (which hands the decision to the flow's own
 * block), is refused by name. The workspace's block (`runner.autonomy`) is not in WEB_EDITABLE at all, so the browser can neither raise nor lower it.
 */
export function raisedAutonomy(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  const was = before.devCycle.autonomy ?? {};
  const out: string[] = [];
  for (const [key, block] of Object.entries(after.devCycle.autonomy ?? {})) {
    const old = was[key];
    for (const f of AUTONOMY_FIELDS) if (block[f] === true && old?.[f] !== true) out.push(`devCycle.autonomy.${key}.${f}`);
    if (old?.useWorkspace !== false && block.useWorkspace === false) out.push(`devCycle.autonomy.${key}.useWorkspace`);
  }
  return out;
}
