// What the Settings screen (mcpstate:get) shows about the local state server of the running workspace: the opt-in, the entry to add to a
// terminal session when it is on, and the project folders it may be written into.

export interface McpTarget {
  /** The folder, with the home folder shrunk to "~". */
  path: string;
  /** The project folder already carries a .mcp.json. */
  exists: boolean;
}

export interface McpStateView {
  /** The workspace's opt-in (`mcpState.enabled` in its config). */
  enabled: boolean;
  workspaceId: string;
  /** This install's out/main/mcp-state.js is a plain file node can spawn (never inside an app archive). */
  available: boolean;
  /** The exact {"mcpServers": {"coxia-state": ...}} entry, when enabled and available; the file path inside is machine-local. */
  entry: string | null;
  /** The file the entry spawns, shrunk to "~" for display. */
  path: string | null;
  targets: McpTarget[];
}
