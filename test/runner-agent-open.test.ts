// The same agent on the open engine, through runAgent: the engine is picked from the agent's own provider, an agent that writes gets Write and Edit
// inside its worktree and nothing else, and what the guard refuses shows up in the live activity.
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityLog, withActivityContext } from '../src/main/activity';
import { obj, runAgent, str } from '../src/main/agents';
import { confinedHooks, type Denial } from '../src/main/runner/hooks';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let fake: Fake;
let root: string;
let outside: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-open-'));
  outside = mkdtempSync(join(tmpdir(), 'agent-open-out-'));
  mkdirSync(join(root, '.git/hooks'), { recursive: true });
  fake = await fakeOpenAI((req) =>
    req.n === 1
      ? toolStep([
          { id: 'w1', name: 'Write', args: { file_path: 'src/feature.ts', content: 'export const x = 1;\n' } },
          { id: 'w2', name: 'Write', args: { file_path: join(outside, 'evil.txt'), content: 'x' } },
          { id: 'w3', name: 'Write', args: { file_path: '.git/hooks/pre-commit', content: 'x' } },
          { id: 'b1', name: 'Bash', args: { command: 'npm publish' } },
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

describe('runAgent on the open engine', () => {
  it('serves an agent that writes with Write and Edit inside the worktree, refuses the rest, and shows it in the activity', async () => {
    const agent = newAgent({ id: 'developer', permission: 'worktree', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
    const denials: Denial[] = [];
    activityLog.clear();
    const r = await withActivityContext('run:r-test-0001', () =>
      runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'developer', maxTurns: 6, confine: { root, hooks: confinedHooks({ root, commands: ['npm test'], onDenied: (d) => denials.push(d) }) } }, ['npm test']),
    );
    expect(r.data).toEqual({ fala: 'done' });
    // the engine and the model came from the agent's own provider
    expect(fake.chats()[0].body?.model).toBe('qwen3:8b');
    expect((fake.chats()[0].body?.tools as { function: { name: string } }[]).map((t) => t.function.name).sort()).toEqual(['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write', 'final_answer']);
    expect(readFileSync(join(root, 'src/feature.ts'), 'utf8')).toBe('export const x = 1;\n');
    expect(existsSync(join(outside, 'evil.txt'))).toBe(false);
    expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(false);
    expect(denials.map((d) => d.code)).toEqual(['outside', 'git', 'command']);
    const blocked = activityLog.get('run:r-test-0001').filter((e) => e.state === 'blocked');
    expect(blocked).toHaveLength(3);
    expect(blocked.every((e) => e.role === 'developer')).toBe(true);
    // the reason given to the agent is never what the person sees in the activity
    expect(blocked.map((e) => e.label).join(' ')).not.toMatch(/fora da pasta/);
  });

  it('runs the commands an agent that writes was given without the credential-looking variables of the process', async () => {
    process.env.TEST_PROVIDER_API_KEY = 'sk-test-must-not-leak';
    const env = await fakeOpenAI((req) => (req.n === 1 ? toolStep([{ id: 'b1', name: 'Bash', args: { command: 'node -p process.env.TEST_PROVIDER_API_KEY' } }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }])));
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'local2', kind: 'openai-compatible', baseUrl: env.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'developer', permission: 'worktree', model: { role: null, provider: 'local2', model: 'qwen3:8b' } });
      const command = 'node -p process.env.TEST_PROVIDER_API_KEY';
      await runAgent({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'developer', maxTurns: 6, confine: { root, hooks: confinedHooks({ root, commands: [command] }) } }, [command]);
      const second = JSON.stringify(env.chats()[1].body?.messages);
      expect(second).toContain('undefined');
      expect(second).not.toContain('sk-test-must-not-leak');
    } finally {
      delete process.env.TEST_PROVIDER_API_KEY;
      await env.close();
    }
  });

  it('serves a reader with no Write, no Edit and no shell', async () => {
    const reader = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
    fake.requests.length = 0;
    await runAgent({ agent: reader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 3 });
    const names = (fake.chats()[0].body?.tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).not.toContain('Write');
    expect(names).not.toContain('Edit');
    expect(names).not.toContain('Bash');
  });
});
