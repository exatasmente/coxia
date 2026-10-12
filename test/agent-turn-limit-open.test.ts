// runAgent hands the open engine the question at a turn limit (#246) and shows the wait on the call's own node: working, waiting for the person, working again. A
// wrap-up of two turns never asks. Nothing here reaches a model: the open engine talks to a local fake.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityLog, withActivityContext } from '../src/main/activity';
import { obj, runAgent, str } from '../src/main/agents';
import type { TurnDecision, TurnLimit, TurnStop } from '../src/main/engine/contract';
import { MaxTurnsError } from '../src/main/engine/contract';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let root: string;
let fake: Fake;
const readStep = (n: number) => toolStep([{ id: `r${n}`, name: 'Read', args: { file_path: 'a.txt' } }], { usageTokens: [10, 2] });
const final = () => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }], { usageTokens: [10, 2] });

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-turns-'));
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'hello\n');
  // by what the dialog holds, not by the count of requests: the server is shared by the tests
  const reads = (req: { body: Record<string, any> | null }): number => ((req.body?.messages ?? []) as { role: string }[]).filter((m) => m.role === 'tool').length;
  fake = await fakeOpenAI((req) => (reads(req) < 3 ? readStep(req.n) : final()));
  const { updateConfig } = await import('../src/main/workspaceConfig');
  updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
    return c;
  });
});

afterAll(async () => {
  await fake.close();
});

const reader = () => newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
const call = (turnLimit: TurnLimit, over: Record<string, unknown> = {}) => ({ agent: reader(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 2, turnLimit, ...over });

describe('runAgent with a question at the turn limit', () => {
  it('shows the wait on its own node and the return to work after a continue, and finishes the node when the stage does', async () => {
    fake.requests.length = 0;
    activityLog.clear();
    const seen: { stop: TurnStop; states: (string | undefined)[] }[] = [];
    const turnLimit: TurnLimit = {
      own: true,
      ask: async (stop) => {
        seen.push({ stop, states: activityLog.get('run:r-turns-1').filter((e) => e.kind === 'status').map((e) => e.state) });
        return 'continue';
      },
    };
    const r = await withActivityContext('run:r-turns-1', () => runAgent<{ fala: string }>(call(turnLimit)));
    expect(r.data).toEqual({ fala: 'done' });
    expect(seen).toHaveLength(1);
    expect(seen[0].stop).toMatchObject({ of: 'stage', used: 2, round: 2, granted: 0, canContinue: true });
    // the node said it waits before the question reached the asker
    expect(seen[0].states.at(-1)).toBe('waiting');
    expect(activityLog.get('run:r-turns-1').filter((e) => e.kind === 'status').map((e) => e.state)).toEqual(['started', 'waiting', 'started', 'finished']);
  });

  it('turns finish now into the failure of running out of turns: a MaxTurnsError for the caller to make its own', async () => {
    fake.requests.length = 0;
    activityLog.clear();
    const stops: TurnStop[] = [];
    const turnLimit: TurnLimit = { own: true, ask: async (stop): Promise<TurnDecision> => (stops.push(stop), 'finish') };
    await expect(withActivityContext('run:r-turns-2', () => runAgent(call(turnLimit)))).rejects.toBeInstanceOf(MaxTurnsError);
    expect(stops).toHaveLength(1);
    expect(activityLog.get('run:r-turns-2').filter((e) => e.kind === 'status').map((e) => e.state)).toEqual(['started', 'waiting', 'failed']);
  });

  it('does not ask on the call\'s own limit when the question is for the sub-agents only', async () => {
    fake.requests.length = 0;
    const stops: TurnStop[] = [];
    const turnLimit: TurnLimit = { own: false, ask: async (stop) => (stops.push(stop), 'continue') };
    await expect(runAgent(call(turnLimit))).rejects.toBeInstanceOf(MaxTurnsError);
    expect(stops).toEqual([]);
  });

  it('never asks in the wrap-up of a call that ran out of turns: two turns to answer, and running out of them fails quietly', async () => {
    fake.requests.length = 0;
    const stops: TurnStop[] = [];
    const turnLimit: TurnLimit = { own: true, ask: async (stop) => (stops.push(stop), 'finish') };
    // every turn asks for another read, so the wrap-up (no tools, 2 turns) cannot answer
    const stuck = await fakeOpenAI((req) => readStep(req.n));
    const { updateConfig } = await import('../src/main/workspaceConfig');
    updateConfig((c) => {
      c.llm.providers.push(newProvider({ id: 'stuck', kind: 'openai-compatible', baseUrl: stuck.url, structured: 'tool' }));
      return c;
    });
    try {
      const agent = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'stuck', model: 'qwen3:8b' } });
      await expect(runAgent({ ...call(turnLimit), agent, wrapUp: true })).rejects.toThrow();
      // the stage asked once, at its own limit; the wrap-up that followed ran its two turns and stopped without a question
      expect(stops).toHaveLength(1);
      expect(stuck.chats().length).toBeGreaterThanOrEqual(4);
    } finally {
      await stuck.close();
    }
  });
});
