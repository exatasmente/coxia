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
