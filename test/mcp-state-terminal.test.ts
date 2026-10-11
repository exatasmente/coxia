// The terminal bridge (`mcpState.act`): a terminal session's state server calls the persona's tools, and the open app runs them through the persona's door with the terminal as
// the door. A real socket and token in a scratch folder, a fake door: the channel's own rules (owner-only files, a token that must match, the switch read at every call, no
// persona means no door, a closed app refuses) and the shape of what reaches the door (the persona's conversation, the `terminal` door, one session per connection).
import { mkdirSync, mkdtempSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bridgeSocketPath, bridgeTokenPath, createBridgeClient, type BridgeClient } from '../src/main/mcp-state/bridge';
import { actTools } from '../src/main/mcp-state/actTools';
import { createTerminalBridge, TERMINAL_DOOR, type TerminalBridge } from '../src/main/persona/terminal';
import type { Door } from '../src/main/persona/door';
import type { AnswerSession } from '../src/main/persona/session';
import { doorText } from '../src/main/persona/doorText';
import { TOOL_NAMES } from '../src/main/persona/doorTable';
import { ToolError } from '../src/main/engine/open/tools/types';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';

let dir = '';
let bridge: TerminalBridge | null = null;
let client: BridgeClient | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'term-'));
});

afterEach(async () => {
  client?.close();
  client = null;
  await bridge?.stop();
  bridge = null;
});

interface Seen {
  session: AnswerSession;
  tool: string;
  input: Record<string, unknown>;
}

function fakeDoor(answer: (tool: string, input: Record<string, unknown>) => Promise<string> = async () => 'Done.'): Door & { seen: Seen[]; finished: AnswerSession[] } {
  const seen: Seen[] = [];
  const finished: AnswerSession[] = [];
  return {
    seen,
    finished,
    async run(session, tool, input) {
      seen.push({ session, tool, input });
      return answer(tool, input);
    },
    finish(session) {
      finished.push(session);
    },
  };
}

async function open(o: { door?: Door; on?: () => boolean; persona?: () => { id: string; thread: string } | null } = {}): Promise<{ door: Door }> {
  const door = o.door ?? fakeDoor();
  bridge = createTerminalBridge({ dir, door, persona: o.persona ?? (() => ({ id: 'me', thread: 'agent-me' })), on: o.on ?? (() => true) });
  await bridge.start();
  client = createBridgeClient(dir);
  return { door };
}

const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('the app end of the bridge', () => {
  it('listens on a socket and writes a token, both readable by their owner only, and removes both when it stops', async () => {
    await open();
    expect(bridge?.listening()).toBe(true);
    expect(statSync(bridgeSocketPath(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(bridgeTokenPath(dir)).mode & 0o777).toBe(0o600);
    await bridge?.stop();
    expect(bridge?.listening()).toBe(false);
    expect(existsSync(bridgeSocketPath(dir))).toBe(false);
    expect(existsSync(bridgeTokenPath(dir))).toBe(false);
  });

  it('runs a call through the door as the persona, in its conversation, with the terminal as the door and no message to point to', async () => {
    const door = fakeDoor(async (tool, input) => `${tool}.${String(input.op)} ok`);
    await open({ door });
    expect(await client!.call('Runs', { op: 'list', why: 'to see' })).toMatchObject({ text: 'Runs.list ok', isError: false });
    expect(door.seen).toHaveLength(1);
    const { session, tool, input } = door.seen[0];
    expect(tool).toBe('Runs');
    expect(input).toEqual({ op: 'list', why: 'to see' });
    expect(session).toMatchObject({ persona: 'me', thread: 'agent-me', seq: 0, door: TERMINAL_DOOR });
  });

  it('keeps one session per connection, so a write is recorded with what the same session read, and finishes it when the connection closes', async () => {
    const door = fakeDoor();
    await open({ door });
    await client!.call('Runs', { op: 'list' });
    await client!.call('Runs', { op: 'cancel', run: 'r-1', why: 'stale' });
    expect(door.seen[0].session).toBe(door.seen[1].session);
    client!.close();
    await until(() => door.finished.length > 0);
    expect(door.finished).toEqual([door.seen[0].session]);
  });

  it('answers a refusal of the door as a tool error with its words', async () => {
    await open({ door: fakeDoor(async () => { throw new ToolError('The persona is stopped.'); }) });
    expect(await client!.call('Runs', { op: 'list' })).toMatchObject({ text: 'The persona is stopped.', isError: true });
  });

  it('refuses every call while the switch is off, and when the workspace has no persona, without reaching the door', async () => {
    let on = false;
    let persona: { id: string; thread: string } | null = { id: 'me', thread: 'agent-me' };
    const door = fakeDoor();
    await open({ door, on: () => on, persona: () => persona });
    expect(await client!.call('Runs', { op: 'list' })).toMatchObject({ text: doorText('terminal.off'), isError: true });
    on = true;
    persona = null;
    expect(await client!.call('Runs', { op: 'list' })).toMatchObject({ text: doorText('terminal.noPersona'), isError: true });
    expect(door.seen).toHaveLength(0);
  });

  it('refuses a call whose token is not the one the app holds now', async () => {
    const door = fakeDoor();
    await open({ door });
    writeFileSync(bridgeTokenPath(dir), 'not-the-token\n');
    expect(await client!.call('Runs', { op: 'list' })).toEqual({ failure: 'token' });
    expect(door.seen).toHaveLength(0);
  });

  it('a new start writes a new token, so a token read before is worth nothing', async () => {
    await open();
    const first = (await import('node:fs')).readFileSync(bridgeTokenPath(dir), 'utf8');
    await bridge!.stop();
    await bridge!.start();
    expect((await import('node:fs')).readFileSync(bridgeTokenPath(dir), 'utf8')).not.toBe(first);
  });
});

describe('the client with no app', () => {
  it('says the app is closed when there is no token and no socket', async () => {
    client = createBridgeClient(dir);
    expect(await client.call('Runs', { op: 'list' })).toEqual({ failure: 'closed' });
  });
});

describe('the persona tools of the state server', () => {
  const id = 'term-ws';
  let root = '';
  const env = (): NodeJS.ProcessEnv => ({ CERIMONIAS_MCP_WORKSPACE: id, CERIMONIAS_DATA_DIR: root });
  const plant = (mcpState: { enabled: boolean; act: boolean }): string => {
    const ws = join(root, 'workspaces', id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(root, 'workspaces.json'), JSON.stringify({ current: id, list: [{ id, name: 'T', createdAt: '2026-10-03T10:00:00.000Z', test: false }] }));
    writeFileSync(join(ws, 'config.json'), JSON.stringify({ schemaVersion: CONFIG_SCHEMA_VERSION, language: 'en', mcpState }));
    return ws;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'term-root-'));
  });

  it('are not listed unless both switches are on', () => {
    plant({ enabled: true, act: false });
    expect(actTools(env())).toEqual([]);
    plant({ enabled: false, act: true });
    expect(actTools(env())).toEqual([]);
    plant({ enabled: true, act: true });
    expect(actTools(env()).map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('carry the schemas the persona\'s model reads, op required', () => {
    plant({ enabled: true, act: true });
    const runs = actTools(env()).find((t) => t.name === 'Runs')!;
    expect(runs.inputSchema).toMatchObject({ type: 'object', required: ['op'] });
    expect(runs.description).toMatch(/Operations:/);
  });

  it('send each call to the app of the workspace\'s folder, and say why when it did not reach it', async () => {
    const ws = plant({ enabled: true, act: true });
    const calls: [string, string, Record<string, unknown>][] = [];
    let reply: Awaited<ReturnType<BridgeClient['call']>> = { id: 1, text: 'Done.', isError: false };
    const fake = (d: string): BridgeClient => ({ call: async (tool, input) => (calls.push([d, tool, input]), reply), close: () => undefined });
    const runs = actTools(env(), fake).find((t) => t.name === 'Runs')!;
    expect(await runs.run({ op: 'list' } as never)).toEqual({ text: 'Done.', isError: false });
    expect(calls).toEqual([[ws, 'Runs', { op: 'list' }]]);
    for (const failure of ['closed', 'token', 'timeout', 'broken'] as const) {
      reply = { failure };
      expect(await runs.run({ op: 'list' } as never)).toEqual({ text: doorText(`terminal.${failure}`), isError: true });
    }
  });

  it('read the switch again at every call: turned off after the list, the call is refused without reaching the app', async () => {
    plant({ enabled: true, act: true });
    let reached = false;
    const runs = actTools(env(), () => ({ call: async () => ((reached = true), { id: 1, text: 'x', isError: false }), close: () => undefined })).find((t) => t.name === 'Runs')!;
    plant({ enabled: true, act: false });
    expect(await runs.run({ op: 'list' } as never)).toEqual({ text: doorText('terminal.off'), isError: true });
    expect(reached).toBe(false);
  });

  it('end to end: the state server\'s tool reaches a listening app and comes back with the door\'s answer', async () => {
    const ws = plant({ enabled: true, act: true });
    const door = fakeDoor(async () => 'from the app');
    bridge = createTerminalBridge({ dir: ws, door, persona: () => ({ id: 'me', thread: 'agent-me' }), on: () => true });
    await bridge.start();
    const runs = actTools(env()).find((t) => t.name === 'Runs')!;
    expect(await runs.run({ op: 'list' } as never)).toEqual({ text: 'from the app', isError: false });
    expect(door.seen[0].session.door).toBe('terminal');
  });
});
