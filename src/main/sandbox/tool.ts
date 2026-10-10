// i18n-lint: allow-file what the Shell tool tells a model: English by design, like the other tool texts of the engines
import { HANDOFF_HELD_TEXT } from '../../shared/handoff';
import { SHELL_COMMAND_MAX } from '../../shared/sandbox';
import { MAX_IMAGE_BYTES } from '../imageType';
import type { EvidenceTools } from '../evidence/tool';
import { type ExecResult, type ImageRead, OUTPUT_DIR, type SandboxSession } from './session';

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
  if (r.refused === 'handoff') return HANDOFF_HELD_TEXT;
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

// The `ViewImage` tool: the one way an agent looks at an image. It reads the stage's output folder, the one place both a reader and a writer can save to without the file
// being committed or thrown away; anything else is refused with where to save it. A stage that keeps evidence can also name a piece of evidence by its id.
// There is one tool of this name for both engines: two tools called ViewImage would be two contracts for the same word.

export const VIEW_IMAGE_TOOL_NAME = 'ViewImage';
export const VIEW_IMAGE_MCP_TOOL_NAME = `mcp__${SHELL_MCP_SERVER}__${VIEW_IMAGE_TOOL_NAME}`;

/**
 * What the model is told: the evidence ids are mentioned only when the stage keeps evidence, so a stage without it never hears of them. `out` is the folder a host
 * session saves in; a sandbox has its fixed `/coxia/out`.
 */
export const viewImageDescription = (withEvidence: boolean, out?: string): string =>
  // i18n-ignore-start: tool description for the model: English by design
  `Shows you an image (PNG, JPEG, GIF or WebP, at most 4 MB) that you saved in ${out ?? OUTPUT_DIR}${out ? '' : ' inside the sandbox'}, such as a screenshot of the interface you are testing. ` +
  `Give the path (${out ?? OUTPUT_DIR}/name.png) or the name of a file in that folder. Nothing outside ${out ?? OUTPUT_DIR} can be read.` +
  (withEvidence ? ' It also shows a piece of evidence of this stage, by its id (like "ev-3"): use it to check what a mark looks like before marking again.' : '');
// i18n-ignore-end

export const viewImageSchema = (withEvidence: boolean, out?: string) =>
  ({
    type: 'object',
    properties: {
      // i18n-ignore: tool description for the model: English by design
      source: { type: 'string', description: withEvidence ? `The image in ${out ?? OUTPUT_DIR} (an absolute path in it, or a file name), or an evidence id (like "ev-3")` : `The image in ${out ?? OUTPUT_DIR} (an absolute path in it, or a file name)` },
    },
    required: ['source'],
  }) as const;

/** The tool is offered to a stage whose sandbox has something to test an interface with (browsers or a display) and an output folder to read from, and to any stage with a sandbox that keeps evidence. */
export const offersViewImage = (session: SandboxSession | null | undefined, evidence?: EvidenceTools | null): boolean =>
  (!!evidence && !!session) || (!!session?.readImage && !!session.gui && (session.gui.browsers !== null || session.gui.display === 'on'));

/** Why an image was not shown, for the model: what to do instead. */
export function imageRefusal(r: Exclude<ImageRead, { ok: true }>, out: string = OUTPUT_DIR): string {
  // i18n-ignore-start: tool result for the model: English by design
  switch (r.why) {
    case 'outside':
      return `Only images saved in ${out} can be viewed: save the screenshot there (for example ${out}/home.png) and ask again.`;
    case 'missing':
      return `There is no such file in ${out}.`;
    case 'not-file':
      return `That is not a regular file (a link, a folder or a pipe): save the image as a plain file in ${out}.`;
    case 'too-big':
      return 'The image is larger than 4 MB: take a smaller one (a smaller viewport or a crop of the element).';
    case 'not-image':
      return 'The file is not a PNG, JPEG, GIF or WebP image.';
  }
  // i18n-ignore-end
}

/**
 * An image a model asked for, or the text that says why not (and, for evidence, the line that goes with the picture). `looked` is the place of the output folder
 * the picture came from, when it is one: what the stage saw and did not keep, so the app can keep it (or say it was seen and not kept) before the sandbox goes.
 */
export type ImageLook = { ok: true; path: string; mediaType: string; data: string; text?: string; looked?: string } | { ok: false; text: string };

const EVIDENCE_ID = /^ev-\d+$/i;

/** The place a model named: `source`, or the older `path` of the tool's first contract. */
export function viewImageSource(input: unknown): string {
  const o = (input && typeof input === 'object' ? input : {}) as { source?: unknown; path?: unknown };
  const raw = typeof o.source === 'string' ? o.source : typeof o.path === 'string' ? o.path : '';
  return raw.trim();
}

/**
 * Reads the image a model asked for. An evidence id goes to the evidence tools; anything else is a place in the output folder, read through the sandbox when it can
 * (proper media type, the 4 MB cap and its own refusals) and through the evidence tools otherwise (they read that folder too).
 */
export async function lookAtImage(session: SandboxSession, evidence: EvidenceTools | null | undefined, input: unknown): Promise<ImageLook> {
  const source = viewImageSource(input);
  if (evidence && (EVIDENCE_ID.test(source) || !session.readImage)) {
    const a = await evidence.view({ source });
    if (!a.image) return { ok: false, text: a.text };
    if (a.image.data.length > MAX_IMAGE_BYTES) return { ok: false, text: imageRefusal({ ok: false, why: 'too-big' }, session.gui?.out) };
    return { ok: true, path: source, mediaType: a.image.media, data: Buffer.from(a.image.data).toString('base64'), text: a.text, ...(a.image.looked ? { looked: a.image.looked } : {}) };
  }
  const r: ImageRead = session.readImage ? session.readImage(source) : { ok: false, why: 'missing' };
  return r.ok ? { ...r, ...(r.file ? { looked: r.file } : {}) } : { ok: false, text: imageRefusal(r, session.gui?.out) };
}
