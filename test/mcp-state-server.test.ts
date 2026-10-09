// The stdio framing and dispatch of the local state server over in-memory streams: the initialize/tools-list/tools-call shapes the app's own MCP
// client sends and parses, the refusals (unknown tool, unknown method), malformed lines, and the workspace problems every call answers with.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { serve } from '../src/main/mcp-state/server';
import { stateTools } from '../src/main/mcp-state/tools';
import { MCP_SERVER_NAME } from '../src/main/mcp-state/entry';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';
import { CATALOGS, setLanguage } from '../src/shared/i18n';

const workspaceId = 'terminal-server';
const createdAt = '2026-10-03T10:00:00.000Z';
const ROOTS: string[] = [];

afterEach(() => {
  // Refusals are worded in the default language: each case says which one it asserts in.
  setLanguage('pt-BR');
  ROOTS.length = 0;
});

/** One data root with one workspace named in the registry; `enabled` says whether the workspace opted in. */
function makeRoot(enabled: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'mcp-state-server-'));
  ROOTS.push(root);
  mkdirSync(join(root, 'workspaces', workspaceId), { recursive: true });
  writeFileSync(
    join(root, 'workspaces.json'),
    JSON.stringify({ current: workspaceId, list: [{ id: workspaceId, name: 'Terminal', createdAt, test: false }] }),
  );
  writeFileSync(
    join(root, 'workspaces', workspaceId, 'config.json'),
    JSON.stringify({ schemaVersion: CONFIG_SCHEMA_VERSION, language: 'en', mcpState: { enabled } }),
  );
  return root;
}

type Result = {
  result?: { content?: { type: string; text: string }[]; isError?: boolean; tools?: unknown[]; protocolVersion?: string; serverInfo?: { name: string } };
  error?: { code: number; message: string };
};

const envOf = (root: string, id: string | null = workspaceId): NodeJS.ProcessEnv => ({
  ...(id === null ? {} : { CERIMONIAS_MCP_WORKSPACE: id }),
  CERIMONIAS_DATA_DIR: root,
});

const served = (lines: string[], env: NodeJS.ProcessEnv): Promise<Result[]> => {
  const out: string[] = [];
  return serve(Readable.from(lines.map((l) => `${l}\n`)), { write: (c) => out.push(c) }, env, stateTools).then(() => out.map((line) => JSON.parse(line) as Result));
};

const message = (method: string, params: Record<string, unknown>, id: number): string => JSON.stringify({ jsonrpc: '2.0', id, method, params });

const call = (name: string, id: number, args: Record<string, unknown> = {}): string => message('tools/call', { name, arguments: args }, id);

const textOf = (r: Result): string => (r.result?.content ?? []).map((c) => c.text).join('');

describe('the framing the app itself sends as an MCP client', () => {
  it('answers initialize, lists the six read tools with their schemas, and answers a call with text and no error', async () => {
    const en = CATALOGS.en;
    const out = await served(
      [call('coxia_state_activities', 3)],
      { CERIMONIAS_MCP_WORKSPACE: workspaceId, CERIMONIAS_DATA_DIR: makeRoot(true) },
    );
    expect(textOf(out[0])).toBe(en['main.mcpstate.activitiesEmpty']);
    const listed = await served([message('tools/list', {}, 1)], { CERIMONIAS_MCP_WORKSPACE: workspaceId, CERIMONIAS_DATA_DIR: ROOTS[0] });
    expect((listed[0].result?.tools ?? []).map((tl) => (tl as { name: string }).name)).toEqual([
      'coxia_state_cycles',
      'coxia_state_runs',
      'coxia_state_conversation',
      'coxia_state_evidence',
      'coxia_state_activities',
      'coxia_state_procedures',
    ]);
  });

  it('answers initialize with the 2024-11-05 protocol and its own name', async () => {
    const out = await served([message('initialize', { protocolVersion: '2024-11-05' }, 1)], envOf(makeRoot(true)));
    expect(out[0].result?.protocolVersion).toBe('2024-11-05');
    expect(out[0].result?.serverInfo?.name).toBe(MCP_SERVER_NAME);
  });

  it('ignores a malformed line and a notification, and answers the next request', async () => {
    const out = await served(['not a message', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), call('coxia_state_runs', 4)], envOf(makeRoot(true)));
    expect(out).toHaveLength(1);
    expect(textOf(out[0])).toContain(CATALOGS.en['main.mcpstate.noRuns']);
  });

  it('refuses an unknown tool with an error answer (never a fallthrough) and an unknown method with a JSON-RPC error', async () => {
    const out = await served([call('coxia_state_write', 2), message('workspace/status', {}, 3)], envOf(makeRoot(true)));
    expect(out[0].result?.isError).toBe(true);
    expect(textOf(out[0])).toBe(CATALOGS.en['main.mcpstate.unknownTool'].replace('{name}', 'coxia_state_write'));
    expect(out[1].error?.code).toBe(-32601);
  });
});

describe('the workspace problems (spec rule 7): every call answers the same refusal', () => {
  it('a missing naming says the workspace was not named, on every call', async () => {
    const ref_ = makeRoot(true);
    setLanguage('pt-BR');
    const out = await served([call('coxia_state_cycles', 1), call('coxia_state_activities', 2)], envOf(ref_, null));
    for (const r of out) expect(textOf(r)).toContain('CERIMONIAS_MCP_WORKSPACE');
  });

  it('an id the registry does not know is refused, with the id named', async () => {
    setLanguage('en');
    const root = makeRoot(true);
    const out = await served([call('coxia_state_cycles', 1)], envOf(root, 'other-one'));
    expect(textOf(out[0])).toBe(CATALOGS.en['main.mcpstate.workspaceUnknown'].replace('{id}', 'other-one'));
  });

  it('an id shape that is not one of ours is refused too (never a path)', async () => {
    setLanguage('en');
    const root = makeRoot(true);
    const out = await served([call('coxia_state_cycles', 1)], envOf(root, '../escape'));
    expect(textOf(out[0])).toBe(CATALOGS.en['main.mcpstate.workspaceInvalid'].replace('{id}', '../escape'));
  });

  it('a workspace whose opt-in is off is refused, not read', async () => {
    setLanguage('en');
    const root = makeRoot(false);
    const out = await served([call('coxia_state_cycles', 1)], envOf(root));
    expect(textOf(out[0])).toBe(CATALOGS.en['main.mcpstate.workspaceOff']);
  });
});
