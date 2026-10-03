import type { RepoConfig, WorkspaceConfig } from './config/types';
import { parseRemote } from './wizard';

// The verification command of a conflict resolution is kept per project, by the "group/project" string the conflict flow names a project with
// (the path on the code host, any depth of groups). The same functions decide what a workspace lists, what the startup move claims and what
// a config may hold, so the three cannot disagree.

export const VERIFY_PROJECT = /^[\w.-]+(\/[\w.-]+)+$/;
export const VERIFY_COMMAND_MAX = 2000;

export function isVerifyProject(key: string): boolean {
  return VERIFY_PROJECT.test(key) && !key.includes('..');
}

/** The project a repo is on the host: its explicit path, else the one in its remote URL. Null for a repo with no usable remote (a local folder). */
export function repoProjectPath(repo: Pick<RepoConfig, 'projectPath' | 'remoteUrl'>): string | null {
  const own = repo.projectPath?.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/, '') ?? '';
  const path = own || parseRemote(repo.remoteUrl)?.projectPath || '';
  return path && isVerifyProject(path) ? path : null;
}

/** Projects a workspace lists on the verification screen and claims in the startup move: its repositories and the projects of its release mirrors. */
export function ownVerifyProjects(config: Pick<WorkspaceConfig, 'projects'>, mirrors: string[]): string[] {
  const own = config.projects.repos.map(repoProjectPath).filter((p): p is string => p !== null);
  return [...new Set([...own, ...mirrors.filter(isVerifyProject)])].sort();
}

/** The commands of a workspace that are not blank, trimmed. */
export function activeVerifyCommands(config: Pick<WorkspaceConfig, 'projects'>): Record<string, string> {
  return Object.fromEntries(Object.entries(config.projects.verifyCommands ?? {}).flatMap(([k, v]) => (typeof v === 'string' && v.trim() ? [[k, v.trim()]] : [])));
}
