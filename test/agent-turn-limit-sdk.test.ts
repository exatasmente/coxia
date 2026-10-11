// A stage on the Claude engine that reaches `maxTurns` asks the person too (#246), and "continue" resumes the same session with a fresh limit. The SDK is replaced
// by a script, so this pins what the app does around it (the question, the resume, the sources); that the real SDK continues a session after `error_max_turns` was
// seen once by hand, outside the suite (3_IMPLEMENTATION.md).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: unknown; options: Record<string, any> }[] = [];
const seen: string[] = [];
let queue: Msg[][][] = [];

// A string prompt yields the first turn; a stream (a call with a door) yields one turn per message it carries, as the SDK keeps the session open between turns.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, any> }) => {
    calls.push({ prompt, options });
    const turns = queue.shift() ?? [];
    return (async function* () {
      if (typeof prompt === 'string') {
        yield* turns[0] ?? [];
        return;
      }
      let i = 0;
      for await (const message of prompt as AsyncIterable<{ message: { content: string } }>) {
        seen.push(message.message.content);
        yield* turns[i] ?? [];
        i++;
      }
    })();
  },
}));

import { activityLog, withActivityContext } from '../src/main/activity';
import { CLAUDE_CAN_CONTINUE, obj, runAgent, str } from '../src/main/agents';
import { MaxTurnsError, type TurnDecision, type TurnLimit, type TurnStop } from '../src/main/engine/contract';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret } from './helpers/config';

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(async () => {
  calls.length = 0;
  seen.length = 0;
  queue = [];
  activityLog.clear();
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], kind: 'anthropic', baseUrl: 'https://api.anthropic.com', id: 'llm-target' }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const read = (file: string): Msg => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: file } }] } });
const result = (subtype: string, id: string, structured?: unknown): Msg => ({ type: 'result', subtype, session_id: id, ...(structured === undefined ? {} : { structured_output: structured }) });
/** One call of the SDK as a script: one turn for a string prompt. */
const script = (...messages: Msg[]): Msg[][] => [messages];

const agent = newAgent({ id: 'refiner', permission: 'read' });
const schema = obj({ fala: str });
const call = (turnLimit: TurnLimit | undefined, over: Record<string, unknown> = {}) => ({ agent, prompt: 'work the stage', schema, system: 'sys', cwd: '/tmp', label: 'refiner', maxTurns: 5, turnLimit, ...over });

/** An asker that answers with the given decisions in order and keeps what it was asked. */
function asker(...decisions: TurnDecision[]): { limit: TurnLimit; stops: TurnStop[] } {
  const stops: TurnStop[] = [];
  const left = [...decisions];
  return { stops, limit: { own: true, ask: async (stop) => (stops.push(stop), left.shift() ?? 'finish') } };
}

describe('a stage on the Claude engine that reaches its turn limit', () => {
  it('is known to continue: the constant the question carries', () => {
    expect(CLAUDE_CAN_CONTINUE).toBe(true);
  });

  it('asks, and on continue resumes the same session with a fresh limit, the same schema and tools, and a new prompt', async () => {
    queue = [script(init('s1'), read('a.ts'), result('error_max_turns', 's1')), script(init('s1'), read('b.ts'), result('success', 's1', { fala: 'done' }))];
    const { limit, stops } = asker('continue');
    const r = await withActivityContext('run:r-sdk-1', () => runAgent<{ fala: string }>(call(limit)));
    expect(r.data).toEqual({ fala: 'done' });
    expect(stops).toEqual([{ of: 'stage', role: expect.any(String), kind: null, name: null, task: '', used: 5, round: 5, granted: 0, canContinue: true }]);
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(first.prompt).toBe('work the stage');
    expect(first.options.maxTurns).toBe(5);
    expect(first.options.resume).toBeUndefined();
    expect(second.options).toMatchObject({ resume: 's1', maxTurns: 5 });
    expect(second.prompt).toMatch(/limit|limite/i);
    expect(second.prompt).not.toBe(first.prompt);
    expect(second.options.outputFormat).toEqual(first.options.outputFormat);
    expect(second.options.allowedTools).toEqual(first.options.allowedTools);
    expect(second.options.disallowedTools).toEqual(first.options.disallowedTools);
    expect(second.options.hooks).toBeDefined();
    // what both rounds read, and the session the call ended in
    expect(r.sources).toEqual(['Read a.ts', 'Read b.ts']);
    expect(r.sessionId).toBe('s1');
    expect(r.partial).toBeUndefined();
  });

  it('shows the wait on its own node and the return to work, and asks again after the second round with the rounds granted', async () => {
    queue = [
      script(init('s1'), result('error_max_turns', 's1')),
      script(init('s1'), result('error_max_turns', 's1')),
      script(init('s1'), result('success', 's1', { fala: 'done' })),
    ];
    const { limit, stops } = asker('continue', 'continue');
    const states: (string | undefined)[][] = [];
    const watching: TurnLimit = { own: true, ask: async (stop) => (states.push(activityLog.get('run:r-sdk-2').filter((e) => e.kind === 'status').map((e) => e.state)), limit.ask(stop)) };
    const r = await withActivityContext('run:r-sdk-2', () => runAgent<{ fala: string }>(call(watching)));
    expect(r.data).toEqual({ fala: 'done' });
    expect(stops.map((s) => [s.used, s.round, s.granted])).toEqual([[5, 5, 0], [10, 5, 1]]);
    expect(calls.map((c) => c.options.resume)).toEqual([undefined, 's1', 's1']);
    expect(states[0].at(-1)).toBe('waiting');
    expect(activityLog.get('run:r-sdk-2').filter((e) => e.kind === 'status').map((e) => e.state)).toEqual(['started', 'waiting', 'started', 'waiting', 'started', 'finished']);
  });

  it('ends with the failure of running out of turns on finish now, with no second call', async () => {
    queue = [script(init('s1'), result('error_max_turns', 's1')), script(init('s1'), result('success', 's1', { fala: 'never' }))];
    const { limit, stops } = asker('finish');
    await expect(withActivityContext('run:r-sdk-3', () => runAgent(call(limit)))).rejects.toBeInstanceOf(MaxTurnsError);
    expect(stops).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('does not go on when the call was cancelled during the wait, whatever the answer says', async () => {
    queue = [script(init('s1'), result('error_max_turns', 's1')), script(init('s1'), result('success', 's1', { fala: 'never' }))];
    const abort = new AbortController();
    const limit: TurnLimit = { own: true, ask: async () => (abort.abort(), 'continue') };
    await expect(runAgent(call(limit, { abort }))).rejects.toBeInstanceOf(MaxTurnsError);
    expect(calls).toHaveLength(1);
  });

  it('does not ask on the call\'s own limit when the question is for its sub-agents only, and a call with none keeps ending as before', async () => {
    queue = [script(init('s1'), result('error_max_turns', 's1'))];
    const { limit, stops } = asker('continue');
    await expect(runAgent(call({ ...limit, own: false }))).rejects.toBeInstanceOf(MaxTurnsError);
    expect(stops).toEqual([]);
    queue = [script(init('s2'), result('error_max_turns', 's2'))];
    await expect(runAgent(call(undefined))).rejects.toBeInstanceOf(MaxTurnsError);
    expect(calls).toHaveLength(2);
  });

  it('never asks in the wrap-up of a call that wraps up: the stage asks once, finish now goes to the wrap-up, and the wrap-up has no question', async () => {
    queue = [script(init('s1'), result('error_max_turns', 's1')), script(init('s1'), result('success', 's1', { fala: 'what it had' }))];
    const { limit, stops } = asker('finish', 'continue');
    const r = await runAgent<{ fala: string }>(call(limit, { wrapUp: true }));
    expect(r.partial).toBe(true);
    expect(stops).toHaveLength(1);
    expect(calls[1].options).toMatchObject({ resume: 's1', maxTurns: 2, tools: [], allowedTools: [] });
  });

  it('builds the stream of the door again for the resumed call, with the new prompt as its first message', async () => {
    queue = [
      [[init('s1'), result('error_max_turns', 's1')]],
      [[init('s1'), result('success', 's1', { fala: 'done' })], [result('success', 's1', { fala: 'done' })]],
    ];
    const { limit } = asker('continue');
    const r = await runAgent<{ fala: string }>(call(limit, { incoming: async () => null }));
    expect(r.data).toEqual({ fala: 'done' });
    expect(calls).toHaveLength(2);
    expect(typeof calls[0].prompt).not.toBe('string');
    expect(typeof calls[1].prompt).not.toBe('string');
    expect(calls[1].prompt).not.toBe(calls[0].prompt);
    expect(seen[0]).toBe('work the stage');
    expect(seen[1]).toMatch(/limit|limite/i);
    expect(calls[1].options.resume).toBe('s1');
  });
});
