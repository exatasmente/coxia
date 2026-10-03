// The Shell tool on the open engine, through runAgent against a scripted model: it is offered only to an agent that has a sandbox session, its commands go to the session
// and what comes back is the exit code and the end of the output, and a refused command is an answer, not a crash.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { obj, runAgent, str } from '../src/main/agents';
import { confinedHooks } from '../src/main/runner/hooks';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';
import { fakeSandbox } from './helpers/runner';

let fake: Fake;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-shell-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  fake = await fakeOpenAI((req) =>
    req.n === 1
      ? toolStep([
          { id: 's1', name: 'Shell', args: { command: 'npm test' } },
          { id: 's2', name: 'Shell', args: { command: '   ' } },
          { id: 's3', name: 'Bash', args: { command: 'npm test' } },
        ])
      : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]),
  );
  const { updateConfig } = await import('../src/main/workspaceConfig');
  updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
    return c;
  });
});
afterAll(async () => {
  await fake.close();
});

const toolNames = (): string[] => ((fake.chats()[0].body as Record<string, any>).tools as { function: { name: string } }[]).map((t) => t.function.name).sort();
const toolResults = (): string[] => ((fake.chats()[1].body as Record<string, any>).messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);

describe('the Shell tool on the open engine', () => {
  it('is offered with a session, runs the command in it, answers with the exit code and the output, and answers a refusal as text', async () => {
    const sandbox = fakeSandbox({ table: { 'npm test': { exitCode: 3, output: 'FAIL slug accents' } } });
    const { getConfig } = await import('../src/main/workspaceConfig');
    const session = await sandbox.open({ worktree: root, reader: false, config: getConfig().runner.sandbox });
    const agent = newAgent({ id: 'developer', permission: 'worktree', tracker: 'none', shell: 'sandbox', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
    const r = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'developer', maxTurns: 6, confine: { root, hooks: confinedHooks({ root, commands: [] }) }, exec: session }, []);
    expect(r.data).toEqual({ fala: 'done' });
    // Files, the Shell tool and the answer; no Bash: it is the way around the sandbox.
    expect(toolNames()).toEqual(['Edit', 'Glob', 'Grep', 'Read', 'Shell', 'Write', 'final_answer']);
    expect(session.log.map((c) => c.command)).toEqual(['npm test', '   ']);
    const [first, empty, bash] = toolResults();
    expect(first).toContain('exit code 3');
    expect(first).toContain('FAIL slug accents');
    expect(empty).toContain('empty');
    // The model asked for Bash anyway: it is not a tool of this agent.
    expect(bash).not.toContain('exit code');
  });

  it('is not offered to an agent that has no session', async () => {
    const before = fake.chats().length;
    const agent = newAgent({ id: 'developer', permission: 'worktree', tracker: 'none', shell: 'none', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
    await runAgent({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'developer', maxTurns: 6, confine: { root, hooks: confinedHooks({ root, commands: [] }) } }, []);
    const names = ((fake.chats()[before].body as Record<string, any>).tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).not.toContain('Shell');
    expect(names).not.toContain('Bash');
  });
});
