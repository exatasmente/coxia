import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_ROOT } from './env';
import { rc } from './workspaceConfig';
import type { Module } from './module';
import { t } from '../shared/i18n';

// Per project ("<group>/<project>") shell command that checks a conflict resolution in its worktree. Empty: none.
const FILE = join(DATA_ROOT, 'conflict-verify.json');
const PROJECT = /^[\w.-]+(\/[\w.-]+)+$/;
const MAX = 2000;

export interface VerifyConfig {
  commands: Record<string, string>;
  // Projects the sync tool mirrors: suggestions for the settings screen.
  projects: string[];
}

export function verifyCommands(): Record<string, string> {
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1].trim()));
    }
  } catch {}
  return {};
}

export function verifyCommandFor(project: string): string | null {
  return verifyCommands()[project] ?? null;
}

export function validateVerify(commands: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [project, command] of Object.entries(commands)) {
    if (!PROJECT.test(project) || project.includes('..')) throw new Error(t('main.conflictVerify.project', { project }));
    if (typeof command !== 'string' || command.includes('\0')) throw new Error(t('main.conflictVerify.command', { project }));
    if (command.length > MAX) throw new Error(t('main.conflictVerify.tooLong', { project, max: MAX }));
    if (command.trim()) out[project] = command.trim();
  }
  return out;
}

export function saveVerifyCommands(commands: Record<string, string>): Record<string, string> {
  const clean = validateVerify(commands);
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(clean, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
  return clean;
}

function mirrored(): string[] {
  const out: string[] = [];
  const mirrors = rc().releaseSync?.mirrorsDir;
  if (!mirrors) return out;
  try {
    for (const ns of readdirSync(mirrors)) {
      for (const repo of readdirSync(join(mirrors, ns))) if (repo.endsWith('.git')) out.push(`${ns}/${repo.slice(0, -4)}`);
    }
  } catch {}
  return out.sort();
}

export function verifyConfig(): VerifyConfig {
  const commands = verifyCommands();
  return { commands, projects: [...new Set([...Object.keys(commands), ...mirrored()])].sort() };
}

// Writing is desktop-only (webPolicy): a command saved here runs on this machine when a resolution is applied.
export const register: Module = (ctx) => {
  ctx.handle('conflicts:verify-get', () => verifyConfig());
  ctx.handle('conflicts:verify-set', (commands: Record<string, string>) => {
    saveVerifyCommands(commands);
    return verifyConfig();
  });
};
