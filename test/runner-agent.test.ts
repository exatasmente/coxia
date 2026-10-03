// How a team agent is run: the options the Claude SDK gets for a reader and for an agent that writes, and the same agent on the open engine.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown> | ((options: Record<string, any>) => Promise<void>);
const calls: { prompt: string; options: Record<string, any> }[] = [];
let script: Msg[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, any> }) => {
    calls.push({ prompt, options });
    return (async function* () {
      for (const m of script) {
        if (typeof m === 'function') await m(options);
        else yield m;
      }
    })();
  },
}));

import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityLog, withActivityContext } from '../src/main/activity';
import { runAgent, obj, str } from '../src/main/agents';
import { confinedHooks } from '../src/main/runner/hooks';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret } from './helpers/config';

const done = (data: unknown): Msg[] => [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'result', subtype: 'success', session_id: 's1', structured_output: data },
];

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
});

beforeEach(() => {
  calls.length = 0;
  script = done({ fala: 'ok' });
});

const reader = newAgent({ id: 'refiner', permission: 'read' });
const writer = newAgent({ id: 'developer', permission: 'worktree' });
const schema = obj({ fala: str });

describe('runAgent on the Claude SDK', () => {
  it('gives a reader the tools of the ceremonies: no Edit, no Write, no network', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-read-'));
    const r = await runAgent<{ fala: string }>({ agent: reader, prompt: 'p', schema, system: 'sys', cwd, label: 'refiner', maxTurns: 7 });
    expect(r.data).toEqual({ fala: 'ok' });
    const o = calls[0].options;
    expect(o.cwd).toBe(cwd);
    expect(o.maxTurns).toBe(7);
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']));
    expect(o.allowedTools).not.toContain('Edit');
    expect(o.systemPrompt.append).toBe('sys');
  });

  it('gives an agent that writes Edit and Write, its own hooks and only the commands it was given', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    mkdirSync(join(root, 'src'));
    const hooks = confinedHooks({ root, commands: ['npm test'] });
    const abort = new AbortController();
    await runAgent({ agent: writer, prompt: 'p', schema, system: 'sys', cwd: root, label: 'developer', maxTurns: 50, confine: { root, hooks }, abort }, ['npm test']);
    const o = calls[0].options;
    expect(o.cwd).toBe(root);
    expect(o.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(npm test)']);
    expect(o.disallowedTools).not.toContain('Edit');
    expect(o.disallowedTools).not.toContain('Write');
    expect(o.disallowedTools).not.toContain('Bash');
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch', 'NotebookEdit']));
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.abortController).toBe(abort);
    const matchers = (o.hooks.PreToolUse as { matcher: string }[]).map((g) => g.matcher);
    expect(matchers).toEqual(['Edit|Write|MultiEdit|NotebookEdit', 'Read|Grep|Glob', 'Bash', 'WebFetch|WebSearch']);
  });

  it('shows in the live activity, under the run, what the hooks refuse, and tells the runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    const denied: string[] = [];
    const hooks = confinedHooks({ root, commands: ['npm test'], onDenied: (d) => denied.push(`${d.tool}:${d.code}`) });
    script = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      async (options: Record<string, any>) => {
        const run = (group: { matcher: string; hooks: ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<unknown>)[] }, input: Record<string, unknown>) => group.hooks[0](input, undefined, { signal: new AbortController().signal });
        const pre = options.hooks.PreToolUse as { matcher: string; hooks: never[] }[];
        await run(pre[0] as never, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/etc/cron.d/x', content: 'x' }, cwd: root });
        await run(pre[2] as never, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf .' }, cwd: root });
        await run(pre[2] as never, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: root });
      },
      { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } },
    ] as never;
    activityLog.clear();
    await withActivityContext('run:r-test-0002', () => runAgent({ agent: writer, prompt: 'p', schema, system: 's', cwd: root, label: 'developer', maxTurns: 5, confine: { root, hooks } }, ['npm test']));
    const blocked = activityLog.get('run:r-test-0002').filter((e) => e.state === 'blocked');
    expect(blocked.map((e) => e.label)).toEqual(['Bloqueado: Write /etc/cron.d/x', 'Bloqueado: Bash rm -rf .']);
    expect(denied).toEqual(['Write:outside', 'Bash:command']);
  });

  it('turns the shell off for an agent that writes when it was given no command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-write-'));
    await runAgent({ agent: writer, prompt: 'p', schema, system: 's', cwd: root, label: 'developer', maxTurns: 5, confine: { root, hooks: confinedHooks({ root, commands: [] }) } }, []);
    expect(calls[0].options.disallowedTools).toContain('Bash');
    expect(calls[0].options.allowedTools.some((t: string) => t.startsWith('Bash'))).toBe(false);
  });

  it('does not take a half answer for a finished stage: running out of turns is an error', async () => {
    script = [{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'result', subtype: 'error_max_turns', session_id: 's1' }];
    await expect(runAgent({ agent: reader, prompt: 'p', schema, system: 's', cwd: tmpdir(), label: 'refiner', maxTurns: 2 })).rejects.toThrow(/error_max_turns/);
    expect(calls).toHaveLength(1);
  });
});
