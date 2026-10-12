// A conversation that continues its Claude Code session (#279), with the SDK replaced by a script: the session reaches the SDK, and when it cannot be continued (the call fails
// before the model wrote or did anything) the same call starts once in a new session with the whole conversation, ends its line as finished and fails nothing. After a tool ran,
// a refusal for budget, a Stop, or a round of a stage, nothing is tried again. What the real SDK sends for a session that is gone is not pinned here (3_IMPLEMENTATION.md).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: unknown; options: Record<string, any> }[] = [];
let queue: (Msg[] | Error)[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, any> }) => {
    calls.push({ prompt, options });
    const turn = queue.shift() ?? [];
    return (async function* () {
      if (turn instanceof Error) throw turn;
      yield* turn;
    })();
  },
}));

import type { RunActivity } from '../src/main/activity';
import { type AgentCall, runAgent } from '../src/main/agents';
import { ProviderBudgetError, SessionGoneError } from '../src/main/engine/contract';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret } from './helpers/config';

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(async () => {
  calls.length = 0;
  queue = [];
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], kind: 'anthropic', baseUrl: 'https://api.anthropic.com', id: 'llm-target' }];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const says = (text: string): Msg => ({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text }] }, parent_tool_use_id: null });
const uses = (name: string): Msg => ({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't1', name, input: {} }] }, parent_tool_use_id: null });
const done = (id: string, result: string): Msg => ({ type: 'result', subtype: 'success', session_id: id, result });
const failed = (id: string): Msg => ({ type: 'result', subtype: 'error_during_execution', session_id: id });

/** A line that records how the call says it ended. */
function line(): { activity: RunActivity; statuses: string[] } {
  const statuses: string[] = [];
  const activity = new Proxy({} as RunActivity, {
    get: (_, key) => (key === 'id' ? 'line-1' : key === 'status' ? (state: string) => statuses.push(state) : () => undefined),
  });
  return { activity, statuses };
}

const agent = newAgent({ id: 'me', permission: 'read' });
const FULL = 'the whole conversation';
const call = (over: Partial<AgentCall> = {}): AgentCall => ({
  agent,
  prompt: 'only what came after',
  system: 'sys',
  cwd: '/tmp',
  label: 'me',
  maxTurns: 5,
  resume: { session: 's-a', engine: 'claude-sdk', mode: 'conversation', fallback: { prompt: FULL } },
  ...over,
});

describe('a conversation that continues its session', () => {
  it('hands the session to the SDK and ends its line as finished', async () => {
    queue = [[init('s-a'), says('hi'), done('s-a', 'hi')]];
    const { activity, statuses } = line();
    const r = await runAgent(call({ activity }));
    expect(calls[0].options.resume).toBe('s-a');
    expect(calls[0].prompt).toBe('only what came after');
    expect(r).toMatchObject({ data: 'hi', sessionId: 's-a', engine: 'claude-sdk', provider: 'llm-target' });
    expect(statuses).toEqual(['finished']);
  });

  it('starts once in a new session, with the whole conversation, when the session fails before the model did anything', async () => {
    queue = [[init('s-a'), failed('s-a')], [init('s-b'), says('hi'), done('s-b', 'hi')]];
    const { activity, statuses } = line();
    const r = await runAgent(call({ activity }));
    expect(calls).toHaveLength(2);
    expect(calls[1].options.resume).toBeUndefined();
    expect(calls[1].prompt).toBe(FULL);
    expect(r).toMatchObject({ data: 'hi', sessionId: 's-b' });
    expect(statuses).toEqual(['finished']);
  });

  it('does the same when the CLI refuses the session before any message', async () => {
    queue = [new Error('No conversation found with session ID: s-a'), [init('s-b'), done('s-b', 'hi')]];
    const r = await runAgent(call());
    expect(calls).toHaveLength(2);
    expect(r.sessionId).toBe('s-b');
  });

  it('fails as before, once, when the new session fails too', async () => {
    queue = [[init('s-a'), failed('s-a')], [init('s-b'), failed('s-b')]];
    const { activity, statuses } = line();
    const error = await runAgent(call({ activity })).catch((e) => e as Error);
    expect(calls).toHaveLength(2);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SessionGoneError);
    expect(statuses).toEqual(['failed']);
  });

  it('never tries again once a tool ran: what it did is not undone', async () => {
    queue = [[init('s-a'), uses('Read'), failed('s-a')], [init('s-b'), done('s-b', 'hi')]];
    const error = await runAgent(call()).catch((e) => e as Error);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(Error);
  });

  it('does not take a refusal for budget for a session that is gone', async () => {
    queue = [[init('s-a'), says('API Error: 429 monthly limit exceeded, add credit'), failed('s-a')], [init('s-b'), done('s-b', 'hi')]];
    const error = await runAgent(call()).catch((e) => e as Error);
    expect(error).toBeInstanceOf(ProviderBudgetError);
    expect(calls).toHaveLength(1);
  });

  it('never tries again after a Stop', async () => {
    const abort = new AbortController();
    abort.abort();
    queue = [new Error('aborted'), [init('s-b'), done('s-b', 'hi')]];
    await expect(runAgent(call({ abort }))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe('what does not change', () => {
  it('a call with no session to continue fails as it always did, and is never retried', async () => {
    queue = [[init('s-a'), failed('s-a')], [init('s-b'), done('s-b', 'hi')]];
    const error = await runAgent(call({ resume: undefined })).catch((e) => e as Error);
    expect(calls).toHaveLength(1);
    expect(error).not.toBeInstanceOf(SessionGoneError);
    expect((error as Error).message).toMatch(/^agent failed:/);
  });

  it('a round of a stage leaves its line working and gets no fallback', async () => {
    queue = [[init('s-a'), done('s-a', 'hi')], [init('s-a'), failed('s-a')]];
    const { activity, statuses } = line();
    await runAgent(call({ activity, resume: { session: 's-a', engine: 'claude-sdk' } }));
    expect(statuses).toEqual(['started']);
    await expect(runAgent(call({ resume: { session: 's-a', engine: 'claude-sdk' } }))).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});
