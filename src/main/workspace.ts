import { DATA_ROOT, WORKSPACE_ID } from './env';
import { type WorkspaceInfo, externalWriteRefusal, readRegistry } from './workspaces-core';

export function currentWorkspace(): WorkspaceInfo | null {
  return readRegistry(DATA_ROOT)?.list.find((w) => w.id === WORKSPACE_ID) ?? null;
}

// Fails closed: a registry that cannot be read counts as a test workspace.
export function isTestWorkspace(): boolean {
  return currentWorkspace()?.test !== false;
}

/** The refusal for a write that leaves the machine (GitLab, pushes, spec files, card notes), or null when allowed. */
export function externalRefusal(what: string): string | null {
  return externalWriteRefusal(readRegistry(DATA_ROOT), what);
}

export function assertExternalWrite(what: string): void {
  const message = externalRefusal(what);
  if (message) throw new Error(message);
}
