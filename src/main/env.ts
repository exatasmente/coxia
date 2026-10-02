import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureWorkspaces, workspaceDir } from './workspaces-core';

export const HOME = homedir();
export const WORKSPACE = join(HOME, 'projects');
export const PLAYBOOK = join(WORKSPACE, 'sz-playbook');
export const SPECS = process.env.CERIMONIAS_SPECS_DIR ?? join(PLAYBOOK, '.specs');
export const DAILY_REPORT = join(HOME, '.local/bin/daily-report');
// The data root holds what every workspace shares (web access, paired devices, glossary, userData) and the workspaces themselves.
export const DATA_ROOT = process.env.CERIMONIAS_DATA_DIR ?? join(HOME, '.local/share/cerimonias');
const resolved = ensureWorkspaces(DATA_ROOT);
// The current workspace's folder (history, settings, actions...). Fixed at startup: switching workspace relaunches the app.
export const ATAS = workspaceDir(DATA_ROOT, resolved.registry.current);
export const WORKSPACE_ID = resolved.registry.current;
export const GITLAB = 'dark.smartzap.com.br';

// Variables inherited from a Claude Code or Claude Desktop session make the child ignore the OpenRouter
// routing (same cleanup as ~/.local/bin/claude-or).
const INHERITED = /^(CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDE_PREVIEW_|ANTHROPIC_)|^CLAUDE_(PID|EFFORT)$/;

function profileEnv(): Record<string, string> {
  try {
    const settings = JSON.parse(readFileSync(join(HOME, '.claude/openrouter.settings.json'), 'utf8'));
    return Object.fromEntries(
      Object.entries((settings.env ?? {}) as Record<string, string>).filter(([k]) => !/KEY|TOKEN/.test(k)),
    );
  } catch {
    return {};
  }
}

let cachedKey: string | null = null;

export function openRouterKey(): string {
  cachedKey ??= execFileSync(join(HOME, '.local/bin/openrouter-key'), { encoding: 'utf8' }).trim();
  return cachedKey;
}

export function agentEnv(): Record<string, string> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !INHERITED.test(e[0])),
  );
  return {
    ...clean,
    ...profileEnv(),
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    ANTHROPIC_AUTH_TOKEN: openRouterKey(),
    ANTHROPIC_API_KEY: '',
    // Outside a git checkout glab falls back to gitlab.com.
    GITLAB_HOST: GITLAB,
  };
}
