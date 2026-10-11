// The open engine feeds a text sink for a call with no schema (the persona's chat): the pieces in order, the text of a tool turn moved out as narration, a restart when the
// model changes or the attempt fails, nothing from a sub-agent, and the whole text once at the end. Nothing reaches a model: the engine talks to a local fake.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activityLog, withActivityContext } from '../src/main/activity';
import { obj, runAgent, str } from '../src/main/agents';
import type { TextSink } from '../src/main/engine/contract';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { type Fake, type FakeRequest, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let root: string;
let fake: Fake;
let script: (req: FakeRequest) => ReturnType<typeof textStep>;

type Event = ['piece', string] | ['restart'] | ['settle', string];
const spy = (): { sink: TextSink; events: Event[]; pieces: () => string[] } => {
  const events: Event[] = [];
  return { events, sink: { piece: (t) => events.push(['piece', t]), restart: () => events.push(['restart']), settle: (t) => events.push(['settle', t]) }, pieces: () => events.flatMap((e) => (e[0] === 'piece' ? [e[1]] : [])) };
};
/** The events with a run of restarts as one, and none before the first piece: the engine says it at more than one seam and the sink treats it as idempotent. */
const collapsed = (events: Event[]): Event[] => events.filter((e, i) => !(e[0] === 'restart' && (events[i - 1]?.[0] === 'restart' || !events.slice(0, i).some((x) => x[0] === 'piece'))));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'persona-stream-open-'));
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'hello\n');
  fake = await fakeOpenAI((req) => script(req));
  const { updateConfig } = await import('../src/main/workspaceConfig');
  updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
    return c;
  });
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.requests.length = 0;
  activityLog.clear();
});

const agent = (over = {}) => newAgent({ id: 'me', permission: 'read', model: { role: null, provider: 'local', model: 'qwen3:8b' }, ...over });
const plain = (text: TextSink | undefined, over: Record<string, unknown> = {}) => ({ agent: agent(), prompt: 'p', system: 'sys', cwd: root, label: 'me', maxTurns: 6, ...(text ? { text } : {}), ...over });
const toolMessages = (req: FakeRequest): number => ((req.body?.messages ?? []) as { role: string }[]).filter((m) => m.role === 'tool').length;

describe('a call with no schema on the open engine', () => {
  it('sends the pieces in order as each arrives, then the whole text once, and returns it as the data', async () => {
    const TEXT = 'The quick brown fox jumps over the lazy dog.';
    script = () => textStep(TEXT, { pieces: 5 });
    const { sink, events, pieces } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe(TEXT);
    expect(pieces()).toHaveLength(5);
    expect(pieces().join('')).toBe(TEXT);
    expect(events.at(-1)).toEqual(['settle', TEXT]);
    // the call asked the server for no structured answer
    const body = fake.chats()[0].body as Record<string, any>;
    expect(body.response_format).toBeUndefined();
    expect((body.tools ?? []).map((x: any) => x.function.name)).not.toContain('final_answer');
  });

  it('moves the text of a turn that ends in tool calls out of the answer, as narration, and starts again for the next turn', async () => {
    script = (req) => (toolMessages(req) === 0 ? toolStep([{ id: 'r1', name: 'Read', args: { file_path: 'a.txt' } }], { text: 'Let me read the file first.' }) : textStep('It says hello.', { pieces: 3 }));
    const { sink, events } = spy();
    const r = await withActivityContext('mention:agent-me', () => runAgent<string>(plain(sink)));
    expect(r.data).toBe('It says hello.');
    const seq = collapsed(events);
    expect(seq[0]).toEqual(['piece', 'Let me read the file first.']);
    expect(seq[1]).toEqual(['restart']);
    expect(seq.slice(2).filter((e) => e[0] === 'piece').map((e) => e[1]).join('')).toBe('It says hello.');
    expect(seq.at(-1)).toEqual(['settle', 'It says hello.']);
    // the narration is in the activity, where it always went
    expect(activityLog.get('mention:agent-me').some((e) => e.kind === 'text' && e.label === 'Let me read the file first.')).toBe(true);
  });

  it('restarts when a message that arrived during the last turn is delivered, so the text written before it is not the answer', async () => {
    script = (req) => (((req.body?.messages ?? []) as { role: string; content?: unknown }[]).some((m) => m.role === 'user' && String(m.content).includes('one more thing')) ? textStep('The real answer.', { pieces: 2 }) : textStep('A first draft.', { pieces: 2 }));
    let waiting: string | null = 'one more thing';
    const incoming = async () => {
      const m = waiting;
      waiting = null;
      return m;
    };
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink, { incoming }));
    expect(r.data).toBe('The real answer.');
    const seq = collapsed(events);
    expect(seq.map((e) => e[0])).toEqual(['piece', 'piece', 'restart', 'piece', 'piece', 'settle']);
    expect(seq.at(-1)).toEqual(['settle', 'The real answer.']);
  });

  it('restarts when the attempt fails after it began to write, and the failure goes up', async () => {
    // The server reports a failure inside the stream, after three pieces.
    script = () => ({ chunks: ['Half ', 'of a ', 'sentence'].map((content, i) => ({ choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content } : { content } }] })).concat([{ error: { message: 'upstream exploded', type: 'server_error' } } as never]) });
    const { sink, events } = spy();
    await expect(runAgent<string>(plain(sink))).rejects.toThrow();
    expect(events.filter((e) => e[0] === 'piece').map((e) => e[1]).join('')).toBe('Half of a sentence');
    expect(events.at(-1)).toEqual(['restart']);
    expect(events.some((e) => e[0] === 'settle')).toBe(false);
  });

  it('restarts when the model moves to the next one of its pool, so the first one\'s pieces are not the answer', async () => {
    const spare = await fakeOpenAI(() => textStep('The spare model answers.', { pieces: 3 }));
    const { updateConfig } = await import('../src/main/workspaceConfig');
    updateConfig((c) => {
      c.llm.providers.push(newProvider({ id: 'spare', kind: 'openai-compatible', baseUrl: spare.url, structured: 'tool' }));
      return c;
    });
    try {
      // the first model writes a few pieces and then reports that it is busy, inside the stream
      script = () => ({ chunks: [{ choices: [{ index: 0, delta: { role: 'assistant', content: 'The first model be' } }] }, { choices: [{ index: 0, delta: { content: 'gins to say' } }] }, { error: { message: 'Model is busy', type: 'engine_overloaded', code: 'engine_overloaded' } }] });
      const pooled = agent({ model: { role: null, provider: 'local', model: 'qwen3:8b', fallbacks: [{ provider: 'spare', model: 'qwen3:8b' }] } });
      const { sink, events } = spy();
      const r = await runAgent<string>(plain(sink, { agent: pooled }));
      expect(r.data).toBe('The spare model answers.');
      const seq = collapsed(events);
      const firstRestart = seq.findIndex((e) => e[0] === 'restart');
      expect(seq.slice(0, firstRestart).map((e) => e[1]).join('')).toBe('The first model begins to say');
      expect(seq.slice(firstRestart + 1).filter((e) => e[0] === 'piece').map((e) => e[1]).join('')).toBe('The spare model answers.');
      expect(seq.at(-1)).toEqual(['settle', 'The spare model answers.']);
    } finally {
      await spare.close();
    }
  });

  it('never gives the sink what a sub-agent writes: three that run at once are tool results for their parent', async () => {
    const TASKS = ['A', 'B', 'C'];
    script = (req) => {
      const messages = (req.body?.messages ?? []) as { role: string; content: unknown }[];
      const tools = ((req.body?.tools ?? []) as { function: { name: string } }[]).map((x) => x.function.name);
      if (tools.includes('Agent')) {
        return toolMessages(req) === 0
          ? toolStep(TASKS.map((t) => ({ id: `d${t}`, name: 'Agent', args: { description: `look at ${t}`, prompt: `task ${t}: say something about ${t}`, subagent_type: 'explore' } })), { text: 'I will split the work.' })
          : textStep('The three agreed.', { pieces: 3 });
      }
      const first = String(messages.find((m) => m.role === 'user')?.content ?? '');
      const who = TASKS.find((t) => first.includes(`task ${t}:`)) ?? 'A';
      return textStep(`SUB-AGENT-${who} says its long piece of text`, { pieces: 4 });
    };
    const { sink, events, pieces } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('The three agreed.');
    expect(fake.chats().some((c) => ((c.body?.tools ?? []) as { function: { name: string } }[]).every((x) => x.function.name !== 'Agent'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain('SUB-AGENT');
    expect(pieces().join('')).toBe('I will split the work.The three agreed.');
    expect(collapsed(events).filter((e) => e[0] === 'restart')).toHaveLength(1);
  });

  it('shows the whole text once, at the end, when the server did not stream it', async () => {
    script = () => ({ completion: { choices: [{ index: 0, message: { role: 'assistant', content: 'One whole message.' }, finish_reason: 'stop' }] } }) as never;
    const { sink, events } = spy();
    const r = await runAgent<string>(plain(sink));
    expect(r.data).toBe('One whole message.');
    expect(collapsed(events)).toEqual([['piece', 'One whole message.'], ['settle', 'One whole message.']]);
  });

  it('feeds nothing and changes nothing for a call with a schema', async () => {
    script = () => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'structured' } }]);
    const { sink, events } = spy();
    const r = await runAgent<{ fala: string }>({ ...plain(sink), schema: obj({ fala: str }) });
    expect(r.data).toEqual({ fala: 'structured' });
    expect(events.some((e) => e[0] === 'settle')).toBe(false);
  });

  it('is the text that returns, whole, with no sink at all', async () => {
    script = () => textStep('No sink asked.', { pieces: 2 });
    expect((await runAgent<string>(plain(undefined))).data).toBe('No sink asked.');
  });
});
