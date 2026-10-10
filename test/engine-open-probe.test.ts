import { afterEach, describe, expect, it } from 'vitest';
import { probeOpenAIProvider } from '../src/main/engine/open/probe';
import { type Fake, type FakeRequest, closedPort, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let fake: Fake | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

// A capable server: plain text, tool calls, response_format.
const capable = (req: FakeRequest) => {
  if (req.body?.tools) return toolStep([{ name: 'echo', args: { text: 'ola' } }]);
  if (req.body?.response_format) return textStep('{"answer":"ok","n":1}');
  return textStep('ok');
};

describe('probeOpenAIProvider', () => {
  it('reports every capability of a capable server, with the key sent as bearer', async () => {
    fake = await fakeOpenAI(capable, { models: [{ id: 'fake-model', context_length: 32768 }, { id: 'other' }], auth: 'sk-test' });
    const r = await probeOpenAIProvider(fake.url, 'sk-test', 'fake-model');
    expect(r.reachable).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.models).toMatchObject({ ok: true, ids: ['fake-model', 'other'], modelListed: true });
    expect(r.capabilities).toEqual({ chat: true, tools: true, jsonSchema: true, streaming: true, reasoning: false, contextWindow: 32768, images: true });
    expect(r.chat.ok && r.tools.ok && r.jsonSchema.ok).toBe(true);
    expect(r.messages.join('\n')).toContain('2 modelo(s) listado(s)');
    expect(r.messages.join('\n')).toContain('Chamada de ferramenta ok');
    // The fourth call shows the model a picture.
    expect(fake.chats()).toHaveLength(4);
    expect(JSON.stringify(fake.chats()[3].body)).toContain('data:image/png;base64,');
  });

  it('says a server that refuses an image does not take images, and leaves it unknown when the call fails for another reason', async () => {
    const noImages = (req: FakeRequest) => (JSON.stringify(req.body).includes('image_url') ? errorStep(400, 'Image input is not supported by this model') : capable(req));
    fake = await fakeOpenAI(noImages);
    const refused = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(refused.capabilities.images).toBe(false);
    expect(refused.images.ok).toBe(false);
    await fake.close();
    const down = (req: FakeRequest) => (JSON.stringify(req.body).includes('image_url') ? errorStep(401, 'bad key') : capable(req));
    fake = await fakeOpenAI(down);
    const unknown = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(unknown.capabilities.images).toBeUndefined();
  });

  it('accepts the bare origin a user types for a local server', async () => {
    fake = await fakeOpenAI(capable);
    const r = await probeOpenAIProvider(fake.url.replace(/\/v1$/, ''), '', 'fake-model');
    expect(r.baseUrl).toBe(fake.url);
    expect(r.ok).toBe(true);
    expect(fake.requests[0].headers.authorization).toBeUndefined();
  });

  it('tells apart a model that answers but does not call tools', async () => {
    fake = await fakeOpenAI((req) => (req.body?.tools ? textStep('eu uso texto mesmo') : capable(req)));
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.ok).toBe(true);
    expect(r.capabilities.tools).toBe(false);
    expect(r.tools.detail).toContain('não chamou a ferramenta');
  });

  it('tells apart a model the server says cannot use tools', async () => {
    fake = await fakeOpenAI((req) => (req.body?.tools ? errorStep(400, 'gemma:2b does not support tools') : capable(req)));
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.capabilities).toMatchObject({ chat: true, tools: false, jsonSchema: true });
    expect(r.tools.detail).toContain('não suporta chamada de ferramentas');
  });

  it('flags a server that rejects response_format, or ignores it', async () => {
    fake = await fakeOpenAI((req) => (req.body?.response_format ? errorStep(400, "Unknown parameter: 'response_format'") : capable(req)));
    const rejected = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(rejected.capabilities.jsonSchema).toBe(false);
    expect(rejected.jsonSchema.detail).toContain('response_format');
    await fake.close();

    fake = await fakeOpenAI((req) => (req.body?.response_format ? textStep('Claro! Aqui vai a resposta.') : capable(req)));
    const ignored = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(ignored.capabilities.jsonSchema).toBe(false);
    expect(ignored.jsonSchema.detail).toContain('fora do esquema');
  });

  it('notes reasoning models, missing models and small context windows', async () => {
    fake = await fakeOpenAI((req) => (req.body?.tools || req.body?.response_format ? capable(req) : textStep('ok', { reasoning: 'pensando', reasoningField: 'reasoning' })), {
      models: [{ id: 'qwen3:8b', max_model_len: 4096 }],
    });
    const r = await probeOpenAIProvider(fake.url, '', 'qwen3:9b');
    expect(r.capabilities.reasoning).toBe(true);
    expect(r.models.modelListed).toBe(false);
    const text = r.messages.join('\n');
    expect(text).toContain('não aparece na lista');
    expect(text).toContain('qwen3:8b');
    // no match for the requested model id, so no context is claimed
    expect(r.capabilities.contextWindow).toBeUndefined();

    const small = await probeOpenAIProvider(fake.url, '', 'qwen3:8b');
    expect(small.capabilities.contextWindow).toBe(4096);
    expect(small.messages.join('\n')).toContain('é pequena');
  });

  it('a server without /models still gets tested', async () => {
    fake = await fakeOpenAI(capable, { modelsStatus: 404 });
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.models.ok).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.messages[0]).toContain('Não foi possível listar os modelos');
  });

  it('reports a wrong key without running the other tests', async () => {
    fake = await fakeOpenAI(capable, { auth: 'right', modelsStatus: undefined });
    const r = await probeOpenAIProvider(fake.url, 'wrong', 'fake-model');
    expect(r.reachable).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toContain('recusou a chave');
    expect(fake.chats()).toHaveLength(0);
  });

  it('reports a server that is not running, in either language', async () => {
    const url = await closedPort();
    const pt = await probeOpenAIProvider(url, '', 'm');
    expect(pt.reachable).toBe(false);
    expect(pt.ok).toBe(false);
    expect(pt.messages[0]).toContain('Servidor inacessível');
    expect(pt.messages[0]).toContain('servidor local não está rodando');
    const en = await probeOpenAIProvider(url, '', 'm', { lang: 'en' });
    expect(en.messages[0]).toContain('Server unreachable');
  });

  it('a failing plain completion is the headline problem', async () => {
    fake = await fakeOpenAI((req) => errorStep(404, `model '${req.body?.model}' not found, try pulling it first`));
    const r = await probeOpenAIProvider(fake.url, '', 'ghost');
    expect(r.ok).toBe(false);
    expect(r.chat.detail).toContain('"ghost"');
    expect(r.capabilities.chat).toBe(false);
    expect(fake.chats()).toHaveLength(1);
  });

  it('falls back to a non-streaming completion for a server that breaks SSE', async () => {
    fake = await fakeOpenAI((req) => (req.body?.stream ? { chunks: ['{not json'], done: false, cutAfter: 1 } : { completion: { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] } }), {});
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.chat.ok).toBe(true);
    expect(r.capabilities.streaming).toBe(false);
  });
});

describe('probeOpenAIProvider: the catalog', () => {
  it('reads the listing into catalog facts and writes what the probe found over the tested model', async () => {
    const models = [
      { id: 'fake-model', metadata: { context_length: 65536, pricing: { input_tokens: 0.3, output_tokens: 1.2, cache_read_tokens: 0.06 }, tags: ['reasoning'] } },
      { id: 'other', metadata: { context_length: 32768, pricing: { input_tokens: 0.1, output_tokens: 0.4 }, tags: ['vision'] } },
      { id: 'bare' },
    ];
    fake = await fakeOpenAI(capable, { models });
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.catalog.map((m) => m.id)).toEqual(['fake-model', 'other', 'bare']);
    // The tested model: tools, schema and image come from the probe, the price from the listing.
    expect(r.catalog[0]).toMatchObject({ price: { input: 0.3, output: 1.2, cacheRead: 0.06 }, contextWindow: 65536, tools: true, structured: true, vision: true, reasoning: true });
    // The others keep what the listing said and null for the rest: nobody calls the other models.
    expect(r.catalog[1]).toMatchObject({ vision: true, tools: null, structured: null });
    expect(r.catalog[2]).toMatchObject({ price: null, vision: null, tools: null });
    expect(fake.chats()).toHaveLength(4);
  });

  it('keeps at most 300 models and survives a listing in another shape', async () => {
    fake = await fakeOpenAI(capable, { models: Array.from({ length: 320 }, (_, i) => ({ id: `m-${i}` })) });
    expect((await probeOpenAIProvider(fake.url, '', 'm-0')).catalog).toHaveLength(300);
    await fake.close();
    fake = await fakeOpenAI(capable, { models: [{ id: 'fake-model', metadata: 'oops', pricing: 3 }] });
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.ok).toBe(true);
    expect(r.catalog).toHaveLength(1);
  });

  it('leaves the catalog empty when the listing fails', async () => {
    fake = await fakeOpenAI(capable, { modelsStatus: 500 });
    const r = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(r.catalog).toEqual([]);
  });
});

describe('probeOpenAIProvider: the provider\'s richer listing', () => {
  const models = [
    { id: 'fake-model', metadata: { context_length: 65536, tags: ['reasoning', 'reasoning_effort'] } },
    { id: 'other', metadata: { context_length: 32768, tags: ['vision'] } },
  ];
  const rich = [
    { model_name: 'fake-model', tags: ['flex', 'tools', 'structured-output'], deprecated: null, replaced_by: null },
    { model_name: 'other', tags: [], deprecated: null, replaced_by: null },
    { model_name: 'retired-model', tags: ['tools'], deprecated: 1781217521, replaced_by: 'fake-model' },
  ];

  it('adds flex, the tool and schema tags and the retirement dates to the catalog, with the key sent along', async () => {
    fake = await fakeOpenAI(capable, { models, rich, auth: 'sk-test' });
    const r = await probeOpenAIProvider(fake.url, 'sk-test', 'fake-model', { catalogUrl: fake.richUrl });
    expect(r.ok).toBe(true);
    expect(r.catalog[0]).toMatchObject({ id: 'fake-model', flex: true, effort: true, tools: true, structured: true });
    expect(r.catalog[1]).toMatchObject({ id: 'other', flex: false });
    // the retired model is not in the standard listing, and still comes with its date and substitute
    expect(r.catalog.map((m) => m.id)).toEqual(['fake-model', 'other']);
    expect(r.deprecations).toEqual({ 'retired-model': { at: 1781217521, replacedBy: 'fake-model' } });
    expect(fake.requests.filter((q) => q.url.endsWith('/models/list'))).toHaveLength(1);
    expect(fake.requests.find((q) => q.url.endsWith('/models/list'))?.headers.authorization).toBe('Bearer sk-test');
  });

  it('says in the lines of the test when the tested model is the retired one, naming the substitute', async () => {
    fake = await fakeOpenAI(capable, { models: [{ id: 'retired-model' }], rich });
    const r = await probeOpenAIProvider(fake.url, '', 'retired-model', { catalogUrl: fake.richUrl, lang: 'en' });
    expect(r.messages.join('\n')).toContain('marks retired-model as obsolete (date: 2026-06-11)');
    expect(r.messages.join('\n')).toContain('suggests fake-model');
  });

  it('is not read without an address, and never from another origin: the key stays where it was configured', async () => {
    fake = await fakeOpenAI(capable, { models, rich });
    const none = await probeOpenAIProvider(fake.url, '', 'fake-model');
    expect(none.deprecations).toEqual({});
    expect(none.catalog[0].flex).toBeNull();
    const away = await probeOpenAIProvider(fake.url, 'sk-secret', 'fake-model', { catalogUrl: 'http://127.0.0.2:9/models/list', lang: 'en' });
    expect(away.ok).toBe(true);
    expect(away.catalog[0].flex).toBeNull();
    expect(away.messages.join('\n')).toContain('richer model listing could not be read');
    expect(fake.requests.filter((q) => q.url.endsWith('/models/list'))).toHaveLength(0);
  });

  it('a listing that fails or is not an array does not fail the test: a line says what was not updated', async () => {
    fake = await fakeOpenAI(capable, { models, rich, richStatus: 500 });
    const failed = await probeOpenAIProvider(fake.url, '', 'fake-model', { catalogUrl: fake.richUrl, lang: 'en' });
    expect(failed.ok).toBe(true);
    expect(failed.messages.join('\n')).toContain('richer model listing could not be read');
    expect(failed.catalog[0].flex).toBeNull();
    await fake.close();
    fake = await fakeOpenAI(capable, { models, rich: { oops: true } as never });
    const odd = await probeOpenAIProvider(fake.url, '', 'fake-model', { catalogUrl: fake.richUrl });
    expect(odd.ok).toBe(true);
    expect(odd.deprecations).toEqual({});
  });
});
