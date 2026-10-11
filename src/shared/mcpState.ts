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
  /** The second switch is on (and so is the first): a terminal session is also offered the persona's tools. */
  act: boolean;
  /** The workspace has a persona: the persona's tools act through its door, so without one every call is refused. */
  persona: boolean;
  /** The app is listening for a terminal session now (the socket and its token are in the workspace's folder). */
  listening: boolean;
  workspaceId: string;
  /** This install's out/main/mcp-state.js is a plain file node can spawn (never inside an app archive). */
  available: boolean;
  /** The exact {"mcpServers": {"coxia-state": ...}} entry, when enabled and available; the file path inside is machine-local. */
  entry: string | null;
  /** The file the entry spawns, shrunk to "~" for display. */
  path: string | null;
  targets: McpTarget[];
}
