import type { AuditEntry, Through } from '../shared/auditoria';
import type { WorkspaceConfig } from '../shared/config/types';
import { poolRaised, raisedAutonomy, raisedPermissions, same } from './configScope';

// The audit line of a change of the configuration, for every origin: the person's own save and the persona's act. It holds the paths that changed (the first twenty and a count)
// and, per path, the old and new value only when it is a boolean, a number or a short word that names a choice; any other value is only its length. So a persona's instructions, a
// prompt, a command or any text are never copied into a file that is not swept. Pure: the writers live in configModule.ts and in the persona's door.

export type ConfigOp = 'save' | 'cycle-save' | 'prompt-set' | 'import-apply' | 'act';

/** The paths a line names: the first twenty, then the count of all. */
export const CONFIG_PATHS_SHOWN = 20;

const ENUM_WORD = /^[a-z][a-z0-9-]{0,23}$/;
// Names that hold what a person wrote, whatever its shape: never copied, not even when it is one short word.
const TEXT_KEY = /(?:^|\.)(?:instructions|job|name|userName|text|body|description|title|prompt|command|commands|args|note|message)$/;
const NONE = '—';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The elements of an array of objects that all carry a distinct string `id`, by that id; null for any other array. */
function keyed(list: unknown[]): Map<string, unknown> | null {
  const out = new Map<string, unknown>();
  for (const item of list) {
    const id = isObject(item) && typeof item.id === 'string' && item.id ? item.id : null;
    if (id === null || out.has(id)) return null;
    out.set(id, item);
  }
  return out;
}

interface Change {
  path: string;
  before: unknown;
  after: unknown;
}

/** Walks two configurations: objects by key, arrays of identified objects by `name[id]`, anything else as one path. */
function walk(before: unknown, after: unknown, at: string, out: Change[]): void {
  if (same(before, after)) return;
  if (isObject(before) && isObject(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) walk(before[k], after[k], at ? `${at}.${k}` : k, out);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const was = keyed(before);
    const now = keyed(after);
    if (was && now) {
      for (const id of new Set([...was.keys(), ...now.keys()])) walk(was.get(id), now.get(id), `${at}[${id}]`, out);
      return;
    }
  }
  out.push({ path: at, before, after });
}

/** The paths that differ, in the grammar of the persona's settings tool (`agents.team[me].shell`). */
export const auditPaths = (before: unknown, after: unknown): string[] => {
  const out: Change[] = [];
  walk(before, after, '', out);
  return out.map((c) => c.path);
};

/** A value as the line may show it: itself when it names a choice, otherwise only how long it is. */
export function valueWords(path: string, value: unknown): string {
  if (value === undefined) return NONE;
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return ENUM_WORD.test(value) && !TEXT_KEY.test(path) ? value : `len=${value.length}`;
  if (Array.isArray(value)) return `len=${value.length}`;
  return `len=${JSON.stringify(value).length}`;
}

/**
 * What a save gives that the configuration did not give before, for the line to mark: the four checks a paired browser is held to (the permissions of an agent, its screen,
 * the reserve models, the autonomy of a flow) and two more that the same point asks for: the workspace's autonomy block going on, and an agent's list of commands allowed
 * always growing. The marks are names of paths, never values.
 */
export function raisedFields(before: WorkspaceConfig, after: WorkspaceConfig): string[] {
  try {
    const out = [...raisedPermissions(before, after), ...poolRaised(before, after), ...raisedAutonomy(before, after)];
    const was = before.runner.autonomy as unknown as Record<string, unknown>;
    for (const [key, on] of Object.entries(after.runner.autonomy as unknown as Record<string, unknown>)) if (on === true && was?.[key] !== true) out.push(`runner.autonomy.${key}`);
    const old = new Map(before.agents.team.map((a) => [a.id, new Set(a.allowedCommands ?? [])]));
    for (const a of after.agents.team) if ((a.allowedCommands ?? []).some((c) => !(old.get(a.id) ?? new Set<string>()).has(c))) out.push(`agents.team[${a.id}].allowedCommands`);
    return [...new Set(out)];
  } catch {
    // A configuration the checks cannot read is no reason to lose the line.
    return [];
  }
}

/** The line for a change of the configuration, or null when nothing changed (a save that was refused changed nothing and has no line). */
export function configAuditEntry(before: WorkspaceConfig, after: WorkspaceConfig, o: { op: ConfigOp; via: Through }): Omit<AuditEntry, 'at'> | null {
  const changes: Change[] = [];
  walk(before, after, '', changes);
  if (!changes.length) return null;
  const raised = raisedFields(before, after);
  const fields: Record<string, string> = { changed: String(changes.length), ...(raised.length ? { raised: raised.join(', ') } : {}) };
  for (const c of changes.slice(0, CONFIG_PATHS_SHOWN)) fields[c.path] = `${valueWords(c.path, c.before)} → ${valueWords(c.path, c.after)}`;
  return {
    kind: 'config',
    issue: 0,
    target: `config:${o.op}`,
    via: o.via,
    fields,
    ok: true,
    code: null,
    result: raised.length ? 'raised' : 'saved',
    origin: { actionId: '', kind: 'config', key: o.op, summary: null },
    by: null,
  };
}
