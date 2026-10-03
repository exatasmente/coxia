// The ReleaseAction tool on the open engine, through runAgent against a scripted model: it is offered only to a call that is given the handler of a release run, its
// schema allows the six steps and a version and nothing that names a path or a flag, what the handler answers is what the model reads, and a step may take a while
// without the stage being told the agent went quiet.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { obj, runAgent, str } from '../src/main/agents';
import { keepAlive, releaseToolImpl } from '../src/main/releaseTool';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import { RELEASE_OPS, RELEASE_TOOL_NAME } from '../src/shared/release';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let fake: Fake;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-release-'));
  fake = await fakeOpenAI((req) =>
    req.n === 1 || req.n === 3
      ? toolStep([
          { id: 'r1', name: 'ReleaseAction', args: { op: 'beta', version: '0.5.0' } },
          { id: 'r2', name: 'ReleaseAction', args: { op: 'beta', version: '0.5.0', path: '/etc/passwd' } },
          { id: 'b1', name: 'Bash', args: { command: 'scripts/release.sh stable --emergency' } },
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

const manager = () => newAgent({ id: 'release-manager', permission: 'read', tracker: 'read', shell: 'none', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
const names = (i: number): string[] => ((fake.chats()[i].body as Record<string, any>).tools as { function: { name: string } }[]).map((t) => t.function.name).sort();
const results = (i: number): string[] => ((fake.chats()[i].body as Record<string, any>).messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);

describe('the ReleaseAction tool on the open engine', () => {
  it('is offered with a handler, takes the inputs as the model gave them to the handler (which judges them), and gives the model what it answers; Bash stays out', async () => {
    const seen: unknown[] = [];
    const r = await runAgent<{ fala: string }>({ agent: manager(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'release-manager', maxTurns: 6, release: async (input) => (seen.push(input), 'Waiting for the person: nothing was done yet.') }, []);
    expect(r.data).toEqual({ fala: 'done' });
    expect(names(0)).toContain(RELEASE_TOOL_NAME);
    expect(names(0)).not.toContain('Bash');
    expect(seen).toEqual([{ op: 'beta', version: '0.5.0' }, { op: 'beta', version: '0.5.0', path: '/etc/passwd' }]);
    const [first, second, bash] = results(1);
    expect(first).toContain('Waiting for the person');
    expect(second).toContain('Waiting for the person');
    // the model asked for Bash with --emergency anyway: it is not a tool of this agent
    expect(bash).not.toContain('Waiting');
    const schema = ((fake.chats()[0].body as Record<string, any>).tools as { function: { name: string; parameters: Record<string, any> } }[]).find((t) => t.function.name === RELEASE_TOOL_NAME)!.function.parameters;
    expect(schema.properties.op.enum).toEqual([...RELEASE_OPS]);
    expect(Object.keys(schema.properties).sort()).toEqual(['branch', 'channel', 'from', 'head', 'op', 'pr', 'version']);
  });

  it('is not offered without one: an agent of an issue run has no way to ask for a release step', async () => {
    const before = fake.chats().length;
    await runAgent({ agent: manager(), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'release-manager', maxTurns: 6 }, []);
    expect(names(before)).not.toContain(RELEASE_TOOL_NAME);
  });

  it('answers a handler that throws as an error of the tool, and not as a crash of the agent', async () => {
    const tool = releaseToolImpl(async () => {
      throw new Error('the unit was refused\nmore');
    });
    await expect(tool.run({ op: 'beta' }, { outputMax: 1000 } as never)).rejects.toThrow('the unit was refused');
  });
});

describe('a step that takes minutes', () => {
  it('tells the stage the agent is alive while it runs, and stops when it ends', async () => {
    vi.useFakeTimers();
    try {
      const beats: number[] = [];
      let finish: (s: string) => void = () => undefined;
      const slow = keepAlive(() => new Promise<string>((resolve) => (finish = resolve)), () => beats.push(Date.now()));
      const done = slow({});
      await vi.advanceTimersByTimeAsync(65_000);
      expect(beats.length).toBe(3);
      finish('ok');
      await expect(done).resolves.toBe('ok');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(beats.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
