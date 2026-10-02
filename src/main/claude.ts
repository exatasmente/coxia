import { spawn } from 'node:child_process';

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Agent sessions run in ~/projects through OpenRouter, so they resume with the same profile (claude-or).
export function continueInClaude(sessionId: string): { ok: boolean; command: string } {
  if (!SESSION.test(sessionId)) return { ok: false, command: '' };
  const command = `cd ~/projects && claude-or --resume ${sessionId}`;
  const shell = ['bash', '-lc', `${command}; exec bash`];
  const terminal = spawn('gnome-terminal', ['--title', 'Cerimônias · Claude Code', '--', ...shell], { detached: true, stdio: 'ignore' });
  terminal.on('error', () => {
    spawn('x-terminal-emulator', ['-e', ...shell], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
  });
  terminal.unref();
  return { ok: true, command };
}
