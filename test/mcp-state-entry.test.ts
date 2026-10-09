// The entry the Settings panel shows and the merge into a project's own .mcp.json (plan D8/D9): derived from the workspace id never stored, a
// non-default data root named in the entry, merge only, a conflicting same-name entry refused.
import { describe, expect, it } from 'vitest';
import { MCP_SERVER_NAME, MCP_WORKSPACE_ENV, mergeMcpEntry, mergeMcpFile, serverEntryText, stateServerEntry } from '../src/main/mcp-state/entry';

const entry = stateServerEntry({ workspaceId: 'state-server-ws', cliPath: '/opt/app/out/main/mcp-state.js', dataRootOverride: null });

describe('the entry derivation', () => {
  it('names the server, spawns node with the built file, and carries the workspace id by environment', () => {
    expect(MCP_SERVER_NAME).toBe('coxia-state');
    expect(entry.command).toBe('node');
    expect(entry.args).toEqual(['/opt/app/out/main/mcp-state.js']);
    expect(entry.env[MCP_WORKSPACE_ENV]).toBe('state-server-ws');
    const text = serverEntryText(entry);
    expect(JSON.parse(text).mcpServers[MCP_SERVER_NAME].env[MCP_WORKSPACE_ENV]).toBe('state-server-ws');
  });

  it('a moved data root is named in the entry; a normal install carries nothing', () => {
    const moved = stateServerEntry({ workspaceId: 'state-server-ws', cliPath: '/opt/app/out/main/mcp-state.js', dataRootOverride: '/data/coxia-root' });
    expect(moved.env.CERIMONIAS_DATA_DIR).toBe('/data/coxia-root');
    expect(entry.env.CERIMONIAS_DATA_DIR).toBeUndefined();
  });
});

describe('the merge write (the person confirms it in the dialog)', () => {
  it('a file with another server merges ours beside it', () => {
    const existing = { mcpServers: { 'other-server': { command: 'npx', args: ['-y', 'some-server'] } } };
    const r = mergeMcpEntry(existing, entry);
    expect(r.ok && r.status).toBe('written');
    const merged = JSON.parse(r.ok ? r.text : '') as { mcpServers: Record<string, unknown> };
    expect(Object.keys(merged.mcpServers).sort()).toEqual(['coxia-state', 'other-server'].sort());
    expect(merged.mcpServers['other-server']).toEqual(existing.mcpServers['other-server']);
  });

  it('a same-name entry with a different program is refused, never replaced', () => {
    const existing = { mcpServers: { [MCP_SERVER_NAME]: { command: 'bun', args: ['/mine/state.js'] } } };
    expect(mergeMcpEntry(existing, entry)).toEqual({ ok: false, conflict: true });
  });

  it('an entry equal to ours is reported as nothing to write', () => {
    expect(mergeMcpEntry({ mcpServers: { [MCP_SERVER_NAME]: entry } }, entry)).toMatchObject({ ok: true, status: 'same' });
  });

  it('a file no server list is (or text that is not one) is refused', () => {
    expect(mergeMcpEntry({ other: 1 }, entry)).toMatchObject({ ok: true, status: 'written' });
    expect(mergeMcpEntry('not json', entry)).toEqual({ ok: false, conflict: true });
  });

  it('a missing file is written whole; a broken file is refused', () => {
    const reads = (text: string | null) => (f: string): string | null => (f === 'present' ? text : null);
    expect(mergeMcpFile(reads('{"mcpServers":{}}'), 'present', entry)).toMatchObject({ ok: true, status: 'written' });
    expect(mergeMcpFile(reads(null), 'absent', entry)).toMatchObject({ ok: true, status: 'written' });
    expect(mergeMcpFile(reads('no'), 'present', entry)).toEqual({ ok: false, conflict: true });
  });
});
