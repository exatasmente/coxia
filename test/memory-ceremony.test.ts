// Ceremonies read the memory and never write it (gate 1, rule 2): the five system agents behind `askAgent` and an agent named inside a ceremony get the bounded list and, when
// they have tools, the two reads; no write tool, no folder, no audit and no line in any thread. `teams` has no tools, so it gets the list alone. The voice path never waits for
// git. The Claude SDK is a stub that plays a script per call: no model, no network, no host.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: string; options: Record<string, any> }[] = [];
let scripts: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => {
  const real = await original<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
      calls.push({ prompt, options });
      const script = scripts.shift() ?? [];
      return (async function* () {
        for (const m of script) yield m;
      })();
    },
  };
});

import { askAgent, obj, str } from '../src/main/agents';
import { openCeremonyMemory, setCeremonyMemory } from '../src/main/memory/ceremony';
import { createFacts } from '../src/main/memory/facts';
import { createMemoryIndex } from '../src/main/memory/index';
import { createMemoryPort } from '../src/main/memory/port';
import { answerCeremonyMentions } from '../src/main/mentions/ceremony';
import { conversationsPath } from '../src/main/memory/store';
import { createSharedMemory } from '../src/main/runner/activities';
import { prompt as cycleWords } from '../src/main/cyclePrompts';
import { setLanguage } from '../src/shared/i18n';
import { restRegistry } from '../src/main/engine/open/rest';
import { installEnvSecret, installLegacyConfig } from './helpers/config';
import { memoryWorld, T0, type MemoryWorld } from './helpers/memory';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');
const { updateConfig, getConfig } = await import('../src/main/workspaceConfig');

const init = (id: string) => ({ type: 'system', subtype: 'init', session_id: id });
const result = (subtype: string, id: string, structured?: unknown) => ({ type: 'result', subtype, session_id: id, ...(structured === undefined ? {} : { structured_output: structured }) });
const done = (id: string, data: unknown = { fala: 'ok' }) => [init(id), result('success', id, data)];
const schema = obj({ fala: str });
const ask = (role: 'turn' | 'reply' | 'deep' | 'teams' | 'fix', prompt = 'Pergunta') => askAgent<{ fala: string }>(role, prompt, schema, { maxTurns: 3 });
const mcpNames = (i: number): string[] => (calls[i].options.allowedTools as string[]).filter((n) => n.includes('coxia_memory'));
const system = (i: number): string => String((calls[i].options.systemPrompt as { append?: string }).append ?? '');

let w: MemoryWorld;
const RULES = (): string => cycleWords('runner.rules.sharedMemory');

beforeEach(() => {
  setLanguage('en');
  updateConfig((c) => ({ ...c, language: 'en' }));
  calls.length = 0;
  scripts = [];
  restRegistry.clear();
  w = memoryWorld();
  setCeremonyMemory((a) => w.port().open({ surface: 'ceremony', agent: a.agent, conversation: null, writes: false, tools: a.tools, cacheOnly: true }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  setCeremonyMemory(null);
  setLanguage('pt-BR');
});

describe('the system agents', () => {
  it.each(['turn', 'reply', 'deep', 'fix'] as const)('%s gets the list at the end of its prompt, the rules and the two reads, and no write tool', async (role) => {
    scripts = [done('s1')];
    await ask(role);
    expect(calls[0].prompt.startsWith('Pergunta\n\n')).toBe(true);
    expect(calls[0].prompt).toMatch(/The memory of this workspace[^]*<data>\n- sys:version[^]*<\/data>$/);
    expect(system(0)).toContain(RULES());
    expect(system(0)).not.toContain(cycleWords('runner.rules.sharedMemoryWrite'));
    expect(Object.keys(calls[0].options.mcpServers ?? {})).toContain('coxia_memory');
    expect(mcpNames(0)).toEqual(['mcp__coxia_memory__memory_list', 'mcp__coxia_memory__memory_read']);
    // no hook to keep a sub-agent from writing: there is nothing that writes
    expect(((calls[0].options.hooks?.PreToolUse ?? []) as { matcher?: string }[]).some((h) => String(h.matcher).includes('memory_save'))).toBe(false);
    expect(w.lines).toEqual([expect.stringMatching(new RegExp(`^\\[memory\\] ceremony ${role} entries=2 chars=\\d+ omitted=0$`))]);
  });

  it('teams has no tools: it gets the list alone, with no rule about a tool and no server', async () => {
    scripts = [done('s1')];
    await ask('teams');
    expect(calls[0].prompt).toContain(cycleWords('runner.section.sharedIndexList', { text: '' }).split('\n')[0]);
    expect(calls[0].prompt).toContain('- sys:version');
    expect(system(0)).not.toContain(RULES());
    expect(Object.keys(calls[0].options.mcpServers ?? {})).not.toContain('coxia_memory');
    expect(mcpNames(0)).toEqual([]);
  });

  it('makes no folder, writes no audit entry and leaves no notice', async () => {
    scripts = [done('s1'), done('s2')];
    await ask('turn');
    await ask('teams');
    expect(existsSync(conversationsPath(w.ws))).toBe(false);
    expect(w.audits).toEqual([]);
  });

  it('answers what it answered before when no door is registered or the switch is off', async () => {
    setCeremonyMemory(null);
    scripts = [done('s1')];
    await ask('turn');
    expect(calls[0].prompt).toBe('Pergunta');
    expect(mcpNames(0)).toEqual([]);
    setCeremonyMemory((a) => w.port().open({ surface: 'ceremony', agent: a.agent, conversation: null, writes: false, tools: a.tools, cacheOnly: true }));
    w.config.runner.sharedMemory = false;
    scripts = [done('s2')];
    await ask('turn');
    expect(calls[1].prompt).toBe('Pergunta');
    expect(system(1)).not.toContain(RULES());
    expect(w.lines).toEqual([]);
  });

  it('opens the session once, before the pool, so a retry on another model reads the same list with the same tools; the wrap-up resume gets none', async () => {
    let opens = 0;
    setCeremonyMemory((a) => (opens++, w.port().open({ surface: 'ceremony', agent: a.agent, conversation: null, writes: false, tools: a.tools, cacheOnly: true })));
    const { newProvider } = await import('../src/shared/config/defaults');
    updateConfig((c) => {
      c.llm.providers.push(newProvider({ id: 'sdk-a', kind: 'anthropic', baseUrl: 'https://a.example.com' }), newProvider({ id: 'sdk-b', kind: 'anthropic', baseUrl: 'https://b.example.com' }));
      return c;
    });
    // a busy refusal of the first model before any tool ran, then the second answers
    updateConfig((c) => {
      c.llm.roles.deep = { ...c.llm.roles.deep, provider: 'sdk-a', model: 'model-a', fallbacks: [{ provider: 'sdk-b', model: 'model-b' }] } as never;
      return c;
    });
    scripts = [[init('s1'), { type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }] } }, result('success', 's1')], done('s2')];
    await ask('deep');
    expect(opens).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].options.model).not.toBe(calls[1].options.model);
    expect(calls[1].prompt).toBe(calls[0].prompt);
    expect(mcpNames(1)).toEqual(mcpNames(0));
    expect(w.lines).toHaveLength(1);
    // the one-turn wrap-up of a call that ran out of turns: no section, no tool
    calls.length = 0;
    opens = 0;
    w.lines.length = 0;
    scripts = [[init('s3'), result('error_max_turns', 's3')], done('s3')];
    const r = await ask('deep');
    expect(r.partial).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].prompt).toContain('The memory of this workspace');
    expect(calls[1].prompt).not.toContain('The memory of this workspace');
    expect(system(1)).not.toContain(RULES());
    expect(mcpNames(1)).toEqual([]);
    expect(opens).toBe(1);
  });
});

describe('the voice path', () => {
  it('never waits for git: a cold cache reads "not read yet" at once, and the refresh runs behind', async () => {
    const config = getConfig();
    const repoDir = mkdtempSync(join(tmpdir(), 'memory-ceremony-repo-'));
    const view = { ...w.config, projects: { ...w.config.projects, repos: [{ id: 'api', path: repoDir, remoteUrl: null, vcsId: null, projectPath: null }] } };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const facts = createFacts({ config: () => view, secret: () => false, tags: async () => (await gate, ['v2.0.0']), now: () => T0 });
    const index = createMemoryIndex({ store: w.store, runs: w.runs, activities: createSharedMemory(w.ws), facts, language: () => 'en', now: () => T0 });
    const port = createMemoryPort({ config: () => view, store: w.store, index, log: (l) => w.lines.push(l) });
    setCeremonyMemory((a) => port.open({ surface: 'ceremony', agent: a.agent, conversation: null, writes: false, tools: a.tools, cacheOnly: true }));
    scripts = [done('s1')];
    await ask('turn');
    expect(calls[0].prompt).toContain('- sys:version Version: not read yet');
    release();
    await facts.warm();
    scripts = [done('s2')];
    await ask('turn');
    expect(calls[1].prompt).toContain('- sys:version Version: api latest v2.0.0, stable v2.0.0');
    void config;
  });
});

describe('an agent named inside a ceremony', () => {
  it('gets the list and the two reads, read only, with no folder, no audit and no line anywhere', async () => {
    const id = getConfig().agents.team.find((a) => !a.system)?.id ?? getConfig().agents.team[0].id;
    scripts = [done('s1', { text: 'I looked.' })];
    const out = await answerCeremonyMentions(`@${id} what did we decide?`, { thread: 'gate-1', ref: 'app#1', title: 'The thing', msgs: [] });
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('I looked.');
    expect(calls[0].prompt).toMatch(/The memory of this workspace[^]*- sys:version/);
    expect(system(0)).toContain(RULES());
    expect(system(0)).not.toContain(cycleWords('runner.rules.sharedMemoryWrite'));
    expect(mcpNames(0)).toEqual(['mcp__coxia_memory__memory_list', 'mcp__coxia_memory__memory_read']);
    expect(existsSync(conversationsPath(w.ws))).toBe(false);
    expect(w.audits).toEqual([]);
    expect(w.lines).toEqual([expect.stringMatching(/^\[memory\] ceremony .+ entries=2/)]);
  });

  it('reads a decision recorded in a conversation (acceptance 11)', async () => {
    const writer = await w.session({ agent: 'developer', conversation: 'squad-core' });
    await writer.tools!.save!({ kind: 'decision', title: 'Use the queue for retries', text: 'Retries go through the queue.' });
    const id = getConfig().agents.team.find((a) => !a.system)?.id ?? getConfig().agents.team[0].id;
    scripts = [done('s1', { text: 'The queue.' })];
    await answerCeremonyMentions(`@${id} what was decided about retries?`, { thread: 'gate-1', ref: 'app#1', title: 'The thing', msgs: [] });
    expect(calls[0].prompt).toMatch(/m-[0-9a-f]{8} decision: Use the queue for retries \(developer, squad-core, 2026-10-09\)/);
    expect(calls[0].prompt).not.toContain('Retries go through the queue.');
  });

  it('is told nothing of it with the switch off', async () => {
    w.config.runner.sharedMemory = false;
    const id = getConfig().agents.team.find((a) => !a.system)?.id ?? getConfig().agents.team[0].id;
    scripts = [done('s1', { text: 'Nothing.' })];
    await answerCeremonyMentions(`@${id} hello`, { thread: 'gate-1', ref: 'app#1', title: 'The thing', msgs: [] });
    expect(calls[0].prompt).not.toContain('The memory of this workspace');
    expect(mcpNames(0)).toEqual([]);
  });
});

describe('the door', () => {
  it('is registered by the memory module: with the switch on a ceremony reads, with it off it gets nothing, whatever the workspace did before', async () => {
    const { memoryModule } = await import('../src/main/memory/module');
    setCeremonyMemory(null);
    memoryModule({ handle: vi.fn(), notify: vi.fn(), emit: vi.fn(), job: vi.fn() });
    const agent = { id: 'turn', permission: 'read', model: { role: null, provider: '', model: '' } } as never;
    updateConfig((c) => ({ ...c, runner: { ...c.runner, sharedMemory: true } }));
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const on = await openCeremonyMemory({ agent, tools: true });
      expect(on?.writes).toBe(false);
      expect(on?.tools?.save).toBeUndefined();
      expect(on?.list.text).toContain('sys:version');
      updateConfig((c) => ({ ...c, runner: { ...c.runner, sharedMemory: false } }));
      expect(await openCeremonyMemory({ agent, tools: true })).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it('warms the version when the memory starts on, and when the switch goes from off to on, and not otherwise', async () => {
    // Fresh modules: the listeners the other tests of this file registered would count their own warm-ups.
    vi.resetModules();
    const { memoryModule } = await import('../src/main/memory/module');
    const { memoryFacts } = await import('../src/main/memory/runtime');
    const fresh = await import('../src/main/workspaceConfig');
    const warm = vi.spyOn(memoryFacts(), 'warm').mockResolvedValue(undefined);
    const set = (on: boolean) => fresh.updateConfig((c) => ({ ...c, runner: { ...c.runner, sharedMemory: on } }));
    try {
      set(false);
      memoryModule({ handle: vi.fn(), notify: vi.fn(), emit: vi.fn(), job: vi.fn() });
      expect(warm).not.toHaveBeenCalled();
      set(false);
      expect(warm).not.toHaveBeenCalled();
      set(true);
      expect(warm).toHaveBeenCalledTimes(1);
      set(true);
      expect(warm).toHaveBeenCalledTimes(1);
      set(false);
      expect(warm).toHaveBeenCalledTimes(1);
      set(true);
      expect(warm).toHaveBeenCalledTimes(2);
      warm.mockClear();
      memoryModule({ handle: vi.fn(), notify: vi.fn(), emit: vi.fn(), job: vi.fn() });
      expect(warm).toHaveBeenCalledTimes(1);
    } finally {
      warm.mockRestore();
    }
  });

  it('answers null with no door registered, and with a door that throws', async () => {
    setCeremonyMemory(null);
    expect(await openCeremonyMemory({ agent: { id: 'turn', permission: 'read', model: { role: null, provider: '', model: '' } } as never, tools: true })).toBeNull();
    setCeremonyMemory(async () => {
      throw new Error('boom');
    });
    expect(await openCeremonyMemory({ agent: { id: 'turn', permission: 'read', model: { role: null, provider: '', model: '' } } as never, tools: true })).toBeNull();
  });
});
