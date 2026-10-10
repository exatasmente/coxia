// The setup entry a terminal session adds for the local state server, and the merge of it into a project's own {mcpServers} file. Electron-free:
// the module holds the pure shapes so tests work on plain objects, and the write is the person's confirmed action in Settings (never automatic).

export const MCP_SERVER_NAME = 'coxia-state';
export const MCP_WORKSPACE_ENV = 'CERIMONIAS_MCP_WORKSPACE';
export const MCP_DATA_DIR_ENV = 'CERIMONIAS_DATA_DIR';

/** The entry for one workspace of this machine: plain node, the built out/main/mcp-state.js file, the workspace id by environment. */
export function stateServerEntry(input: { workspaceId: string; cliPath: string; dataRootOverride: string | null }): { type: 'stdio'; command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { [MCP_WORKSPACE_ENV]: input.workspaceId };
  // Non-default data roots are named in the entry, the way the app itself resolves its data root; a normal install needs nothing.
  if (input.dataRootOverride) env[MCP_DATA_DIR_ENV] = input.dataRootOverride;
  return { type: 'stdio', command: 'node', args: [input.cliPath], env };
}

export const serverEntryText = (entry: ReturnType<typeof stateServerEntry>): string =>
  JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: entry } }, null, 2);

export type MergeResult = { ok: true; text: string; status: 'written' | 'same' } | { ok: false; conflict: true };

/** Whether two entries serve the same program in the same way: an equal name with a different command is a person-maintained file's entry, not ours. */
const sameEntry = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  a.command === b.command && JSON.stringify(a.args ?? null) === JSON.stringify(b.args ?? null) && JSON.stringify(a.env ?? null) === JSON.stringify(b.env ?? null);

/** Merges our entry into the parsed (or not-yet-existing) .mcp.json: other servers and the person's own fields stand, a conflicting same-name entry is refused. */
export function mergeMcpEntry(existing: unknown, entry: ReturnType<typeof stateServerEntry>): MergeResult {
  if (existing === undefined || existing === null) return { ok: true, status: 'written', text: serverEntryText(entry) };
  if (typeof existing !== 'object' || Array.isArray(existing)) return { ok: false, conflict: true };
  const doc = existing as Record<string, unknown>;
  let servers: Record<string, unknown> = {};
  if (doc.mcpServers !== undefined && doc.mcpServers !== null) {
    if (typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) return { ok: false, conflict: true };
    servers = doc.mcpServers as Record<string, unknown>;
  }
  const there = servers[MCP_SERVER_NAME];
  if (there && (typeof there !== 'object' || Array.isArray(there) || !sameEntry(there as Record<string, unknown>, entry)))
    return { ok: false, conflict: true };
  if (there) return { ok: true, status: 'same', text: serverEntryText(entry) };
  const text = JSON.stringify({ ...doc, mcpServers: { ...servers, [MCP_SERVER_NAME]: entry } }, null, 2);
  return { ok: true, status: 'written', text };
}

/** Reads and merges one file: the file's own text, or nothing when it does not exist. */
export function mergeMcpFile(read: (file: string) => string | null, file: string, entry: ReturnType<typeof stateServerEntry>): MergeResult {
  const text = read(file);
  if (text === null) return mergeMcpEntry(undefined, entry);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, conflict: true };
  }
  return mergeMcpEntry(parsed, entry);
}
