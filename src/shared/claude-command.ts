export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One argv entry on Linux tops out near 128 KB; stay well below it.
export const MAX_PROMPT = 20_000;

export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Which CLI resumes the session and where it starts: externalTools.claudeCli of the workspace config. */
export interface ClaudeCliOptions {
  command: string;
  /** Starting directory; a leading "~/" is left for the shell to expand. */
  cwd: string;
}

export const DEFAULT_CLAUDE_CLI: ClaudeCliOptions = { command: 'claude', cwd: '~' };

const PLAIN = /^(~(\/[\w./+@-]*)?|[\w./+@-]+)$/;
// Both values come from a config file, so they are quoted unless they are plain words and paths.
const word = (text: string): string => (PLAIN.test(text) ? text : shellQuote(text));

// What the user can paste into a terminal. The app itself never runs this string: see terminalScript.
export function resumeCommand(sessionId: string, prompt?: string, cli: ClaudeCliOptions = DEFAULT_CLAUDE_CLI): string {
  const text = prompt?.trim();
  return `cd ${word(cli.cwd)} && ${word(cli.command)} --resume ${sessionId}${text ? ` -- ${shellQuote(text)}` : ''}`;
}

// Fixed script for `bash -lc`: the session id is $1 and the prompt file is $2, so no user text is ever parsed as shell.
export function terminalScript(withPrompt: boolean, cli: ClaudeCliOptions = DEFAULT_CLAUDE_CLI): string {
  const start = `cd ${word(cli.cwd)} && ${word(cli.command)}`;
  // i18n-ignore: shell script
  return withPrompt ? `${start} --resume "$1" -- "$(cat "$2")"; rm -rf "$(dirname "$2")"; exec bash` : `${start} --resume "$1"; exec bash`;
}
