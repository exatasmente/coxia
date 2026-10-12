import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentCall } from '../src/main/agents';
import { type ClaudeCodeDeps, runClaudeCodeTask } from '../src/main/runner/claudeCodeTask';

// A session simulated by a function that plays the SDK's messages: nothing real is opened and nothing of the person's Claude Code is read.
type Canned = (options: { canUseTool: (tool: string, input: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>; [k: string]: unknown }) => AsyncGenerator<Record<string, unknown>>;

let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cc-root-'));
  outside = mkdtempSync(join(tmpdir(), 'cc-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const callOf = (extra: Partial<AgentCall> = {}): AgentCall => ({ prompt: 'do it', system: 'sys', cwd: root, maxTurns: 5, confine: { root, hooks: { PreToolUse: [] }, } as never, ...extra }) as AgentCall;
const depsOf = (play: Canned, seen: { options?: Record<string, unknown> } = {}): ClaudeCodeDeps => ({
  query: async () => (args) => {
    seen.options = args.options as Record<string, unknown>;
    return play(args.options as never) as never;
  },
  env: () => ({}),
});
const ok = { ok: true } as const;
const pause = () => () => undefined;

async function* done(result = 'the result'): AsyncGenerator<Record<string, unknown>> {
  yield { type: 'system', subtype: 'init', session_id: 's1' };
  yield { type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'working' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.txt' } }] } };
  yield { type: 'result', subtype: 'success', session_id: 's1', result };
}

describe('a task handed to a Claude Code session', () => {
  it('returns the result of the session as the answer, with the transcript apart', async () => {
    const r = await runClaudeCodeTask(depsOf(() => done()), { call: callOf(), ask: async () => ok, pause, signal: new AbortController().signal });
    expect(r.data).toEqual({ summary: 'the result' });
    expect(r.sessionId).toBe('s1');
    expect(r.engine).toBe('claude-sdk');
    expect(r.transcript).toContain('working');
    expect(r.transcript).toContain('Read: a.txt');
    expect(JSON.stringify(r.data)).not.toContain('working');
  });

  it('uses the structured output when the stage asks for a schema', async () => {
    const play: Canned = async function* () {
      yield { type: 'result', subtype: 'success', session_id: 's2', result: 'x', structured_output: { summary: 'S', verdict: 'approved' } };
    };
    const r = await runClaudeCodeTask(depsOf(play), { call: callOf({ schema: { type: 'object' } as never }), ask: async () => ok, pause, signal: new AbortController().signal });
    expect(r.data).toEqual({ summary: 'S', verdict: 'approved' });
  });

  it.each([
    ['an error result', { type: 'result', subtype: 'error_during_execution', result: 'boom' }],
    ['an is_error result', { type: 'result', subtype: 'success', is_error: true, result: 'bad' }],
    ['an empty result', { type: 'result', subtype: 'success', result: '  ' }],
  ])('fails on %s like any agent', async (_n, message) => {
    const play: Canned = async function* () {
      yield message;
    };
    await expect(runClaudeCodeTask(depsOf(play), { call: callOf(), ask: async () => ok, pause, signal: new AbortController().signal })).rejects.toThrow();
  });

  it('fails when the session ends with no result', async () => {
    const play: Canned = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's' };
    };
    await expect(runClaudeCodeTask(depsOf(play), { call: callOf(), ask: async () => ok, pause, signal: new AbortController().signal })).rejects.toThrow('without a result');
  });

  it('opens an isolated session with no native shell and no settings of the person', async () => {
    const seen: { options?: Record<string, unknown> } = {};
    await runClaudeCodeTask(depsOf(() => done(), seen), { call: callOf(), ask: async () => ok, pause, signal: new AbortController().signal });
    expect(seen.options?.settingSources).toEqual([]);
    expect(seen.options?.settings).toEqual({ autoMemoryEnabled: false });
    expect(seen.options?.disallowedTools).toContain('Bash');
    expect(seen.options?.cwd).toBe(root);
  });

  it('puts every permission request to the person with the clock paused, and respects a refusal with the note', async () => {
    const events: string[] = [];
    let verdict: { behavior: string; message?: string } | undefined;
    const play: Canned = async function* (options) {
      verdict = await options.canUseTool('Edit', { file_path: join(root, 'a.txt') });
      yield { type: 'result', subtype: 'success', session_id: 's', result: 'done' };
    };
    await runClaudeCodeTask(depsOf(play), {
      call: callOf(),
      ask: async (question) => {
        events.push(`ask ${question}`);
        return { ok: false, note: 'not this file' };
      },
      pause: () => {
        events.push('paused');
        return () => events.push('resumed');
      },
      signal: new AbortController().signal,
    });
    expect(events[0]).toBe('paused');
    expect(events[1]).toContain('ask Edit:');
    expect(events[2]).toBe('resumed');
    expect(verdict).toEqual({ behavior: 'deny', message: 'not this file' });
  });

  it('allows what the person allows', async () => {
    let verdict: { behavior: string } | undefined;
    const play: Canned = async function* (options) {
      verdict = await options.canUseTool('Read', { file_path: join(root, 'a.txt') });
      yield { type: 'result', subtype: 'success', session_id: 's', result: 'done' };
    };
    await runClaudeCodeTask(depsOf(play), { call: callOf(), ask: async () => ok, pause, signal: new AbortController().signal });
    expect(verdict?.behavior).toBe('allow');
  });

  it('refuses a write outside the worktree, through ".." and through a link, without asking the person', async () => {
    symlinkSync(outside, join(root, 'link'));
    const asked: string[] = [];
    const verdicts: { behavior: string }[] = [];
    const play: Canned = async function* (options) {
      verdicts.push(await options.canUseTool('Write', { file_path: join(root, '..', 'elsewhere.txt') }));
      verdicts.push(await options.canUseTool('Write', { file_path: join(root, 'link', 'x.txt') }));
      verdicts.push(await options.canUseTool('Write', { file_path: join(outside, 'y.txt') }));
      yield { type: 'result', subtype: 'success', session_id: 's', result: 'done' };
    };
    await runClaudeCodeTask(depsOf(play), {
      call: callOf(),
      ask: async (q) => {
        asked.push(q);
        return ok;
      },
      pause,
      signal: new AbortController().signal,
    });
    expect(verdicts.map((v) => v.behavior)).toEqual(['deny', 'deny', 'deny']);
    expect(asked).toEqual([]);
  });

  it('denies a request once the stage is stopped', async () => {
    const stop = new AbortController();
    stop.abort();
    let verdict: { behavior: string } | undefined;
    const play: Canned = async function* (options) {
      verdict = await options.canUseTool('Read', { file_path: join(root, 'a.txt') });
      yield { type: 'result', subtype: 'success', session_id: 's', result: 'done' };
    };
    await runClaudeCodeTask(depsOf(play), { call: callOf(), ask: async () => ok, pause, signal: stop.signal });
    expect(verdict?.behavior).toBe('deny');
  });
});
