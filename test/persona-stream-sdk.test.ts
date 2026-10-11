// The Claude engine feeds a text sink for a call with no schema (the persona's chat): partial messages are asked for, the text deltas of the call's own turns reach the
// sink in order, a tool turn restarts it, a sub-agent's never reaches it, the thinking of a turn stays one line, and a success result with no structured output is the
// answer. The SDK is replaced by a script: this pins what the app does with what the SDK sends; what the SDK really sends was checked once by hand outside the suite
// (3_IMPLEMENTATION.md).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: unknown; options: Record<string, any> }[] = [];
let queue: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, any> }) => {
    calls.push({ prompt, options });
    const turn = queue.shift() ?? [];
    return (async function* () {
      yield* turn;
    })();
  },
}));

import { activityLog, setThoughtsGate, withActivityContext } from '../src/main/activity';
import { obj, runAgent, str } from '../src/main/agents';
import type { TextSink } from '../src/main/engine/contract';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret } from './helpers/config';

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(async () => {
  calls.length = 0;
  queue = [];
  activityLog.clear();
  setThoughtsGate(() => true);
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], kind: 'anthropic', baseUrl: 'https://api.anthropic.com', id: 'llm-target' }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

type Event = ['piece', string] | ['restart'] | ['settle', string];
const spy = (): { sink: TextSink; events: Event[] } => {
  const events: Event[] = [];
  return { events, sink: { piece: (t) => events.push(['piece', t]), restart: () => events.push(['restart']), settle: (t) => events.push(['settle', t]) } };
};
const written = (events: Event[]): string => events.flatMap((e) => (e[0] === 'piece' ? [e[1]] : [])).join('');

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const delta = (text: string, parent: string | null = null): Msg => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent_tool_use_id: parent, session_id: 's1' });
const thinkingDelta = (thinking: string): Msg => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } }, parent_tool_use_id: null, session_id: 's1' });
const messageStart = (parent: string | null = null): Msg => ({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm' } }, parent_tool_use_id: parent, session_id: 's1' });
const blockStart = (type: string): Msg => ({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type } }, parent_tool_use_id: null, session_id: 's1' });
const say = (text: string, id = 'm1', parent: string | null = null): Msg => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }] }, parent_tool_use_id: parent });
const think = (thinking: string, id = 'm1'): Msg => ({ type: 'assistant', message: { id, content: [{ type: 'thinking', thinking }] }, parent_tool_use_id: null });
const toolUse = (name: string, input: Record<string, unknown>, id = 't1', parent: string | null = null, msg = 'm1'): Msg => ({ type: 'assistant', message: { id: msg, content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: parent });
const toolResult = (id = 't1'): Msg => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: false }] } });
const done = (result: string | undefined, extra: Msg = {}): Msg => ({ type: 'result', subtype: 'success', session_id: 's1', ...(result === undefined ? {} : { result }), ...extra });

const agent = newAgent({ id: 'me', permission: 'read' });
const plain = (sink?: TextSink, over: Record<string, unknown> = {}) => ({ agent, prompt: 'hello', system: 'sys', cwd: '/tmp', label: 'me', maxTurns: 5, ...(sink ? { text: sink } : {}), ...over });

describe('a call with no schema on the Claude engine', () => {
  it('asks for partial messages only when a sink is given, and for a structured output only when a schema is', async () => {
    queue = [[init('s1'), done('a')], [init('s1'), done('b')], [init('s1'), done('c', { structured_output: { fala: 'x' } })]];
    await runAgent(plain(spy().sink));
    await runAgent(plain());
    await runAgent({ ...plain(), schema: obj({ fala: str }) });
    const [withSink, without, structured] = calls.map((c) => c.options);
    expect(withSink.includePartialMessages).toBe(true);
    expect(withSink.outputFormat).toBeUndefined();
    expect(without.includePartialMessages).toBeUndefined();
    expect(without.outputFormat).toBeUndefined();
    expect(structured.includePartialMessages).toBeUndefined();
    expect(structured.outputFormat).toMatchObject({ type: 'json_schema' });
  });

  it('sends the text deltas in order, then the result as the whole text, which is the data', async () => {
    queue = [[init('s1'), messageStart(), delta('The quick '), delta('brown fox '), delta('jumps.'), say('The quick brown fox jumps.'), done('The quick brown fox jumps.')]];
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('The quick brown fox jumps.');
    expect(events.filter((e) => e[0] === 'piece').map((e) => e[1])).toEqual(['The quick ', 'brown fox ', 'jumps.']);
    expect(events.filter((e) => e[0] === 'restart')).toHaveLength(1);
    expect(events.at(-1)).toEqual(['settle', 'The quick brown fox jumps.']);
  });

  it('moves the narration of a tool turn out of the answer the moment its tool use arrives, and the next turn starts again', async () => {
    queue = [
      [
        init('s1'),
        messageStart(),
        delta('Let me look. '),
        say('Let me look. '),
        blockStart('tool_use'),
        toolUse('Read', { file_path: '/tmp/a' }),
        toolResult(),
        messageStart(),
        delta('It says '),
        delta('hello.'),
        say('It says hello.', 'm2'),
        done('It says hello.'),
      ],
    ];
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('It says hello.');
    const seq = events.filter((e, i) => !(e[0] === 'restart' && events[i - 1]?.[0] === 'restart'));
    const at = seq.findIndex((e) => e[0] === 'restart' && seq.slice(0, seq.indexOf(e)).some((x) => x[0] === 'piece'));
    expect(seq.slice(0, at).filter((e) => e[0] === 'piece').map((e) => e[1]).join('')).toBe('Let me look. ');
    expect(seq.slice(at + 1).filter((e) => e[0] === 'piece').map((e) => e[1]).join('')).toBe('It says hello.');
    expect(seq.at(-1)).toEqual(['settle', 'It says hello.']);
  });

  it('restarts at the tool use block of the assistant message even when no partial event announced it', async () => {
    queue = [[init('s1'), delta('Looking. '), say('Looking. '), toolUse('Read', { file_path: '/tmp/a' }), toolResult(), delta('Done.'), say('Done.', 'm2'), done('Done.')]];
    const { sink, events } = spy();
    await runAgent<string>(plain(sink));
    const i = events.findIndex((e) => e[0] === 'restart' && events.slice(0, events.indexOf(e)).some((x) => x[0] === 'piece'));
    expect(i).toBeGreaterThan(0);
    expect(events.slice(i + 1).filter((e) => e[0] === 'piece').map((e) => e[1]).join('')).toBe('Done.');
  });

  it('never gives the sink what a sub-agent streams or the tool use of one, two of them interleaved with the call\'s own text', async () => {
    queue = [
      [
        init('s1'),
        messageStart(),
        delta('Splitting the work. '),
        say('Splitting the work. '),
        toolUse('Agent', { description: 'look at A', prompt: 'task A', subagent_type: 'explore' }, 'tA'),
        toolUse('Agent', { description: 'look at B', prompt: 'task B', subagent_type: 'explore' }, 'tB', null, 'm1'),
        messageStart('tA'),
        delta('SUB-A is writing a long text', 'tA'),
        delta('SUB-B is writing too', 'tB'),
        toolUse('Read', { file_path: '/tmp/a' }, 'r1', 'tA', 'ma'),
        toolResult('tA'),
        toolResult('tB'),
        messageStart(),
        delta('Both agreed.'),
        say('Both agreed.', 'm2'),
        done('Both agreed.'),
      ],
    ];
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('Both agreed.');
    expect(JSON.stringify(events)).not.toContain('SUB-');
    expect(written(events)).toBe('Splitting the work. Both agreed.');
    // the sub-agent's tool use did not restart the call's text: one restart for the call's own tool uses (the Agent calls), none for the Read of the sub-agent
    expect(events.filter((e, i) => e[0] === 'restart' && events.slice(0, i).some((x) => x[0] === 'piece')).length).toBe(1);
  });

  it('keeps the thinking of one turn as one line when partial events fall between its blocks', async () => {
    queue = [[init('s1'), messageStart(), think('First I weigh the question.'), thinkingDelta('x'), blockStart('thinking'), think('Then I weigh the answer.'), delta('Answer.'), say('Answer.'), done('Answer.')]];
    const { sink } = spy();
    await withActivityContext('mention:agent-me', () => runAgent<string>(plain(sink)));
    const thoughts = activityLog.get('mention:agent-me').filter((e) => e.kind === 'thought');
    expect(thoughts.map((t) => t.label)).toEqual(['First I weigh the question. Then I weigh the answer.']);
  });

  it('falls back to the last text the call wrote when the result carries none, and ends the call', async () => {
    queue = [[init('s1'), say('An earlier turn.'), toolUse('Read', { file_path: '/tmp/a' }, 't9', null, 'm2'), toolResult('t9'), say('The last words.', 'm3'), done('')]];
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('The last words.');
    expect(events.at(-1)).toEqual(['settle', 'The last words.']);
  });

  it('shows the whole text once, at the end, when the SDK sent no partial message at all', async () => {
    queue = [[init('s1'), say('Whole at once.'), done('Whole at once.')]];
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('Whole at once.');
    expect(events.filter((e) => e[0] === 'piece')).toEqual([]);
    expect(events.filter((e) => e[0] === 'settle')).toEqual([['settle', 'Whole at once.']]);
  });

  it('keeps the failure for an error result, with the provider\'s own text, and settles nothing', async () => {
    queue = [[init('s1'), delta('Half of it'), { type: 'result', subtype: 'error_during_execution', session_id: 's1', result: 'upstream said no' }]];
    const { sink, events } = spy();
    await expect(runAgent<string>(plain(sink))).rejects.toThrow(/agent failed: upstream said no/);
    expect(events.some((e) => e[0] === 'settle')).toBe(false);
  });

  it('still fails a call with a schema whose result has no structured output', async () => {
    queue = [[init('s1'), done('some text')]];
    await expect(runAgent({ ...plain(), schema: obj({ fala: str }) })).rejects.toThrow(/agent failed/);
  });

  it('does not stream a call that has a schema and a sink: the structured answer is the data', async () => {
    queue = [[init('s1'), delta('{"fala"'), done(undefined, { structured_output: { fala: 'ok' } })]];
    const { sink } = spy();
    const r = await runAgent<{ fala: string }>({ ...plain(sink), schema: obj({ fala: str }) });
    expect(r.data).toEqual({ fala: 'ok' });
  });
});
