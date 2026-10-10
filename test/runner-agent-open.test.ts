// The same agent on the open engine, through runAgent: the engine is picked from the agent's own provider, an agent that writes gets Write and Edit
// inside its worktree and nothing else, and what the guard refuses shows up in the live activity.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityLog, withActivityContext } from '../src/main/activity';
import { obj, runAgent, str } from '../src/main/agents';
import { confinedHooks, readConfinedHooks, type Denial } from '../src/main/runner/hooks';
import { newProvider } from '../src/shared/config/defaults';
import { newAgent } from '../src/shared/config/team';
import type { PoolNotice } from '../src/main/engine/contract';
import { type Fake, type Step, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let fake: Fake;
let root: string;
let outside: string;
let docs: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-open-'));
  outside = mkdtempSync(join(tmpdir(), 'agent-open-out-'));
  docs = mkdtempSync(join(tmpdir(), 'agent-open-docs-'));
  mkdirSync(join(root, '.git/hooks'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, '.env'), 'KEY=1\n');
  writeFileSync(join(outside, 'away.txt'), 'outside\n');
  writeFileSync(join(docs, 'guide.md'), '# guide\n');
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

  it('reports a sign of life for every piece of the model\'s work, so a stage that keeps working never runs out of idle time', async () => {
    const live = await fakeOpenAI((req) => (req.n === 1 ? toolStep([{ id: 'g', name: 'Glob', args: { pattern: '*' } }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }])));
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'local3', kind: 'openai-compatible', baseUrl: live.url, structured: 'tool' }));
        return c;
      });
      const reader = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'local3', model: 'qwen3:8b' } });
      let beats = 0;
      await runAgent({ agent: reader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4, beat: () => void beats++ });
      // at least: the session, two model calls with their usage and the tool call and its result
      expect(beats).toBeGreaterThanOrEqual(5);
    } finally {
      await live.close();
    }
  });

  it('reports what every model call used, and what the provider says it cost when it says', async () => {
    const metered = await fakeOpenAI((req) =>
      req.n === 1 ? toolStep([{ id: 'g', name: 'Glob', args: { pattern: '*' } }], { usageTokens: [1000, 200], cost: 0.0004 }) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }], { usageTokens: [1500, 50], cost: 0.0006 }),
    );
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'local4', kind: 'openai-compatible', baseUrl: metered.url, structured: 'tool' }));
        return c;
      });
      const reader = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'local4', model: 'qwen3:8b' } });
      const reports: unknown[] = [];
      await runAgent({ agent: reader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4, onUsage: (u) => void reports.push(u) });
      expect(reports).toEqual([
        { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, costUsd: 0.0004, costEstimated: false },
        { promptTokens: 1500, completionTokens: 50, cachedTokens: 0, costUsd: 0.0006, costEstimated: false },
      ]);
    } finally {
      await metered.close();
    }
  });

  it('counts the server\'s estimated_cost as charged, and a call with no cost as none', async () => {
    const metered = await fakeOpenAI((req) =>
      req.n === 1 ? toolStep([{ id: 'g', name: 'Glob', args: { pattern: '*' } }], { usageTokens: [1000, 200], extras: { estimatedCost: 0.0003 } }) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }], { usageTokens: [1500, 50] }),
    );
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'local5', kind: 'openai-compatible', baseUrl: metered.url, structured: 'tool' }));
        return c;
      });
      const reader = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'local5', model: 'qwen3:8b' } });
      const reports: unknown[] = [];
      await runAgent({ agent: reader, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4, onUsage: (u) => void reports.push(u) });
      expect(reports).toEqual([
        { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, costUsd: 0.0003, costEstimated: false },
        { promptTokens: 1500, completionTokens: 50, cachedTokens: 0 },
      ]);
      // what a stage adds up from those reports: charged, never marked as an estimate
      const { addReport, emptyUsage } = await import('../src/shared/runs/usage');
      const total = (reports as Parameters<typeof addReport>[1][]).reduce(addReport, emptyUsage());
      expect(total).toMatchObject({ costUsd: 0.0003, costEstimated: false });
    } finally {
      await metered.close();
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

  it('continues the session of an earlier call, on the engine that opened it, and reports the session it left open', async () => {
    fake.requests.length = 0;
    const agent = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'local', model: 'qwen3:8b' } });
    const first = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4 });
    expect(first.sessionId).not.toBe('');
    const before = fake.chats().length;
    // A round that continues that session: the dialog the model sees starts with the prompt of the first call, so nothing the agent read was lost.
    const round = await runAgent<{ fala: string }>({
      agent,
      prompt: 'keep the evidence or point at the command',
      schema: obj({ fala: str }),
      system: 'sys',
      cwd: root,
      label: 'reviewer',
      maxTurns: 4,
      resume: { session: first.sessionId as string, engine: 'open' },
    });
    // The call answers in the session it was given, and reports it back for whatever continues from it.
    const resumed = fake.chats().slice(before).map((c) => JSON.stringify(c.body?.messages)).join('\n');
    expect(resumed).toContain('keep the evidence or point at the command');
    // The round adds no session of its own, and it answers in the session the first call opened: the two report one and the same session.
    const { ATAS } = await import('../src/main/env');
    const { readIndex } = await import('../src/main/sessions-core');
    const index = readIndex(ATAS);
    expect(index.filter((e) => e.id === first.sessionId)).toHaveLength(1);
    // And the round recorded no session of its own: the sessions the index lists are the ones the file's calls opened, the round not among them.
    expect(index.map((e) => e.id)).not.toContain(round.sessionId ?? '');
  });
});

describe('a reading agent of a run on the open engine', () => {
  let providerSeq = 0;
  /** A call of a reader confined to the worktree, with a script of tool calls; the engine is a fresh local provider of the test. */
  const readerRun = async (calls: { id: string; name: string; args: object }[], opts: { roots?: string[] } = {}) => {
    const live = await fakeOpenAI((req) => (req.n === 1 ? toolStep(calls) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }])));
    try {
      const { updateConfig } = await import('../src/main/workspaceConfig');
      const provider = `readeropen${providerSeq++}`;
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: provider, kind: 'openai-compatible', baseUrl: live.url, structured: 'tool' }));
        return c;
      });
      const reader = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider, model: 'qwen3:8b' } });
      const denials: Denial[] = [];
      await withActivityContext('run:r-reader-0001', () =>
        runAgent(
          {
            agent: reader,
            prompt: 'p',
            schema: obj({ fala: str }),
            system: 'sys',
            cwd: root,
            label: 'reviewer',
            maxTurns: 4,
            readRoot: { root, roots: opts.roots ?? [], hooks: readConfinedHooks({ root, roots: opts.roots ?? [], onDenied: (d) => denials.push(d) }) },
          },
          [],
        ),
      );
      return { denials, chats: live.chats() };
    } finally {
      await live.close();
    }
  };

  it('offers no Write, no Edit and no Bash to a confined reader, and refuses a read outside the worktree, telling the runner and the activity', async () => {
    activityLog.clear();
    const { denials, chats } = await readerRun([
      { id: 'r1', name: 'Read', args: { file_path: 'src/a.ts' } },
      { id: 'r2', name: 'Read', args: { file_path: join(outside, 'away.txt') } },
      { id: 'r3', name: 'Read', args: { file_path: '../elsewhere/x' } },
      { id: 'r4', name: 'Read', args: { file_path: '~/.bashrc' } },
      { id: 'r5', name: 'Read', args: { file_path: '.git/config' } },
    ]);
    const names = (chats[0].body?.tools as { function: { name: string } }[]).map((t) => t.function.name).sort();
    expect(names).not.toContain('Write');
    expect(names).not.toContain('Edit');
    expect(names).not.toContain('Bash');
    expect(names).toContain('Read');
    // the read inside the worktree ran, the four ways out were refused
    expect(denials.map((d) => d.code)).toEqual(['outside', 'traversal', 'outside', 'git']);
    expect(denials.map((d) => d.tool)).toEqual(['Read', 'Read', 'Read', 'Read']);
    const blocked = activityLog.get('run:r-reader-0001').filter((e) => e.state === 'blocked');
    expect(blocked).toHaveLength(4);
    expect(blocked.every((e) => e.role === 'reviewer')).toBe(true);
    // the model reads the path it tried, so it can correct itself
    const results = (chats[1].body?.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);
    expect(results[1]).toContain('away.txt');
  });

  it('keeps the secret filter, the broad-search refusal and the secret result redaction of a reader: the guard composes with them', async () => {
    const { denials, chats } = await readerRun([
      { id: 'r1', name: 'Read', args: { file_path: '.env' } },
      { id: 'r2', name: 'Glob', args: { pattern: '**/*.env' } },
    ]);
    // the secret name is refused by the filter that runs in front of the guard, so the guard records no denial of its own
    expect(denials).toEqual([]);
    const results = (chats[1].body?.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);
    expect(results.join('\n')).toMatch(/segredo|secret/i);
  });

  it('lets a confined reader reach a documentation folder it was given as a root, and not one it was not', async () => {
    const inside = await readerRun([{ id: 'r1', name: 'Read', args: { file_path: join(docs, 'guide.md') } }], { roots: [docs] });
    expect(inside.denials).toEqual([]);
    const refused = await readerRun([{ id: 'r1', name: 'Read', args: { file_path: join(docs, 'guide.md') } }]);
    expect(refused.denials.map((d) => d.code)).toEqual(['outside']);
  });
});

describe('the sub-agents an agent is offered in delegate mode, on the open engine', () => {
  let delegateRuns = 0;
  // The principal is served by `first`, the list of shell by `second`; both are scripted by the caller. Everything is torn down after the run.
  const delegated = async <R,>(opts: { principal: (req: { n: number }) => Step; sub?: (req: { n: number }) => Step; agent: (providers: { first: string; second: string }) => ReturnType<typeof newAgent>; tools?: (c: import('../src/shared/config/types').WorkspaceConfig) => void; call?: Partial<Parameters<typeof runAgent>[0]> }, then: (seen: { first: Fake; second: Fake }) => R | Promise<R>): Promise<R> => {
    const { restRegistry } = await import('../src/main/engine/open/rest');
    const { updateConfig } = await import('../src/main/workspaceConfig');
    restRegistry.clear();
    const n = (delegateRuns += 1);
    const ids = { first: `delfirst${n}`, second: `delsecond${n}` };
    const first = await fakeOpenAI(opts.principal);
    const second = await fakeOpenAI(opts.sub ?? (() => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'unused' } }])));
    try {
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: ids.first, kind: 'openai-compatible', baseUrl: first.url, structured: 'tool' }), newProvider({ id: ids.second, kind: 'openai-compatible', baseUrl: second.url, structured: 'tool' }));
        opts.tools?.(c);
        return c;
      });
      await runAgent<{ fala: string }>({ agent: opts.agent(ids), prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'dev', maxTurns: 6, ...opts.call }, ['npm test']);
      return await then({ first, second });
    } finally {
      restRegistry.clear();
      updateConfig((c) => {
        c.agents.tools.subagents = true;
        c.llm.providers = c.llm.providers.filter((p) => p.id !== ids.first && p.id !== ids.second);
        return c;
      });
      await first.close();
      await second.close();
    }
  };
  const done = () => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]);
  const toolsOf = (f: Fake, i = 0) => (f.chats()[i].body?.tools as { function: { name: string; parameters: any } }[]).map((t) => t.function);
  const writer = (extra: object = {}, lists = true) => (ids: { first: string; second: string }) =>
    newAgent({ id: 'dev', permission: 'worktree', ...extra, model: { role: null, provider: ids.first, model: 'model-a', ...(lists ? { activities: { shell: [{ provider: ids.second, model: 'model-b' }] } } : {}) } });
  const hooks = (denials: Denial[] = []) => ({ confine: { root, hooks: confinedHooks({ root, commands: ['npm test'], onDenied: (d) => denials.push(d) }) } });

  it('offers Agent to an agent that writes, with the kinds its tools and lists allow', async () => {
    await delegated({ principal: done, agent: writer(), call: hooks() }, ({ first }) => {
      const tools = toolsOf(first);
      const agent = tools.find((t) => t.name === 'Agent');
      expect(agent).toBeDefined();
      // shell: it has a list and Bash; edit has no list.
      expect(agent!.parameters.properties.kind.enum).toEqual(['explore', 'shell']);
      expect(tools.map((t) => t.name).sort()).toEqual(['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write', 'final_answer']);
    });
  });

  it('changes nothing for a pool without a list for an activity, in fallback or switch with the same lists, or with the switch of sub-agents off', async () => {
    const plain = ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write', 'final_answer'];
    await delegated({ principal: done, agent: writer({}, false), call: hooks() }, ({ first }) => expect(toolsOf(first).map((t) => t.name).sort()).toEqual(plain));
    await delegated({ principal: done, agent: writer({ poolMode: 'fallback' }), call: hooks() }, ({ first }) => expect(toolsOf(first).map((t) => t.name).sort()).toEqual(plain));
    // `switch` gives the model the lists, not sub-agents.
    await delegated({ principal: done, agent: writer({ poolMode: 'switch' }), call: hooks() }, ({ first }) => expect(toolsOf(first).map((t) => t.name).sort()).toEqual(plain));
    // The stage and the workspace say it the same way.
    await delegated({ principal: done, agent: writer(), call: { ...hooks(), stagePoolMode: 'fallback' } }, ({ first }) => expect(toolsOf(first).map((t) => t.name).sort()).toEqual(plain));
    await delegated({ principal: done, agent: writer(), call: hooks(), tools: (c) => void (c.agents.tools.subagents = false) }, ({ first }) => expect(toolsOf(first).map((t) => t.name).sort()).toEqual(plain));
  });

  it('does not offer it to a call that only has the procedure tools, nor to the Claude engine', async () => {
    await delegated({ principal: done, agent: writer(), call: { ...hooks(), procedureOnly: true } }, ({ first }) => expect(toolsOf(first).map((t) => t.name)).not.toContain('Agent'));
    const { delegatesWork } = await import('../src/main/agents');
    const resolved = (engine: 'open' | 'claude-sdk', pool: boolean) => ({ engine, pool: pool ? { fallbacks: [], activities: { shell: [{ engine }] } } : undefined }) as never;
    expect(delegatesWork(resolved('open', true), 'delegate')).toBe(true);
    expect(delegatesWork(resolved('claude-sdk', true), 'delegate')).toBe(false);
    expect(delegatesWork(resolved('open', false), 'delegate')).toBe(false);
    expect(delegatesWork(resolved('open', true), 'fallback')).toBe(false);
    // A list whose models are all of the Claude engine is not one the open engine will see.
    expect(delegatesWork({ engine: 'open', pool: { fallbacks: [], activities: { shell: [{ engine: 'claude-sdk' }] } } } as never, 'delegate')).toBe(false);
  });

  it('a sub-agent of a writer runs under the same confinement: its command is refused by the same guard, and it has no Write or Edit', async () => {
    const denials: Denial[] = [];
    await delegated(
      {
        principal: (req) => (req.n === 1 ? toolStep([{ id: 'a1', name: 'Agent', args: { description: 'go', prompt: 'publish it', kind: 'shell' } }]) : done()),
        sub: (req) => (req.n === 1 ? toolStep([{ id: 's1', name: 'Bash', args: { command: 'npm publish' } }, { id: 's2', name: 'Bash', args: { command: 'npm test' } }]) : req.n === 2 ? toolStep([{ id: 'sf', name: 'Read', args: { file_path: '.env' } }, { id: 'sg', name: 'Glob', args: { pattern: '*' } }]) : textStep('sub done')),
        agent: writer(),
        call: hooks(denials),
      },
      ({ second }) => {
        const tools = toolsOf(second).map((t) => t.name).sort();
        expect(tools).toEqual(['Bash', 'Glob', 'Grep', 'Read']);
        // `npm publish` is not in the stage's commands; the guard that stops the principal stops the sub-agent.
        expect(denials.map((d) => d.code)).toContain('command');
        // The secret file is refused by the same filter on the sub-agent's reads.
        const results = (second.chats()[2].body?.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);
        expect(results.join('\n')).toMatch(/segredo|secret/i);
      },
    );
  });

  it('gives a reader no edit and no shell kind, whatever the lists say, and no Write or Bash tool', async () => {
    const reader = (ids: { first: string; second: string }) =>
      newAgent({ id: 'dev', permission: 'read', model: { role: null, provider: ids.first, model: 'model-a', activities: { shell: [{ provider: ids.second, model: 'model-b' }], edit: [{ provider: ids.second, model: 'model-b' }] } } });
    await delegated({ principal: done, agent: reader, call: { readRoot: { root, roots: [], hooks: readConfinedHooks({ root, roots: [] }) } } }, ({ first }) => {
      const tools = toolsOf(first);
      expect(tools.find((t) => t.name === 'Agent')!.parameters.properties.kind.enum).toEqual(['explore']);
      expect(tools.map((t) => t.name)).not.toContain('Write');
      expect(tools.map((t) => t.name)).not.toContain('Bash');
    });
  });
});

describe('how the pool of an agent is used, on the open engine', () => {
  let modeRuns = 0;
  // A reads a file (an explore turn) and answers; B is the list of explore only. In `switch` the turn after the read is B's, otherwise A keeps it.
  const modes = async (agentMode: 'switch' | 'fallback' | 'delegate' | undefined, stageMode: 'switch' | 'fallback' | 'delegate' | undefined, workspaceMode: 'switch' | 'fallback' | 'delegate' | undefined): Promise<{ a: number; b: number }> => {
    const { restRegistry } = await import('../src/main/engine/open/rest');
    const { updateConfig } = await import('../src/main/workspaceConfig');
    restRegistry.clear();
    const n = (modeRuns += 1);
    const firstId = `modefirst${n}`;
    const secondId = `modesecond${n}`;
    const first = await fakeOpenAI((req) => (req.n === 1 ? toolStep([{ id: 'r1', name: 'Read', args: { file_path: join(root, 'src/a.ts') } }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }])));
    const second = await fakeOpenAI(() => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]));
    try {
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: firstId, kind: 'openai-compatible', baseUrl: first.url, structured: 'tool' }), newProvider({ id: secondId, kind: 'openai-compatible', baseUrl: second.url, structured: 'tool' }));
        if (workspaceMode) c.llm.poolMode = workspaceMode;
        else delete c.llm.poolMode;
        return c;
      });
      const agent = newAgent({ id: 'reviewer', permission: 'read', ...(agentMode ? { poolMode: agentMode } : {}), model: { role: null, provider: firstId, model: 'model-a', activities: { explore: [{ provider: secondId, model: 'model-b' }] } } });
      const r = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4, ...(stageMode ? { stagePoolMode: stageMode } : {}) });
      expect(r.data).toEqual({ fala: 'done' });
      return { a: first.chats().length, b: second.chats().length };
    } finally {
      restRegistry.clear();
      updateConfig((c) => {
        delete c.llm.poolMode;
        c.llm.providers = c.llm.providers.filter((p) => p.id !== firstId && p.id !== secondId);
        return c;
      });
      await first.close();
      await second.close();
    }
  };

  it('uses the default, delegate, when nothing says: the main model keeps the explore turn', async () => {
    expect(await modes(undefined, undefined, undefined)).toEqual({ a: 2, b: 0 });
  });

  it('switch sends the turn after a read to the list of explore, and it comes from the agent, the stage or the workspace', async () => {
    expect(await modes('switch', undefined, undefined)).toEqual({ a: 1, b: 1 });
    expect(await modes(undefined, 'switch', undefined)).toEqual({ a: 1, b: 1 });
    expect(await modes(undefined, undefined, 'switch')).toEqual({ a: 1, b: 1 });
  });

  it('the agent wins over the stage, and the stage over the workspace', async () => {
    expect(await modes('fallback', 'switch', 'switch')).toEqual({ a: 2, b: 0 });
    expect(await modes(undefined, 'fallback', 'switch')).toEqual({ a: 2, b: 0 });
    expect(await modes('switch', 'fallback', 'fallback')).toEqual({ a: 1, b: 1 });
  });
});

describe('an agent whose model has spares, on the open engine', () => {
  it('moves to the next model when the first is busy, tells the caller and the live activity, and finishes the stage there', async () => {
    const { restRegistry } = await import('../src/main/engine/open/rest');
    const { updateConfig } = await import('../src/main/workspaceConfig');
    restRegistry.clear();
    // `retry-after: 0` keeps the client's own retries instant; the model still rests for the default time.
    const busy = await fakeOpenAI(() => ({ ...errorStep(429, 'Rate limit reached'), headers: { 'retry-after': '0' } }) as Step);
    const spare = await fakeOpenAI(() => toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]));
    try {
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'poolbusy', kind: 'openai-compatible', baseUrl: busy.url, structured: 'tool' }), newProvider({ id: 'poolspare', kind: 'openai-compatible', baseUrl: spare.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'poolbusy', model: 'model-a', fallbacks: [{ provider: 'poolspare', model: 'model-b' }] } });
      const notices: PoolNotice[] = [];
      activityLog.clear();
      const before = Date.now();
      const r = await withActivityContext('run:r-pool-0001', () =>
        runAgent<{ fala: string }>({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4, onPool: (n) => notices.push(n) }),
      );
      expect(r.data).toEqual({ fala: 'done' });
      expect(busy.chats().length).toBeGreaterThan(0);
      expect(spare.chats()[0].body?.model).toBe('model-b');
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ from: { label: 'model-a', provider: 'poolbusy' }, to: { label: 'model-b', provider: 'poolspare' }, reason: 'rate_limit', activity: 'write' });
      // The busy model rests for the default 5 minutes, and the notice says until when.
      expect(notices[0].until).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1000);
      const shown = activityLog.get('run:r-pool-0001').filter((e) => e.kind === 'tool' && e.label.includes('model-b'));
      expect(shown).toHaveLength(1);
      expect(shown[0].label).toContain('model-a');
    } finally {
      restRegistry.clear();
      await busy.close();
      await spare.close();
    }
  });

  it('names the spare as the provider that ran out of budget when the spare is the one that refused, not the first model of the role', async () => {
    const { restRegistry } = await import('../src/main/engine/open/rest');
    const { updateConfig } = await import('../src/main/workspaceConfig');
    const { ProviderBudgetError } = await import('../src/main/engine/contract');
    restRegistry.clear();
    const busy = await fakeOpenAI(() => ({ ...errorStep(429, 'Rate limit reached'), headers: { 'retry-after': '0' } }) as Step);
    const broke = await fakeOpenAI(() => errorStep(402, 'Payment required'));
    try {
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'budgetbusy', kind: 'openai-compatible', baseUrl: busy.url, structured: 'tool' }), newProvider({ id: 'budgetbroke', kind: 'openai-compatible', baseUrl: broke.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'reviewer', permission: 'read', model: { role: null, provider: 'budgetbusy', model: 'model-a', fallbacks: [{ provider: 'budgetbroke', model: 'model-b' }] } });
      const error = await runAgent({ agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'reviewer', maxTurns: 4 }).catch((e) => e as Error);
      expect(error).toBeInstanceOf(ProviderBudgetError);
      expect((error as InstanceType<typeof ProviderBudgetError>).provider).toBe('budgetbroke');
    } finally {
      restRegistry.clear();
      await busy.close();
      await broke.close();
    }
  });
});
