// A bare call (askBare) can only answer: on the Claude SDK path it reaches the SDK with no tool, nothing pre-approved, no setting source, no MCP configuration of the
// person's and a working directory that is not a repository. The same question asked through askAgent keeps what a ceremony has, so these cases tell the two apart.
// The SDK is a fake: no model, no network.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
type Options = Record<string, unknown>;
const calls: { prompt: string; options: Options }[] = [];
let scripts: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Options }) => {
    calls.push({ prompt, options });
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

import { activityLog, withActivityContext } from '../src/main/activity';
import { askAgent, askBare, obj, str } from '../src/main/agents';
import { MaxTurnsError } from '../src/main/engine/contract';
import { engineFor } from '../src/main/engine/registry';
import { ATAS } from '../src/main/env';
import { readIndex } from '../src/main/sessions-core';
import { rc } from '../src/main/workspaceConfig';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');

const init = (id: string): Msg => ({ type: 'system', subtype: 'init', session_id: id });
const result = (subtype: string, id: string, structured?: unknown): Msg => ({ type: 'result', subtype, session_id: id, ...(structured === undefined ? {} : { structured_output: structured }) });
const answered = (id = 's1'): Msg[] => [init(id), result('success', id, { fala: 'ok' })];

const schema = obj({ fala: str });
const SYSTEM = 'You write questions for the person. MARK-ASSISTANT-SYSTEM';
const bare = (extra: { maxTurns?: number } = {}) => askBare<{ fala: string }>('deep', 'What should the agent do?', schema, { system: SYSTEM, ...extra });
const append = (options: Options): string => String((options.systemPrompt as { append?: string }).append ?? '');

beforeEach(() => {
  calls.length = 0;
  scripts = [];
  activityLog.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a bare call on the Claude SDK', () => {
  it('opens no tool, pre-approves nothing and reads no setting source or MCP configuration', async () => {
    scripts = [answered()];
    const r = await bare();
    expect(r.data).toEqual({ fala: 'ok' });
    const { options, prompt } = calls[0];
    expect(prompt).toBe('What should the agent do?');
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual([]);
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    // no in-process server either: no code host read, no shell, no app tool
    expect(options).not.toHaveProperty('mcpServers');
    expect(options.permissionMode).toBe('dontAsk');
    expect(options).not.toHaveProperty('additionalDirectories');
  });

  it('denies the shell and the writing tools, whatever the workspace allows its ceremonies', async () => {
    scripts = [answered()];
    await bare();
    const denied = calls[0].options.disallowedTools as string[];
    for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']) expect(denied).toContain(tool);
  });

  it('works from the data folder of the workspace, which is no repository, and not from the projects', async () => {
    scripts = [answered()];
    await bare();
    expect(calls[0].options.cwd).toBe(ATAS);
    expect(ATAS).not.toBe(rc().projectsRoot);
  });

  it('asks for the schema it was given, on the model of the role, with two turns', async () => {
    scripts = [answered()];
    await bare();
    const { options } = calls[0];
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema });
    expect(options.model).toBe(engineFor('deep').model);
    expect(options.maxTurns).toBe(2);
  });

  it('takes the turn limit the caller names', async () => {
    scripts = [answered()];
    await bare({ maxTurns: 5 });
    expect(calls[0].options.maxTurns).toBe(5);
  });

  it('carries the text of the caller as the system text and none of the role', async () => {
    scripts = [answered()];
    await bare();
    expect(append(calls[0].options)).toBe(SYSTEM);
  });

  it('keeps the session, so the cost screen and the retention can read it', async () => {
    scripts = [answered('s-bare')];
    await bare();
    expect(calls[0].options).not.toHaveProperty('persistSession');
    expect(readIndex(ATAS).find((e) => e.id === 's-bare')).toMatchObject({ role: 'deep' });
  });

  it('stops at the turn limit and does not resume the session', async () => {
    scripts = [[init('s1'), result('error_max_turns', 's1')], answered('s1')];
    await expect(bare()).rejects.toBeInstanceOf(MaxTurnsError);
    expect(calls).toHaveLength(1);
    expect(calls[0].options).not.toHaveProperty('resume');
  });

  it('raises the failure of the SDK as it is', async () => {
    scripts = [[init('s1'), result('error_during_execution', 's1')]];
    await expect(bare()).rejects.toThrow('agent ended with error_during_execution');
    expect(calls).toHaveLength(1);
  });

  it('reports its start and its end on the activity of the job, and a failure as one', async () => {
    scripts = [answered()];
    await withActivityContext('deep:assist:ok', () => bare());
    expect(activityLog.get('deep:assist:ok').map((e) => [e.kind, e.state ?? ''])).toEqual([
      ['status', 'started'],
      ['status', 'finished'],
    ]);
    scripts = [[init('s2'), result('error_during_execution', 's2')]];
    await expect(withActivityContext('deep:assist:bad', () => bare())).rejects.toThrow();
    expect(activityLog.get('deep:assist:bad').map((e) => [e.kind, e.state ?? ''])).toEqual([
      ['status', 'started'],
      ['status', 'failed'],
    ]);
  });
});

describe('the same question without bare', () => {
  it('keeps what a ceremony has: the tools of the role, the setting sources and the projects folder', async () => {
    scripts = [answered()];
    await askAgent('deep', 'What should the agent do?', schema, { maxTurns: 2 });
    const { options } = calls[0];
    expect(options).not.toHaveProperty('tools');
    expect(options.allowedTools).toContain('Read');
    expect(options).not.toHaveProperty('settingSources');
    expect(options).not.toHaveProperty('strictMcpConfig');
    expect(options.cwd).toBe(rc().projectsRoot);
    expect(append(options)).not.toBe(SYSTEM);
  });
});
