// Sub-agents of the Claude SDK as nodes of the tree: the SDK marks what a sub-agent produces with the id of the tool use that started it, so two that run at once
// never share a line. The SDK is replaced by a scripted `query`, so these pin the loop's reading of the messages, not the SDK's behaviour.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
type Step = Msg | ((options: Record<string, unknown>) => Promise<void>);
let scripts: Step[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) {
        if (typeof m === 'function') await m(options);
        else yield m;
      }
    })();
  },
}));

import { activityLog, withActivityContext } from '../src/main/activity';
import { askAgent, obj, str } from '../src/main/agents';
import type { ActivityEntry } from '../src/shared/activity';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const use = (id: string, name: string, input: Record<string, unknown>, parent: string | null = null): Msg => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
const say = (text: string, parent: string | null = null): Msg => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text }] } });
const done = (toolUseId: string, content: string, isError = false): Msg => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] } });
const result = (id: string, structured: unknown = { fala: 'ok' }): Msg => ({ type: 'result', subtype: 'success', session_id: id, structured_output: structured });

const schema = obj({ fala: str });
const JOB = 'run:sdk-1';
const ask = () => withActivityContext(JOB, () => askAgent<{ fala: string }>('deep', 'Pergunta', schema, { maxTurns: 3 }));

let pushed: ActivityEntry[] = [];
const ownLines = (entries: ActivityEntry[], runId: string) => entries.filter((e) => e.runId === runId).map((e) => [e.kind, e.state ?? '', e.label]);
const nodesOf = (entries: ActivityEntry[]) => [...new Set(entries.filter((e) => e.parent).map((e) => e.runId))];
const rootOf = (entries: ActivityEntry[]) => entries.find((e) => !e.parent)?.runId as string;

beforeEach(() => {
  scripts = [];
  pushed = [];
  activityLog.clear();
  activityLog.setSink((e) => pushed.push(e));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('sub-agents of the Claude SDK', () => {
  it('gives each its own node, routes interleaved messages by parent_tool_use_id and closes them out of order', async () => {
    scripts = [
      [
        init('s1'),
        use('tu1', 'Agent', { subagent_type: 'explore', description: 'map the tests', prompt: 'long prompt one' }),
        use('tu2', 'Agent', { subagent_type: 'explore', description: 'map the routes', prompt: 'long prompt two' }),
        use('a1', 'Read', { file_path: '/p/one.ts' }, 'tu1'),
        use('b1', 'Read', { file_path: '/p/two.ts' }, 'tu2'),
        use('a2', 'Grep', { pattern: 'alpha' }, 'tu1'),
        use('b2', 'Grep', { pattern: 'beta' }, 'tu2'),
        done('tu2', 'SEGREDO-DO-RESULTADO-B'),
        done('tu1', 'SEGREDO-DO-RESULTADO-A', true),
        use('p1', 'Read', { file_path: '/p/parent.ts' }),
        result('s1'),
      ],
    ];
    await ask();
    const entries = activityLog.get(JOB);
    const root = rootOf(entries);
    const [first, second] = nodesOf(entries);
    expect(nodesOf(entries)).toHaveLength(2);
    expect(ownLines(entries, first)).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['tool', '', 'Read /p/one.ts'],
      ['tool', '', 'Grep alpha'],
      ['status', 'failed', 'Falhou'],
    ]);
    expect(ownLines(entries, second)).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['tool', '', 'Read /p/two.ts'],
      ['tool', '', 'Grep beta'],
      ['status', 'finished', 'Terminou'],
    ]);
    // the parent has its own lines, the two lines that started the sub-agents, and none of theirs
    expect(ownLines(entries, root)).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['tool', '', 'Agent explore: map the tests'],
      ['tool', '', 'Agent explore: map the routes'],
      ['tool', '', 'Read /p/parent.ts'],
      ['status', 'finished', 'Terminou'],
    ]);
    expect(entries.filter((e) => e.runId === first).every((e) => e.parent === root && e.node?.type === 'sub' && e.node.label === 'explore: map the tests')).toBe(true);
    expect(entries.filter((e) => e.runId === second).every((e) => e.parent === root && e.node?.label === 'explore: map the routes')).toBe(true);
    // the sub-agents are one tree of one job, and no tool result reaches the activity
    expect(entries.every((e) => e.jobId === JOB)).toBe(true);
    expect(JSON.stringify(pushed)).not.toContain('SEGREDO');
    expect(pushed).toEqual([...entries].sort((a, b) => a.seq - b.seq));
  });

  it('ends a node left open when the call ends, and one left open by an error as failed', async () => {
    scripts = [[init('s1'), use('tu1', 'Agent', { description: 'wander', prompt: 'p' }), use('a1', 'Read', { file_path: '/p/one.ts' }, 'tu1'), result('s1')]];
    await ask();
    let entries = activityLog.get(JOB);
    const node = nodesOf(entries)[0];
    expect(ownLines(entries, node).at(-1)).toEqual(['status', 'finished', 'Terminou']);
    // a plain sub-agent has no kind: it is headed by "agent"
    expect(entries.find((e) => e.runId === node)?.node?.label).toBe('agent: wander');

    activityLog.clear();
    scripts = [
      [
        init('s2'),
        use('tu9', 'Task', { subagent_type: 'review', description: 'look', prompt: 'p' }),
        async () => {
          throw new Error('stream broke');
        },
      ],
    ];
    await expect(ask()).rejects.toThrow('stream broke');
    entries = activityLog.get(JOB);
    const lost = nodesOf(entries)[0];
    expect(entries.find((e) => e.runId === lost)?.node?.label).toBe('review: look');
    expect(ownLines(entries, lost).at(-1)).toEqual(['status', 'failed', 'Falhou']);
  });

  it('keeps a message of a sub-agent it has no node for on the call itself, as before', async () => {
    scripts = [[init('s1'), use('x1', 'Read', { file_path: '/p/odd.ts' }, 'unknown-parent'), say('Narration of the agent.'), use('x2', 'Grep', { pattern: 'z' }), result('s1')]];
    await ask();
    const entries = activityLog.get(JOB);
    expect(nodesOf(entries)).toEqual([]);
    expect(ownLines(entries, rootOf(entries)).map((l) => l[2])).toEqual(['Agente iniciado', 'Read /p/odd.ts', 'Narration of the agent.', 'Grep z', 'Terminou']);
  });

  it('puts a sub-agent that starts another one under it, and routes the text it is sent when the SDK forwards it', async () => {
    scripts = [
      [
        init('s1'),
        use('tu1', 'Agent', { description: 'outer', prompt: 'p' }),
        say('Outer narration.', 'tu1'),
        use('tu2', 'Agent', { description: 'inner', prompt: 'p' }, 'tu1'),
        use('r1', 'Read', { file_path: '/p/deep.ts' }, 'tu2'),
        done('tu2', 'x'),
        done('tu1', 'x'),
        result('s1'),
      ],
    ];
    await ask();
    const entries = activityLog.get(JOB);
    const [outer, inner] = nodesOf(entries);
    expect(entries.find((e) => e.runId === inner)?.parent).toBe(outer);
    expect(entries.find((e) => e.runId === outer)?.parent).toBe(rootOf(entries));
    expect(ownLines(entries, outer).map((l) => l[2])).toEqual(['Agente iniciado', 'Outer narration.', 'Agent agent: inner', 'Terminou']);
    expect(ownLines(entries, inner).map((l) => l[2])).toEqual(['Agente iniciado', 'Read /p/deep.ts', 'Terminou']);
  });
});
