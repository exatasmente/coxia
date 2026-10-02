import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PROMPT, SESSION_ID, resumeCommand, terminalScript } from '../shared/claude-command';

// The prompt travels in a private temp file read by the terminal script, never inside a shell string.
export function writePromptFile(prompt: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-'));
  const file = join(dir, 'prompt.txt');
  writeFileSync(file, prompt, { mode: 0o600 });
  return file;
}

export function terminalArgv(sessionId: string, promptFile: string | null): string[] {
  return ['bash', '-lc', terminalScript(!!promptFile), '_', sessionId, ...(promptFile ? [promptFile] : [])];
}

// Agent sessions run in ~/projects through OpenRouter, so they resume with the same profile (claude-or).
export function continueInClaude(sessionId: string, prompt?: string): { ok: boolean; command: string } {
  const text = prompt?.trim();
  if (!SESSION_ID.test(sessionId) || (text && text.length > MAX_PROMPT)) return { ok: false, command: '' };
  const shell = terminalArgv(sessionId, text ? writePromptFile(text) : null);
  const terminal = spawn('gnome-terminal', ['--title', 'Cerimônias · Claude Code', '--', ...shell], { detached: true, stdio: 'ignore' });
  terminal.on('error', () => {
    spawn('x-terminal-emulator', ['-e', ...shell], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
  });
  terminal.unref();
  return { ok: true, command: resumeCommand(sessionId, text) };
}
