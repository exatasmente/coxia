export interface WorkspaceInfo {
  id: string;
  name: string;
  createdAt: string;
  test: boolean;
}

export interface Registry {
  current: string;
  list: WorkspaceInfo[];
}

// What the screens get: `current` is the workspace the registry points to, `running` the one this process opened.
export interface WorkspacesView extends Registry {
  running: string;
}

// Module event name: the badge and the settings list follow a flag or name change made anywhere.
export const WORKSPACE_EVENT = 'workspace';
