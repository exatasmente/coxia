// Which engine serves a role comes from the workspace config (the provider the role is mapped to), not from an environment hook:
// an openai-compatible provider goes to the open engine with its key from the secrets store; an anthropic one goes to the Claude SDK.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newProvider } from '../src/shared/config/defaults';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

type Msg = Record<string, unknown>;
const sdkCalls: { prompt: string; options: Record<string, unknown> }[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    sdkCalls.push({ prompt, options });
    const script: Msg[] = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'do SDK' } },
    ];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

let fake: Fake;
let agents: typeof import('../src/main/agents');
let cfg: typeof import('../src/main/workspaceConfig');

const schema = () => agents.obj({ fala: agents.str });

beforeAll(async () => {
  fake = await fakeOpenAI(() => toolStep([{ name: 'final_answer', args: { fala: 'do motor aberto' } }]));
  agents = await import('../src/main/agents');
  cfg = await import('../src/main/workspaceConfig');
  const helpers = await import('./helpers/config');
  process.env.COXIA_SEAM_LLM = 'secret-for-the-local-provider';
  process.env.COXIA_SEAM_CLAUDE = 'secret-for-anthropic';
  const { secrets } = await import('../src/main/secrets');
  secrets().set({ ref: 'llm.local', source: 'env', name: 'COXIA_SEAM_LLM' });
  secrets().set({ ref: 'llm.anthropic', source: 'env', name: 'COXIA_SEAM_CLAUDE' });
  cfg.updateConfig((c) => {
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: fake.url, secretRef: 'llm.local', structured: 'tool', headers: { 'X-Title': 'Coxia' }, capabilities: { chat: true, tools: true, jsonSchema: false, streaming: true, reasoning: false, contextWindow: 32768 } }));
    c.llm.roles.deep = { provider: 'local', model: 'qwen3:8b' };
    return c;
  });
  void helpers;
});

afterAll(async () => {
  await fake.close();
});

describe('engineFor(role)', () => {
  it('maps each role to its provider, model and engine', async () => {
    const { engineFor } = await import('../src/main/engine/registry');
    expect(engineFor('deep')).toMatchObject({ providerId: 'local', engine: 'open', model: 'qwen3:8b', kind: 'openai-compatible' });
    expect(engineFor('turn')).toMatchObject({ providerId: 'anthropic', engine: 'claude-sdk', model: 'haiku' });
  });
});

describe('a role mapped to an openai-compatible provider', () => {
  it('runs on the open engine with the key from the secrets store, the configured model, headers and structured mode', async () => {
    const r = await agents.askAgent<{ fala: string }>('deep', 'Pergunta', schema(), { maxTurns: 2 });
    expect(r.data).toEqual({ fala: 'do motor aberto' });
    const req = fake.chats()[0];
    expect(req.headers.authorization).toBe('Bearer secret-for-the-local-provider');
    expect(req.headers['x-title']).toBe('Coxia');
    expect(req.body?.model).toBe('qwen3:8b');
    expect(sdkCalls).toHaveLength(0);
  });

  it('hands the open engine the documentation sources of the config', async () => {
    const { openSelection } = agents;
    const { engineFor } = await import('../src/main/engine/registry');
    const sel = openSelection(engineFor('deep'), '/tmp');
    expect(sel.provider).toMatchObject({ baseUrl: fake.url, model: 'qwen3:8b', apiKey: 'secret-for-the-local-provider', headers: { 'X-Title': 'Coxia' } });
    expect(sel.capabilities).toEqual({ tools: true, jsonSchema: false, contextWindow: 32768 });
    expect(sel.structured).toBe('tool');
    expect(sel.docs).toBeDefined();
  });

  it('hands the open engine the pool of the role: only the models of the open engine, with what the entries say of them, and no pool without spares', async () => {
    const { engineFor } = await import('../src/main/engine/registry');
    expect(agents.openSelection(engineFor('deep'), '/tmp').pool).toBeUndefined();
    cfg.updateConfig((c) => {
      c.llm.roles.deep = {
        provider: 'local',
        model: 'qwen3:8b',
        fallbacks: [{ provider: 'local', model: 'model-b', images: true, contextWindow: 64_000, echoReasoning: true }, { provider: 'anthropic', model: 'haiku' }],
        activities: { screen: [{ provider: 'local', model: 'model-b', images: true }], shell: [{ provider: 'anthropic', model: 'sonnet' }] },
      };
      return c;
    });
    try {
      const sel = agents.openSelection(engineFor('deep'), '/tmp');
      expect(sel.pool?.name).toBe('deep');
      expect(sel.pool?.primary).toMatchObject({ label: 'qwen3:8b', provider: 'local' });
      // The Claude entries wait for the start of a stage; they never join an open session.
      expect(sel.pool?.fallbacks.map((m) => m.label)).toEqual(['model-b']);
      expect(sel.pool?.fallbacks[0]).toMatchObject({ provider: 'local', config: { model: 'model-b', baseUrl: fake.url, apiKey: 'secret-for-the-local-provider', echoReasoning: true }, capabilities: { tools: true, jsonSchema: false, contextWindow: 64_000, images: true } });
      expect(Object.keys(sel.pool?.activities ?? {})).toEqual(['screen']);
      expect(new Set([sel.pool?.primary.key, ...(sel.pool?.fallbacks.map((m) => m.key) ?? [])]).size).toBe(2);
      expect(sel.capabilities).toEqual({ tools: true, jsonSchema: false, contextWindow: 32768 });
    } finally {
      cfg.updateConfig((c) => {
        c.llm.roles.deep = { provider: 'local', model: 'qwen3:8b' };
        return c;
      });
    }
  });

  it('fails with a clear message when the key has no source on this machine', async () => {
    cfg.updateConfig((c) => {
      c.llm.providers.find((p) => p.id === 'local')!.secretRef = 'llm.missing';
      return c;
    });
    await expect(agents.askAgent('deep', 'Pergunta', schema())).rejects.toThrow(/Chave do provedor não configurada \(llm\.missing\)/);
    cfg.updateConfig((c) => {
      c.llm.providers.find((p) => p.id === 'local')!.secretRef = 'llm.local';
      return c;
    });
  });
});

describe('a role mapped to an anthropic provider', () => {
  it('runs on the Claude SDK with the key as ANTHROPIC_API_KEY and the configured model', async () => {
    const r = await agents.askAgent<{ fala: string }>('turn', 'Pergunta', schema());
    expect(r.data).toEqual({ fala: 'do SDK' });
    expect(sdkCalls).toHaveLength(1);
    const { options } = sdkCalls[0];
    expect(options.model).toBe('haiku');
    expect(options.env).toMatchObject({ ANTHROPIC_API_KEY: 'secret-for-anthropic', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' });
    expect((options.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('adds the per-role instructions and overrides of the config to the system prompt', async () => {
    cfg.updateConfig((c) => {
      c.agents.extraInstructions = 'Sempre cite o arquivo.';
      c.agents.roles.turn.extraInstructions = 'Seja breve.';
      c.voice.enabled = true;
      return c;
    });
    await agents.askAgent('turn', 'Pergunta', schema());
    const append = (sdkCalls[1].options.systemPrompt as { append: string }).append;
    expect(append).toContain('cerimônia por voz');
    expect(append.indexOf('Sempre cite o arquivo.')).toBeLessThan(append.indexOf('Seja breve.'));
    cfg.updateConfig((c) => {
      c.agents.roles.turn.promptOverride = 'Preâmbulo próprio.';
      return c;
    });
    await agents.askAgent('turn', 'Pergunta', schema());
    const replaced = (sdkCalls[2].options.systemPrompt as { append: string }).append;
    expect(replaced).toContain('Preâmbulo próprio.');
    expect(replaced).not.toContain('cerimônia por voz');
  });

  it('a role can borrow another role\'s provider and model (agents.roles.modelRole)', async () => {
    cfg.updateConfig((c) => {
      c.agents.roles.turn.modelRole = 'deep';
      return c;
    });
    const before = fake.chats().length;
    const r = await agents.askAgent<{ fala: string }>('turn', 'Pergunta', schema());
    expect(r.data).toEqual({ fala: 'do motor aberto' });
    expect(fake.chats().length).toBeGreaterThan(before);
  });
});
