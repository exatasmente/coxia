import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { prompt as cp } from '../cyclePrompts';
import { type DenialCode, WRITE_TOOLS, checkPath, writeTarget } from '../engine/guard';
import { noBroadSearch, noSecrets, redactSecretResults, secretPath, shellAllowlist } from '../agents';

// The hooks of an agent that changes files in its run's worktree. They are the same callbacks for both engines (the open engine runs them
// through policyFromHooks), so a refusal reads the same on either. What they allow: read, search, write and edit inside the worktree, and
// the exact commands the workspace listed. What they refuse: any path outside it, `.git`, secret files, any other command, the network.

export type RunnerDenialCode = DenialCode | 'command' | 'network';

export interface Denial {
  tool: string;
  /** The path or the command the agent tried. */
  target: string;
  code: RunnerDenialCode;
}

export interface ConfineOptions {
  root: string;
  /** The commands the agent may run, each exactly as typed. */
  commands: string[];
  /** Called for every refusal, before the agent is told: the runner posts it to the run's thread. */
  onDenied?: (denial: Denial) => void;
}

export interface ReadConfinementOptions {
  root: string;
  /** Folders outside `root` a read may still reach: the documentation folders the config lists, and what `checkPath` is asked about after the worktree. */
  roots?: string[];
  /** Called for every refusal, before the agent is told: the runner posts it to the run's thread. */
  onDenied?: (denial: Denial) => void;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const has = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

type Hooks = NonNullable<Options['hooks']>;

const refuse = (reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: reason } });

/** The pattern of a path inside a Glob pattern: what comes before the first wildcard, cut at the last separator. */
function globBase(pattern: string): string {
  const cut = pattern.search(/[*?[{]/);
  const head = cut < 0 ? pattern : pattern.slice(0, cut);
  return cut < 0 ? head : head.slice(0, head.lastIndexOf('/') + 1) || '.';
}

export function confinedHooks(o: ConfineOptions): Hooks {
  const say = (tool: string, target: unknown, code: RunnerDenialCode) => {
    o.onDenied?.({ tool, target: typeof target === 'string' ? target.slice(0, 300) : '', code });
    return refuse(cp(`runner.denied.${code}`, code === 'command' ? { commands: o.commands.length ? o.commands.join(', ') : cp('runner.denied.noCommands') } : {}));
  };

  const writeGuard: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || !has(WRITE_TOOLS, input.tool_name)) return {};
    const target = writeTarget(input.tool_name, input.tool_input);
    const check = checkPath(o.root, target, { isSecret: (p) => secretPath(p, o.root) });
    return check.ok ? {} : say(input.tool_name, target, check.code);
  };

  // The shell is the allow-list of the ceremonies with another list in it: only the commands the workspace named, character for character. The denial is the
  // runner's own (below), so the usage hint of a code host's read commands, which none of these patterns open, is empty.
  const patterns = o.commands.map((c) => new RegExp(`^${escapeRe(c)}$`));
  const listed = shellAllowlist(patterns, '');
  const bashGuard: HookCallback = async (input, id, opts) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return {}; // i18n-ignore: the tool's name
    const out = await listed(input, id, opts);
    const denied = (out as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === 'deny';
    return denied ? say(input.tool_name, (input.tool_input as { command?: unknown }).command, 'command') : out;
  };

  const networkGuard: HookCallback = async (input) => (input.hook_event_name === 'PreToolUse' ? say(input.tool_name, (input.tool_input as { url?: unknown; query?: unknown }).url ?? (input.tool_input as { query?: unknown }).query, 'network') : {});

  return {
    PreToolUse: [
      { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [writeGuard] },
      { matcher: 'Read|Grep|Glob', hooks: [noSecrets, readGuardOf({ root: o.root, onDenied: o.onDenied })] },
      { matcher: 'Bash', hooks: [bashGuard] }, // i18n-ignore: the tool's name
      { matcher: 'WebFetch|WebSearch', hooks: [networkGuard] },
    ],
    PostToolUse: [{ matcher: 'Grep|Glob', hooks: [redactSecretResults] }],
  };
}

/**
 * The guard over `Read`, `Grep` and `Glob`: the one path check, over the worktree and the extra roots a reading agent was given.
 * Reading is confined too, because the agent's own folder is all it needs and a path elsewhere is somebody else's file.
 */
function readGuardOf(o: Pick<ReadConfinementOptions, 'root' | 'roots' | 'onDenied'>): HookCallback {
  const say = (tool: string, target: unknown, code: RunnerDenialCode) => {
    const what = typeof target === 'string' ? target.slice(0, 300) : '';
    o.onDenied?.({ tool, target: what, code });
    // The reason names what the agent tried, so it can correct itself instead of guessing; the wording of every code stays one catalog key.
    return refuse(what ? `${cp(`runner.denied.${code}`)}: ${what}` : cp(`runner.denied.${code}`));
  };
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const args = input.tool_input as { file_path?: unknown; path?: unknown; pattern?: unknown };
    const wanted: unknown[] = [];
    if (input.tool_name === 'Read') wanted.push(args.file_path);
    else if (typeof args.path === 'string' && args.path.trim()) wanted.push(args.path);
    if (input.tool_name === 'Glob' && typeof args.pattern === 'string' && /^[/~]|(^|\/)\.\.(\/|$)/.test(args.pattern)) wanted.push(globBase(args.pattern));
    for (const p of wanted) {
      const check = checkPath(o.root, p, { read: true, roots: o.roots });
      if (!check.ok) return say(input.tool_name, p, check.code);
    }
    return {};
  };
}

/**
 * The hooks of an agent of a run that only reads: what a reader already had (the secret filter, the broad-search refusal and the
 * secret result redaction) plus the path guard, never one instead of the other, so nothing that exists is loosened. Both engines run them.
 */
export function readConfinedHooks(o: ReadConfinementOptions): Hooks {
  return {
    PreToolUse: [
      { matcher: 'Read|Grep|Glob', hooks: [noSecrets, readGuardOf(o)] },
      { matcher: 'Grep|Glob', hooks: [noBroadSearch] },
    ],
    PostToolUse: [{ matcher: 'Grep|Glob', hooks: [redactSecretResults] }],
  };
}
