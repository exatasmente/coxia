import { DATA_ROOT } from './env';
import { getConfig, rc, updateConfig } from './workspaceConfig';
import type { Module } from './module';
import { t } from '../shared/i18n';
import { VERIFY_COMMAND_MAX, activeVerifyCommands, isVerifyProject, ownVerifyProjects } from '../shared/verifyCommands';
import { readUnclaimed } from './verify-move';
import { mirroredProjects } from './verifyProjects';

// Per project ("<group>/<project>") shell command that checks a conflict resolution in its worktree, kept in the workspace configuration
// (projects.verifyCommands). Empty: none. The commands of the file that used to be shared by every workspace are moved at startup (verify-move.ts).

export interface VerifyConfig {
  commands: Record<string, string>;
  // What the screen lists: this workspace's repositories and release mirrors, plus any project that already has a command here.
  projects: string[];
  // Commands of the earlier shared file that no workspace listed, minus the ones this workspace has a command for now.
  unclaimed: Record<string, string>;
}

export function verifyCommands(): Record<string, string> {
  return activeVerifyCommands(getConfig());
}

export function verifyCommandFor(project: string): string | null {
  return verifyCommands()[project] ?? null;
}

export function validateVerify(commands: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [project, command] of Object.entries(commands)) {
    if (!isVerifyProject(project)) throw new Error(t('main.conflictVerify.project', { project }));
    if (typeof command !== 'string' || command.includes('\0')) throw new Error(t('main.conflictVerify.command', { project }));
    if (command.length > VERIFY_COMMAND_MAX) throw new Error(t('main.conflictVerify.tooLong', { project, max: VERIFY_COMMAND_MAX }));
    if (command.trim()) out[project] = command.trim();
  }
  return out;
}

/** Replaces the commands of the active workspace. */
export function saveVerifyCommands(commands: Record<string, string>): Record<string, string> {
  const clean = validateVerify(commands);
  updateConfig((c) => ({ ...c, projects: { ...c.projects, verifyCommands: clean } }));
  return clean;
}

export function verifyConfig(): VerifyConfig {
  const config = getConfig();
  const commands = activeVerifyCommands(config);
  const mirrors = mirroredProjects(rc().releaseSync?.mirrorsDir);
  const projects = [...new Set([...ownVerifyProjects(config, mirrors), ...Object.keys(commands)])].sort();
  const unclaimed = Object.fromEntries(Object.entries(readUnclaimed(DATA_ROOT)).filter(([project]) => !(project in commands)));
  return { commands, projects, unclaimed };
}

// Writing is desktop-only (webPolicy): a command saved here runs on this machine when a resolution is applied.
export const register: Module = (ctx) => {
  ctx.handle('conflicts:verify-get', () => verifyConfig());
  ctx.handle('conflicts:verify-set', (commands: Record<string, string>) => {
    saveVerifyCommands(commands);
    return verifyConfig();
  });
};
