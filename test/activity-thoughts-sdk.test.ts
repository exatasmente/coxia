// The thinking of the Claude SDK loop as one closed line per turn: the SDK sends one message per content block with the id of the turn, so the blocks of a turn are joined
// and shown once, before that turn's text and tool uses. The SDK is replaced by a scripted `query`: these pin the loop's reading of the messages, not the SDK's behaviour.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
let scripts: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

import { activityLog, setThoughtsGate, withActivityContext } from '../src/main/activity';
import { askAgent, obj, str } from '../src/main/agents';
import { ACTIVITY_THOUGHT_MAX, type ActivityEntry } from '../src/shared/activity';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const block = (messageId: string, content: Record<string, unknown>, parent: string | null = null): Msg => ({ type: 'assistant', parent_tool_use_id: parent, message: { id: messageId, content: [content] } });
const think = (messageId: string, thinking: string, parent: string | null = null): Msg => block(messageId, { type: 'thinking', thinking, signature: 'sig' }, parent);
const say = (messageId: string, text: string, parent: string | null = null): Msg => block(messageId, { type: 'text', text }, parent);
const use = (messageId: string, id: string, name: string, input: Record<string, unknown>, parent: string | null = null): Msg => block(messageId, { type: 'tool_use', id, name, input }, parent);
const done = (toolUseId: string, content: string): Msg => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: false }] } });
const result = (id: string): Msg => ({ type: 'result', subtype: 'success', session_id: id, structured_output: { fala: 'ok' } });

const schema = obj({ fala: str });
const JOB = 'run:sdk-think';
const ask = () => withActivityContext(JOB, () => askAgent<{ fala: string }>('deep', 'Pergunta', schema, { maxTurns: 3 }));
const lines = (entries: readonly ActivityEntry[], runId?: string) => entries.filter((e) => runId === undefined || e.runId === runId).map((e) => [e.kind, e.state ?? '', e.label]);

let pushed: ActivityEntry[] = [];

beforeEach(() => {
  scripts = [];
  pushed = [];
  activityLog.clear();
  setThoughtsGate(null);
  activityLog.setSink((e) => pushed.push(e));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('thinking blocks of the Claude SDK', () => {
  it('joins the blocks of one turn into one line, before that turn\'s text and tool use, and makes none for a turn that did not think', async () => {
    scripts = [
      [
        init('s1'),
        think('m1', 'First I read the file.'),
        think('m1', 'Then I search for the name.'),
        say('m1', 'Reading the file.'),
        use('m1', 'u1', 'Read', { file_path: '/p/one.ts' }),
        done('u1', 'CONTEUDO-DO-ARQUIVO'),
        use('m2', 'u2', 'Grep', { pattern: 'alpha' }),
        done('u2', 'RESULTADO-DO-GREP'),
        think('m3', 'Now I can answer.'),
        result('s1'),
      ],
    ];
    await ask();
    const entries = activityLog.get(JOB);
    expect(entries).toEqual(pushed);
    expect(lines(entries)).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['thought', '', 'First I read the file. Then I search for the name.'],
      ['text', '', 'Reading the file.'],
      ['tool', '', 'Read /p/one.ts'],
      ['tool', '', 'Grep alpha'],
      ['thought', '', 'Now I can answer.'],
      ['status', 'finished', 'Terminou'],
    ]);
    const wire = JSON.stringify(entries);
    for (const leaked of ['CONTEUDO-DO-ARQUIVO', 'RESULTADO-DO-GREP']) expect(wire).not.toContain(leaked);
  });

  it('makes no line for an empty block, a withheld one or a blank one', async () => {
    scripts = [[init('s1'), think('m1', ''), think('m2', '   \n'), block('m3', { type: 'redacted_thinking', data: 'opaque' }), block('m4', { type: 'thinking', signature: 'sig' }), use('m4', 'u1', 'Read', { file_path: '/p/a.ts' }), result('s1')]];
    await ask();
    expect(activityLog.get(JOB).filter((e) => e.kind === 'thought')).toEqual([]);
    expect(lines(activityLog.get(JOB)).map((l) => l[2])).toEqual(['Agente iniciado', 'Read /p/a.ts', 'Terminou']);
  });

  it('keeps the blocks of two turns apart even when no tool use separates them', async () => {
    scripts = [[init('s1'), think('m1', 'Turn one.'), think('m2', 'Turn two.'), result('s1')]];
    await ask();
    expect(activityLog.get(JOB).filter((e) => e.kind === 'thought').map((e) => e.label)).toEqual(['Turn one.', 'Turn two.']);
  });

  it('puts the thinking a sub-agent forwards on its own node', async () => {
    scripts = [
      [
        init('s1'),
        use('m1', 'tu1', 'Agent', { subagent_type: 'explore', description: 'map the tests', prompt: 'p' }),
        think('c1', 'The sub-agent weighs it.', 'tu1'),
        use('c1', 'a1', 'Read', { file_path: '/p/sub.ts' }, 'tu1'),
        done('tu1', 'x'),
        think('m2', 'The parent concludes.'),
        result('s1'),
      ],
    ];
    await ask();
    const entries = activityLog.get(JOB);
    const root = entries.find((e) => !e.parent)?.runId as string;
    const child = entries.find((e) => e.parent)?.runId as string;
    expect(lines(entries, child).map((l) => [l[0], l[2]])).toEqual([['status', 'Agente iniciado'], ['thought', 'The sub-agent weighs it.'], ['tool', 'Read /p/sub.ts'], ['status', 'Terminou']]);
    expect(entries.filter((e) => e.runId === root && e.kind === 'thought').map((e) => e.label)).toEqual(['The parent concludes.']);
  });

  it('masks and cuts what the thinking says, as it does for the other engine', async () => {
    const long = `Bearer abcdefghijklmnopqrstuvwxyz0123456789 ${'word '.repeat(1000)}`;
    scripts = [[init('s1'), think('m1', long), result('s1')]];
    await ask();
    const [thought] = activityLog.get(JOB).filter((e) => e.kind === 'thought');
    expect(thought.label).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(thought.label.length).toBeLessThanOrEqual(ACTIVITY_THOUGHT_MAX);
    expect(thought.label.endsWith('…')).toBe(true);
  });

  it('makes no line while the switch is off', async () => {
    setThoughtsGate(() => false);
    scripts = [[init('s1'), think('m1', 'Hidden.'), use('m1', 'u1', 'Read', { file_path: '/p/a.ts' }), result('s1')]];
    await ask();
    expect(pushed.some((e) => e.kind === 'thought')).toBe(false);
    expect(pushed.map((e) => e.kind)).toEqual(['status', 'tool', 'status']);
  });

  it('flushes a thought left at the end of a call that ended by an error', async () => {
    scripts = [[init('s1'), think('m1', 'Almost there.'), { type: 'result', subtype: 'error_during_execution', session_id: 's1' }]];
    await expect(ask()).rejects.toThrow();
    expect(activityLog.get(JOB).filter((e) => e.kind === 'thought').map((e) => e.label)).toEqual(['Almost there.']);
  });
});
