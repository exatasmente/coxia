import { SHELL_COMMAND_MAX } from '../../shared/sandbox';
import type { ExecResult, SandboxSession } from './session';

// The `Shell` tool: the one way an agent set to `shell: sandbox` runs a command. It takes one string and nothing else: the mounts, the limits, the network and the environment
// come from the configuration, never from the model. The same function serves both engines (see engineTool.ts).

export const SHELL_TOOL_NAME = 'Shell';
export const SHELL_MCP_SERVER = 'coxia_sandbox';
/** The name the Claude Agent SDK knows it by, for allowedTools. */
export const SHELL_MCP_TOOL_NAME = `mcp__${SHELL_MCP_SERVER}__${SHELL_TOOL_NAME}`;

export const SHELL_DESCRIPTION =
  // i18n-ignore: tool description for the model: English by design
  'Runs one shell command inside a sandbox: your working folder is the only place you can write, the rest of the system is read-only, there is no home folder, no credentials ' +
  // i18n-ignore: tool description for the model: English by design
  'and no network (or only the package registry, when the workspace allows it). A process you start in the background stays until the end of your stage. One command at a time.';

export const SHELL_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore: tool description for the model: English by design
    command: { type: 'string', description: `The command, as you would type it in a shell (at most ${SHELL_COMMAND_MAX} bytes)` },
  },
  required: ['command'],
} as const;

/** What the model reads back: which command it was, how it ended and the end of its output. */
export function renderExec(r: ExecResult): string {
  // i18n-ignore-start: tool result for the model: English by design
  if (r.refused === 'empty') return 'The command is empty.';
  if (r.refused === 'size') return `The command is longer than ${SHELL_COMMAND_MAX} bytes.`;
  if (r.refused === 'budget') return 'The time this stage may spend running commands is used up.';
  if (r.refused === 'closed') return 'The sandbox has ended; no more commands run in this stage.';
  const head = r.timedOut ? `[command ${r.n} timed out after ${Math.round(r.ms / 1000)}s]` : r.exitCode === null ? `[command ${r.n} did not run to an exit]` : `[command ${r.n}: exit code ${r.exitCode}, ${Math.max(1, Math.round(r.ms / 100) / 10)}s]`;
  return `${head}\n${r.output || '(no output)'}`;
  // i18n-ignore-end
}

/** Runs the command a model asked for. A refused or failing command is an answer, not an error. */
export async function runShell(session: SandboxSession, input: unknown): Promise<string> {
  const command = typeof (input as { command?: unknown } | null)?.command === 'string' ? (input as { command: string }).command : '';
  return renderExec(await session.exec(command));
}
