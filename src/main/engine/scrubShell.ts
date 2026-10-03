import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';

// The Claude SDK runs a command in a child that inherits the SDK process's environment, which holds the provider's key. The open engine runs its
// commands with that environment cleaned; here the same is done for the SDK by rewriting each allowed command to start with `env -u NAME` for
// every credential-looking variable. The command the person allowed is still matched character for character, before the rewrite.

type Hooks = NonNullable<Options['hooks']>;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The command with each named variable removed from its environment. Names that are not plain variable names are ignored. */
export function wrapCommand(command: string, names: string[]): string {
  const safe = [...new Set(names)].filter((n) => NAME.test(n));
  return safe.length ? `env ${safe.map((n) => `-u ${n}`).join(' ')} ${command}` : command;
}

const isDeny = (out: unknown): boolean => (out as { hookSpecificOutput?: { permissionDecision?: string } } | undefined)?.hookSpecificOutput?.permissionDecision === 'deny';

/**
 * The same hooks, with the shell guard's "allowed" turned into "allowed, with the credentials removed from the command". A refusal passes through
 * untouched. The rewritten command is allowed outright: it is not one of the rules any more, and the guard already judged the original.
 */
export function scrubShellHooks(hooks: Hooks, names: string[]): Hooks {
  const safe = names.filter((n) => NAME.test(n));
  if (!safe.length) return hooks;
  const wrap = (inner: HookCallback): HookCallback => async (input, id, opts) => {
    const out = await inner(input, id, opts);
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash' || isDeny(out)) return out;
    const original = input.tool_input as { command?: unknown };
    if (typeof original.command !== 'string') return out;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'allow' as const, updatedInput: { ...original, command: wrapCommand(original.command, safe) } } };
  };
  const pre = hooks.PreToolUse?.map((g) => (g.matcher === 'Bash' ? { ...g, hooks: g.hooks.map(wrap) } : g));
  return { ...hooks, ...(pre ? { PreToolUse: pre } : {}) };
}
