export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One argv entry on Linux tops out near 128 KB; stay well below it.
export const MAX_PROMPT = 20_000;

export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// What the user can paste into a terminal. The app itself never runs this string: see terminalScript.
export function resumeCommand(sessionId: string, prompt?: string): string {
  const text = prompt?.trim();
  return `cd ~/projects && claude-or --resume ${sessionId}${text ? ` -- ${shellQuote(text)}` : ''}`;
}

// Fixed script for `bash -lc`: the session id is $1 and the prompt file is $2, so no user text is ever parsed as shell.
export function terminalScript(withPrompt: boolean): string {
  return withPrompt
    ? 'cd ~/projects && claude-or --resume "$1" -- "$(cat "$2")"; rm -rf "$(dirname "$2")"; exec bash'
    : 'cd ~/projects && claude-or --resume "$1"; exec bash';
}
