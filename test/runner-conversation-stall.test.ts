// A conversation that makes no progress ends with a line saying why, a Stop finds it, and the caller is never held by a called agent that ignores the abort.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ForumStore, createForumStore } from '../src/main/forum-core';
import type { AgentDef } from '../src/shared/config/types';
import { neutralConfig } from '../src/shared/config';
import { runThreadId } from '../src/shared/forum';
import { runConversation } from '../src/main/runner/conversation';
import { createCallStops } from '../src/main/mentions/stop';
import type { AgentCall } from '../src/main/agents';

let dir!: string;
let forum: ForumStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-conversation-stall-'));
  forum = createForumStore(join(dir, 'forum'));
  forum.ensureThread({ id: runThreadId('r1'), kind: 'run', runId: 'r1', title: 'app#1' });
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const agent = (id: string, over: Partial<AgentDef> = {}): AgentDef => ({ id, name: id, permission: 'read', shell: 'none', ...over }) as AgentDef;
const run = { id: 'r1', worktree: '/tmp/none', issue: { ref: 'app#1' }, repo: 'app', cycleFolder: 'docs/cycles/1' } as never;

// The engine never answers and ignores the abort: the worst case for a caller waiting on it.
const hanging = (seen: AgentCall[] = []) => (call: AgentCall): Promise<never> => {
  seen.push(call);
  return new Promise<never>(() => undefined);
};

function start(engine: (call: AgentCall) => Promise<{ data: unknown }>, over: Record<string, unknown> = {}) {
  const config = neutralConfig();
  config.runner.stageIdleMs = 60_000; // the conversation's limit is half of it: 30 s
  const answered: string[] = [];
  const result = runConversation(
    { run, stage: { id: 'implement' } as never, caller: agent('developer'), called: agent('qa'), forum, config: () => config, engine, commands: [], abort: new AbortController(), chain: ['developer'], place: 'run', title: 'talk', ...over } as never,
    { fromCaller: async () => 'a point', answered: (text) => answered.push(text), pendingFromCaller: () => null },
  );
  return { result, answered };
}

const lines = (): { code?: string; params?: Record<string, unknown> }[] => (forum.read(runThreadId('r1'), 0, 500)?.messages ?? []) as never;

describe('a conversation with no progress', () => {
  it('ends at the limit, says why in the thread and lets the caller go even when the engine ignores the abort', async () => {
    vi.useFakeTimers();
    const { result } = start(hanging());
    await vi.advanceTimersByTimeAsync(29_000);
    let done = false;
    void result.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await result;
    expect(r.reason).toBe('stalled');
    expect(lines().find((m) => m.code === 'runner.conversation.stalled')?.params).toMatchObject({ caller: 'developer', called: 'qa' });
    expect(lines().filter((m) => m.code === 'runner.conversation.ended')).toHaveLength(1);
  });

  it('is kept alive by a sign of life of the model', async () => {
    vi.useFakeTimers();
    const seen: AgentCall[] = [];
    const { result } = start(hanging(seen));
    await vi.advanceTimersByTimeAsync(20_000);
    seen[0].beat?.();
    await vi.advanceTimersByTimeAsync(20_000);
    seen[0].beat?.();
    await vi.advanceTimersByTimeAsync(20_000);
    let done = false;
    void result.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await result).reason).toBe('stalled');
  });

  it('is found and stopped by the stop of the run\'s thread, which answers false when nothing runs', async () => {
    const stops = createCallStops();
    const seen: AgentCall[] = [];
    const { result } = start(hanging(seen), { stops });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(stops.stop(runThreadId('r1'), 'qa')).toBe(true);
    const r = await result;
    expect(r.reason).toBe('stopped');
    expect(lines().some((m) => m.code === 'runner.conversation.stopped')).toBe(true);
    expect(stops.running()).toEqual([]);
    expect(stops.stop(runThreadId('r1'), 'qa')).toBe(false);
  });
});
