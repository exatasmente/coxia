import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ClaudeCliOptions, MAX_PROMPT, SESSION_ID, resumeCommand, terminalScript } from '../shared/claude-command';
import { rc } from './workspaceConfig';

// The prompt travels in a private temp file read by the terminal script, never inside a shell string.
export function writePromptFile(prompt: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-'));
  const file = join(dir, 'prompt.txt');
  writeFileSync(file, prompt, { mode: 0o600 });
  return file;
}

export function terminalArgv(sessionId: string, promptFile: string | null, cli?: ClaudeCliOptions): string[] {
  return ['bash', '-lc', terminalScript(!!promptFile, cli), '_', sessionId, ...(promptFile ? [promptFile] : [])];
}

/** The CLI and directory that resume an agent session: the workspace's externalTools.claudeCli. */
export function claudeCli(): ClaudeCliOptions {
  const { command, cwd } = rc().claudeCli;
  return { command, cwd };
}

/** What the user can paste into a terminal to resume the session. */
export function pasteCommand(sessionId: string, prompt?: string): string {
  return resumeCommand(sessionId, prompt, claudeCli());
}

// Agent sessions run in the projects root, so they resume from there with the CLI the workspace names (a wrapper that sets the provider, or plain claude).
export function continueInClaude(sessionId: string, prompt?: string): { ok: boolean; command: string } {
  const text = prompt?.trim();
  if (!SESSION_ID.test(sessionId) || (text && text.length > MAX_PROMPT)) return { ok: false, command: '' };
  const cli = claudeCli();
  const shell = terminalArgv(sessionId, text ? writePromptFile(text) : null, cli);
  const term = rc().terminal;
  const fallback = () => spawn('x-terminal-emulator', ['-e', ...shell], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
  const terminal = term.command
    ? spawn(term.command, [...term.args, ...shell], { detached: true, stdio: 'ignore' })
    : spawn('gnome-terminal', ['--title', 'Coxia · Claude Code', '--', ...shell], { detached: true, stdio: 'ignore' });
  terminal.on('error', fallback);
  terminal.unref();
  return { ok: true, command: resumeCommand(sessionId, text, cli) };
}
