// One conversation between two agents of the team, driven with a stub engine and a real forum store: the round limit ends it and says why in the thread, the
// called agent's turn offers its own tool, and a turn with no answer ends the conversation.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ForumStore, createForumStore } from '../src/main/forum-core';
import type { AgentDef } from '../src/shared/config/types';
import { neutralConfig } from '../src/shared/config';
import { runThreadId } from '../src/shared/forum';
import { runConversation } from '../src/main/runner/conversation';
import { ASK_CONVERSATION_TOOL } from '../src/main/runner/tools';
import type { AgentCall } from '../src/main/agents';
import type { ActivityEntry } from '../src/shared/activity';
import { activityLog, beginActivity, withActivityParent } from '../src/main/activity';

let dir!: string;
let forum: ForumStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-conversation-'));
  forum = createForumStore(join(dir, 'forum'));
  // A run's thread exists before anything of the run happens, as it does in the app.
  forum.ensureThread({ id: runThreadId('r1'), kind: 'run', runId: 'r1', title: 'app#1' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const agent = (id: string, over: Partial<AgentDef> = {}): AgentDef => ({ id, name: id, permission: 'read', shell: 'none', ...over }) as AgentDef;

const run = { id: 'r1', worktree: dir, issue: { ref: 'app#1' }, repo: 'app', cycleFolder: 'docs/cycles/1' } as never;

/** What the caller keeps saying, and where the answers of the called agent go. */
function exchange(messages: string[]): { fromCaller: () => Promise<string | null>; answered: string[]; ex: { fromCaller: () => Promise<string | null>; answered: (text: string) => void } } {
  const answered: string[] = [];
  const fromCaller = async (): Promise<string | null> => messages.shift() ?? null;
  return { answered, fromCaller, ex: { fromCaller, answered: (text) => answered.push(text) } };
}

describe('a conversation between two agents', () => {
  it('ends at the round limit and says why in the thread, letting the called agent answer last', async () => {
    const config = neutralConfig();
    config.runner.conversations = { roundsPerConversation: 1, perStage: 3 };
    const calls: AgentCall[] = [];
    const engine = async (call: AgentCall) => {
      calls.push(call);
      return { data: { texto: `answer ${calls.length}` } };
    };
    const ex = exchange(['first', 'second']);
    const r = await runConversation(
      {
        run,
        stage: { id: 'implement' } as never,
        caller: agent('developer'),
        called: agent('qa'),
        forum,
        config: () => config,
        engine,
        commands: [],
        abort: new AbortController(),
        chain: ['developer'],
        place: 'run',
        title: 'talk',
      },
      ex.ex,
    );
    expect(r.reason).toBe('rounds');
    expect(r.rounds).toBe(1);
    // The called agent answered once; the second message of the caller never reached it.
    expect(calls).toHaveLength(1);
    // nobody waits for it, so the engine may use the cheaper tier
    expect(calls[0].background).toBe(true);
    const thread = forum.read(runThreadId('r1'), 0, 500)?.messages ?? [];
    expect(thread.find((m) => m.code === 'runner.conversation.rounds')?.params).toMatchObject({ cap: 1 });
    expect(thread.find((m) => m.code === 'runner.conversation.ended')).toBeDefined();
    // The answer of the called agent is a post of that agent, and it was handed back to the caller.
    expect(thread.some((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === 'qa' && m.text === 'answer 1')).toBe(true);
    expect(ex.answered).toEqual(['answer 1']);
  });

  it('says in the conversation that the called agent moved to another model of its pool', async () => {
    const engine = async (call: AgentCall) => {
      call.onPool?.({ from: { label: 'model-a' }, to: { label: 'model-b' }, reason: 'rate_limit', until: Date.now() + 300_000, activity: 'write' });
      return { data: { texto: 'done' } };
    };
    await runConversation(
      { run, stage: { id: 'implement' } as never, caller: agent('developer'), called: agent('qa'), forum, config: () => neutralConfig(), engine, commands: [], abort: new AbortController(), chain: ['developer'], place: 'run', title: 'talk' },
      exchange(['first']).ex,
    );
    const thread = forum.read(runThreadId('r1'), 0, 500)?.messages ?? [];
    expect(thread.find((m) => m.code === 'runner.model.switched')).toMatchObject({ kind: 'system', stage: 'implement', params: { agent: 'qa', from: 'model-a', to: 'model-b' } });
  });

  it('opens a thread of its own for a conversation in a new place, linked from the run', async () => {
    const engine = async () => ({ data: { texto: 'done' } });
    const r = await runConversation(
      {
        run,
        stage: { id: 'implement' } as never,
        caller: agent('developer'),
        called: agent('qa', { permission: 'worktree' }),
        forum,
        config: () => neutralConfig(),
        engine,
        commands: [],
        abort: new AbortController(),
        chain: ['developer'],
        place: 'new',
        title: 'A talk about the scenario',
      },
      exchange(['how do I reproduce it?']).ex,
    );
    expect(r.thread).not.toBe(runThreadId('r1'));
    expect(forum.summary(r.thread)?.title).toBe('A talk about the scenario');
    const runThread = forum.read(runThreadId('r1'), 0, 500)?.messages ?? [];
    expect(runThread.find((m) => m.code === 'runner.conversation.linked')?.params).toMatchObject({ caller: 'developer', called: 'qa', thread: r.thread });
  });

  it('offers the called agent its own tool, and a turn with no answer ends the conversation', async () => {
    const seen: AgentCall[] = [];
    const engine = async (call: AgentCall) => {
      seen.push(call);
      return { data: {} };
    };
    const r = await runConversation(
      {
        run,
        stage: { id: 'implement' } as never,
        caller: agent('developer'),
        called: agent('qa'),
        forum,
        config: () => neutralConfig(),
        engine,
        commands: [],
        abort: new AbortController(),
        chain: ['developer'],
        place: 'run',
        title: 'talk',
      },
      exchange(['anything?']).ex,
    );
    expect(r.reason).toBe('ended');
    expect(seen[0].runnerTools?.map((x) => x.name)).toContain(ASK_CONVERSATION_TOOL);
    // A turn with no answer ends the conversation: nothing else is asked.
    expect(seen).toHaveLength(1);
  });

  it('lets a called agent that writes change a file, and commits its work with the calling stage at the close', async () => {
    const committed: string[] = [];
    const seen: AgentCall[] = [];
    const engine = async (call: AgentCall) => {
      seen.push(call);
      return { data: { texto: 'the file now matches the scenario' } };
    };
    const ex = exchange(['could you change the fixture?']);
    const r = await runConversation(
      {
        run,
        stage: { id: 'implement' } as never,
        caller: agent('developer'),
        called: agent('qa', { permission: 'worktree' }),
        forum,
        config: () => neutralConfig(),
        engine,
        commands: [],
        commit: async (message) => {
          committed.push(message);
          return 'abc123';
        },
        abort: new AbortController(),
        chain: ['developer'],
        place: 'run',
        title: 'talk',
      },
      ex.ex,
    );
    // The called writer is confined to the run's worktree so it can change a file, and its work is committed with the calling stage once the conversation closes.
    expect(seen[0].confine).toBeDefined();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toContain('developer');
    expect(committed[0]).toContain('qa');
    expect(r.head).toBe('abc123');
  });

  it('is one node under the calling agent: lent to each round, closed once, with an excerpt of each round that answered', async () => {
    const config = neutralConfig();
    config.runner.conversations = { roundsPerConversation: 2, perStage: 3 };
    const seen: AgentCall[] = [];
    const engine = async (call: AgentCall) => {
      seen.push(call);
      // a round that ends its own activity: on a lent node that closes nothing
      call.activity?.status('finished');
      return { data: { texto: `answer ${seen.length}` } };
    };
    const pushed: ActivityEntry[] = [];
    activityLog.setSink((e) => pushed.push(e));
    const caller = beginActivity('developer');
    caller.status('started');
    await withActivityParent(caller.id, () =>
      runConversation({ run, stage: { id: 'implement' } as never, caller: agent('developer'), called: agent('qa'), forum, config: () => config, engine, commands: [], abort: new AbortController(), chain: ['developer'], place: 'run', title: 'talk' }, exchange(['how do I reproduce it?', 'and now?']).ex),
    );
    activityLog.setSink(null);
    const node = pushed.filter((e) => e.runId !== caller.id);
    expect(node.every((e) => e.parent === caller.id && e.role === 'qa' && e.node?.type === 'call' && e.node.label === 'how do I reproduce it?' && !e.call)).toBe(true);
    expect(node.map((e) => [e.kind, e.state ?? e.label])).toEqual([['status', 'started'], ['answer', 'answer 1'], ['answer', 'answer 2'], ['status', 'finished']]);
    // both rounds ran on the same lent node, which is not the one that was closed by the round
    expect(seen).toHaveLength(2);
    expect(seen[0].activity?.id).toBe(seen[1].activity?.id);
  });

  it('closes the node as failed, with the reason, when a round throws', async () => {
    const engine = async (): Promise<never> => {
      throw new Error('model unavailable');
    };
    const pushed: ActivityEntry[] = [];
    activityLog.setSink((e) => pushed.push(e));
    await expect(
      runConversation({ run, stage: { id: 'implement' } as never, caller: agent('developer'), called: agent('qa'), forum, config: () => neutralConfig(), engine, commands: [], abort: new AbortController(), chain: ['developer'], place: 'run', title: 'talk' }, exchange(['first']).ex),
    ).rejects.toThrow('model unavailable');
    activityLog.setSink(null);
    // with no node to hang under, the callee is a root of its job
    expect(pushed.map((e) => e.state ?? e.kind)).toEqual(['started', 'failed']);
    expect(pushed[1].label).toContain('model unavailable');
    expect(pushed[0].parent).toBeUndefined();
  });

  describe('the end of the node of a called agent', () => {
    const converse = async (engine: (call: AgentCall) => Promise<{ data: unknown }>, said: string[], abort = new AbortController()) => {
      const pushed: ActivityEntry[] = [];
      activityLog.setSink((e) => pushed.push(e));
      try {
        await runConversation({ run, stage: { id: 'implement' } as never, caller: agent('developer'), called: agent('qa'), forum, config: () => neutralConfig(), engine, commands: [], abort, chain: ['developer'], place: 'run', title: 'talk' }, exchange(said).ex);
      } finally {
        activityLog.setSink(null);
      }
      return pushed.filter((e) => e.kind === 'status').map((e) => e.state);
    };

    it('ends failed when the called agent gave no answer at all', async () => {
      expect(await converse(async () => ({ data: {} }), ['anything?'])).toEqual(['started', 'failed']);
    });

    it('ends failed when the run was aborted, and the called agent never ran', async () => {
      const abort = new AbortController();
      abort.abort();
      let ran = false;
      expect(await converse(async () => { ran = true; return { data: { texto: 'x' } }; }, ['anything?'], abort)).toEqual(['started', 'failed']);
      expect(ran).toBe(false);
    });

    it('ends finished when the caller is the one that ended the conversation', async () => {
      const engine = async (call: AgentCall) => {
        // the called agent asks for the next message and the caller has none: the other side ended it
        await call.runnerTools?.find((x) => x.name === ASK_CONVERSATION_TOOL)?.run({ text: 'and now?' } as never, {} as never);
        return { data: {} };
      };
      expect(await converse(engine, ['first'])).toEqual(['started', 'finished']);
    });

    it('still ends finished when the called agent answered', async () => {
      expect(await converse(async () => ({ data: { texto: 'done' } }), ['first'])).toEqual(['started', 'finished']);
    });
  });

  it('counts the model use of a conversation on the calling stage', async () => {
    const used: Parameters<NonNullable<AgentCall['onUsage']>>[0][] = [];
    const engine = async (call: AgentCall) => {
      call.onUsage?.({ promptTokens: 10, completionTokens: 5, cachedTokens: 0 });
      return { data: { texto: 'ok' } };
    };
    await runConversation(
      {
        run,
        stage: { id: 'implement' } as never,
        caller: agent('developer'),
        called: agent('qa'),
        forum,
        config: () => neutralConfig(),
        engine,
        commands: [],
        onUsage: (u) => used.push(u),
        abort: new AbortController(),
        chain: ['developer'],
        place: 'run',
        title: 'talk',
      },
      exchange(['tell me more']).ex,
    );
    // Every model call of the conversation reports on the same accumulator the calling stage reads, so the sums happen by construction.
    expect(used.length).toBeGreaterThan(0);
    expect(used[0]).toMatchObject({ promptTokens: 10, completionTokens: 5 });
  });
});
