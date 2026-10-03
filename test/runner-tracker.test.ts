// What `tracker` gives each kind of agent of a run, on the Claude SDK: the code host read of the ceremonies for a reader with `read`, only the VcsRead tool for an agent that
// writes with `read`, nothing for `none`; and the Shell tool (never the SDK's own Bash) for an agent whose commands go to a sandbox.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: string; options: Record<string, any> }[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, any> }) => {
    calls.push({ prompt, options });
    return (async function* () {
      const m: Msg[] = [
        { type: 'system', subtype: 'init', session_id: 's1' },
        { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } },
      ];
      for (const x of m) yield x;
    })();
  },
  // The in-process MCP server and its tools, as plain data the test can read back.
  createSdkMcpServer: (o: { name: string; tools: { name: string; handler: (args: unknown) => Promise<unknown> }[] }) => ({ name: o.name, tools: o.tools }),
  tool: (name: string, description: string, shape: unknown, handler: (args: unknown) => Promise<unknown>) => ({ name, description, shape, handler }),
}));

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obj, runAgent, str, trackerOf } from '../src/main/agents';
import { confinedHooks } from '../src/main/runner/hooks';
import { VCS_MCP_TOOL_NAME } from '../src/main/vcs/engineTool';
import { SHELL_MCP_TOOL_NAME } from '../src/main/sandbox/tool';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret } from './helpers/config';
import { fakeSandbox } from './helpers/runner';

const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');

const schema = obj({ fala: str });
const root = mkdtempSync(join(tmpdir(), 'agent-tracker-'));

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
  // A host the app reads through its own tool (no CLI): the Bitbucket case, and a runtime that is ready.
  const c = structuredClone(getConfig());
  c.vcs = [{ id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', apiUrl: '', user: '', secretRef: 'bb.token', cliPreference: 'api', cliCommand: null } as never];
  c.projects.issues.vcsId = 'bb';
  c.agents.tools.vcsCli = true;
  saveConfig(c);
  setVcsRuntimeForTests({ provider: {} } as never);
});
beforeEach(() => void (calls.length = 0));

const run = (agent: ReturnType<typeof newAgent>, over: Record<string, unknown> = {}) =>
  runAgent({ agent, prompt: 'p', schema, system: 'sys', cwd: root, label: agent.id, maxTurns: 5, ...over });
const mcpNames = (o: Record<string, any>): string[] => Object.keys(o.mcpServers ?? {});

describe('what an agent reads of the code host', () => {
  it('gives a reader with "read" what the ceremonies get, and a reader with "none" nothing of the host', async () => {
    await run(newAgent({ id: 'po', permission: 'read', tracker: 'read' }));
    expect(mcpNames(calls[0].options)).toEqual(['coxia_vcs']);
    expect(calls[0].options.allowedTools).toContain(VCS_MCP_TOOL_NAME);
    await run(newAgent({ id: 'po', permission: 'read', tracker: 'none' }));
    expect(mcpNames(calls[1].options)).toEqual([]);
    expect(calls[1].options.allowedTools).not.toContain(VCS_MCP_TOOL_NAME);
  });

  it('gives an agent that writes only the VcsRead tool when it has "read", and nothing when it has "none"', async () => {
    const hooks = confinedHooks({ root, commands: [] });
    await run(newAgent({ id: 'dev', permission: 'worktree', tracker: 'read', shell: 'none' }), { confine: { root, hooks } });
    expect(mcpNames(calls[0].options)).toEqual(['coxia_vcs']);
    expect(calls[0].options.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', VCS_MCP_TOOL_NAME]);
    await run(newAgent({ id: 'dev', permission: 'worktree', tracker: 'none', shell: 'none' }), { confine: { root, hooks } });
    expect(mcpNames(calls[1].options)).toEqual([]);
    expect(calls[1].options.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write']);
  });

  it('reads an agent saved before the field as it behaved: a reader had the read, an agent that writes had none', () => {
    expect(trackerOf({ permission: 'read' } as never, false)).toBe('workspace');
    expect(trackerOf({ permission: 'worktree' } as never, true)).toBe('none');
    expect(trackerOf({ permission: 'worktree', tracker: 'read' }, true)).toBe('tool');
    expect(trackerOf({ permission: 'read', tracker: 'read' }, false)).toBe('workspace');
    expect(trackerOf({ permission: 'read', tracker: 'none' }, false)).toBe('none');
  });
});

describe('the commands of an agent set to a sandbox', () => {
  it('get the Shell tool beside the files, and the SDK\'s Bash stays off', async () => {
    const sandbox = fakeSandbox();
    const session = await sandbox.open({ worktree: root, reader: false, config: getConfig().runner.sandbox });
    const hooks = confinedHooks({ root, commands: [] });
    await run(newAgent({ id: 'dev', permission: 'worktree', tracker: 'none', shell: 'sandbox' }), { confine: { root, hooks }, exec: session });
    const o = calls[0].options;
    expect(mcpNames(o)).toEqual(['coxia_sandbox']);
    expect(o.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', SHELL_MCP_TOOL_NAME]);
    expect(o.disallowedTools).toContain('Bash');
    // The tool is the session's: a command goes to it and its answer comes back as text.
    const tool = (o.mcpServers.coxia_sandbox as { tools: { name: string; handler: (a: unknown) => Promise<{ content: { text: string }[] }> }[] }).tools[0];
    expect(tool.name).toBe('Shell');
    const out = await tool.handler({ command: 'npm test' });
    expect(session.log.map((r) => r.command)).toEqual(['npm test']);
    expect(out.content[0].text).toContain('exit code 0');
  });

  it('give a reader the same tool, and keep its host read when it has one', async () => {
    const sandbox = fakeSandbox();
    const session = await sandbox.open({ worktree: root, reader: true, config: getConfig().runner.sandbox });
    await run(newAgent({ id: 'qa', permission: 'read', tracker: 'read', shell: 'sandbox' }), { exec: session });
    expect(mcpNames(calls[0].options).sort()).toEqual(['coxia_sandbox', 'coxia_vcs']);
    expect(calls[0].options.allowedTools).toEqual(expect.arrayContaining([SHELL_MCP_TOOL_NAME, VCS_MCP_TOOL_NAME]));
  });

  it('give an agent with no sandbox no Shell tool', async () => {
    await run(newAgent({ id: 'dev', permission: 'worktree', shell: 'allowlist' }), { confine: { root, hooks: confinedHooks({ root, commands: ['npm test'] }) } }, );
    expect(mcpNames(calls[0].options)).not.toContain('coxia_sandbox');
  });
});
