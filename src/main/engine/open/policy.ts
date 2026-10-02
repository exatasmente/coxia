// The open engine does not reimplement the safety policy: it runs the same hook callbacks agents.ts hands to the Claude Agent SDK
// (shell allowlist, secret-file guard, secret-result redaction), so both engines share one policy.
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { Json } from './types';

export type SdkHooks = NonNullable<Options['hooks']>;

export interface Policy {
  // A denial reason, or null when the call may run.
  pre(tool: string, input: Json, cwd: string): Promise<string | null>;
  // The replacement tool response when a hook rewrote it, otherwise null.
  post(tool: string, input: Json, response: unknown, cwd: string): Promise<unknown | null>;
}

type Callback = (input: never, id: string | undefined, opts: { signal: AbortSignal }) => Promise<unknown>;
interface Matcher {
  matcher?: string;
  hooks: Callback[];
}

function matches(matcher: string | undefined, tool: string): boolean {
  if (!matcher || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

export function policyFromHooks(hooks: SdkHooks | undefined, sessionId: string): Policy {
  const base = { session_id: sessionId, transcript_path: '', permission_mode: 'dontAsk' };
  const run = async (event: 'PreToolUse' | 'PostToolUse', tool: string, extra: Json): Promise<unknown[]> => {
    const groups = ((hooks as Record<string, Matcher[] | undefined> | undefined)?.[event] ?? []).filter((g) => matches(g.matcher, tool));
    const outputs: unknown[] = [];
    for (const group of groups) {
      for (const hook of group.hooks) {
        outputs.push(await hook({ ...base, hook_event_name: event, tool_name: tool, ...extra } as never, undefined, { signal: new AbortController().signal }));
      }
    }
    return outputs;
  };
  return {
    async pre(tool, input, cwd) {
      for (const out of await run('PreToolUse', tool, { tool_input: input, tool_use_id: 'open', cwd })) {
        const spec = (out as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } } | undefined)?.hookSpecificOutput;
        if (spec?.permissionDecision === 'deny') return spec.permissionDecisionReason ?? 'Ferramenta negada pela política.';
      }
      return null;
    },
    async post(tool, input, response, cwd) {
      let current = response;
      let changed = false;
      for (const out of await run('PostToolUse', tool, { tool_input: input, tool_response: response, tool_use_id: 'open', cwd })) {
        const spec = (out as { hookSpecificOutput?: { updatedToolOutput?: unknown } } | undefined)?.hookSpecificOutput;
        if (spec?.updatedToolOutput !== undefined) {
          current = spec.updatedToolOutput;
          changed = true;
        }
      }
      return changed ? current : null;
    },
  };
}
