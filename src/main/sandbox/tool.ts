// i18n-lint: allow-file what the Shell tool tells a model: English by design, like the other tool texts of the engines
import { SHELL_COMMAND_MAX } from '../../shared/sandbox';
import type { ExecResult, ImageRead, SandboxSession } from './session';

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
  if (r.refused === 'denied') return `The person did not allow this command; it did not run.${r.output ? ` Their note: ${r.output}` : ''}`;
  const head = r.timedOut ? `[command ${r.n} timed out after ${Math.round(r.ms / 1000)}s]` : r.exitCode === null ? `[command ${r.n} did not run to an exit]` : `[command ${r.n}: exit code ${r.exitCode}, ${Math.max(1, Math.round(r.ms / 100) / 10)}s]`;
  return `${head}\n${r.outputUnavailable ? '(output unavailable)' : r.output || '(no output)'}`;
  // i18n-ignore-end
}

/** Runs the command a model asked for. A refused or failing command is an answer, not an error. */
export async function runShell(session: SandboxSession, input: unknown): Promise<string> {
  const command = typeof (input as { command?: unknown } | null)?.command === 'string' ? (input as { command: string }).command : '';
  return renderExec(await session.exec(command));
}

// The `ViewImage` tool: how an agent that tests an interface looks at a screenshot it saved. It reads only the stage's output folder, the one place both a reader and a
// writer can save to without the file being committed or thrown away; anything else is refused with where to save it.

export const VIEW_IMAGE_TOOL_NAME = 'ViewImage';
export const VIEW_IMAGE_MCP_TOOL_NAME = `mcp__${SHELL_MCP_SERVER}__${VIEW_IMAGE_TOOL_NAME}`;

export const VIEW_IMAGE_DESCRIPTION =
  // i18n-ignore: tool description for the model: English by design
  'Shows you an image (PNG, JPEG, GIF or WebP, at most 4 MB) that you saved in /coxia/out inside the sandbox, such as a screenshot of the interface you are testing. ' +
  // i18n-ignore: tool description for the model: English by design
  'Give the path (/coxia/out/name.png) or the name of a file in that folder. Nothing outside /coxia/out can be read.';

export const VIEW_IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore: tool description for the model: English by design
    path: { type: 'string', description: 'The image in /coxia/out (an absolute path in it, or a file name)' },
  },
  required: ['path'],
} as const;

/** The tool is offered to a stage whose sandbox has something to test an interface with (browsers or a display) and an output folder to read from. */
export const offersViewImage = (session: SandboxSession | null | undefined): boolean => !!session?.readImage && !!session.gui && (session.gui.browsers !== null || session.gui.display === 'on');

/** Why an image was not shown, for the model: what to do instead. */
export function imageRefusal(r: Exclude<ImageRead, { ok: true }>): string {
  // i18n-ignore-start: tool result for the model: English by design
  switch (r.why) {
    case 'outside':
      return 'Only images saved in /coxia/out can be viewed: save the screenshot there (for example /coxia/out/home.png) and ask again.';
    case 'missing':
      return 'There is no such file in /coxia/out.';
    case 'not-file':
      return 'That is not a regular file (a link, a folder or a pipe): save the image as a plain file in /coxia/out.';
    case 'too-big':
      return 'The image is larger than 4 MB: take a smaller one (a smaller viewport or a crop of the element).';
    case 'not-image':
      return 'The file is not a PNG, JPEG, GIF or WebP image.';
  }
  // i18n-ignore-end
}

/** Reads the image a model asked for from the stage's output folder. */
export function viewImage(session: SandboxSession, input: unknown): ImageRead {
  const path = typeof (input as { path?: unknown } | null)?.path === 'string' ? (input as { path: string }).path : '';
  return session.readImage ? session.readImage(path) : { ok: false, why: 'missing' };
}
