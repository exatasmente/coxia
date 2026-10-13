import { dataRoot, workspaceId } from './env';
import { requireOwner } from './ownership';
import { type WorkspaceInfo, externalWriteRefusal, readRegistry } from './workspaces-core';

export function currentWorkspace(): WorkspaceInfo | null {
  return readRegistry(dataRoot())?.list.find((w) => w.id === workspaceId()) ?? null;
}

// Fails closed: a registry that cannot be read counts as a test workspace.
export function isTestWorkspace(): boolean {
  return currentWorkspace()?.test !== false;
}

/** The refusal for a write that leaves the machine (GitLab, pushes, spec files, card notes), or null when allowed. */
export function externalRefusal(what: string): string | null {
  // The flag of the workspace this process runs, which is not the registry's current one when a process was started for another workspace.
  const reg = readRegistry(dataRoot());
  return externalWriteRefusal(reg && { ...reg, current: workspaceId() }, what);
}

export function assertExternalWrite(what: string): void {
  // A client of the workspace never writes outside the machine: only its owner does (#209).
  requireOwner();
  const message = externalRefusal(what);
  if (message) throw new Error(message);
}
