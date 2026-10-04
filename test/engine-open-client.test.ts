import { afterEach, describe, expect, it } from 'vitest';
import { ChatClient, normalizeBaseUrl } from '../src/main/engine/open/client';
import { EngineError } from '../src/main/engine/open/errors';
import { type Fake, closedPort, errorStep, fakeOpenAI, textStep, toolStep, usage } from './helpers/fakeOpenAI';

let fake: Fake | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

const user = [{ role: 'user' as const, content: 'oi' }];
const client = (url: string, extra = {}) => new ChatClient({ baseUrl: url, model: 'm', apiKey: 'secret', retryDelayMs: 0, ...extra });
const failure = async (p: Promise<unknown>): Promise<EngineError> => {
  try {
    await p;
  } catch (e) {
    return e as EngineError;
  }
  throw new Error('expected a failure');
};

describe('normalizeBaseUrl', () => {
  it('adds /v1 to a bare origin and strips endpoint suffixes', () => {
    expect(normalizeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });
});

describe('streaming', () => {
  it('folds text, usage and the bearer header', async () => {
    fake = await fakeOpenAI([textStep('Olá, mundo', { usageTokens: [11, 3] })]);
    const seen: string[] = [];
    const c = await client(fake.url).complete({ messages: user, onText: (t) => seen.push(t) });
    expect(c.text).toBe('Olá, mundo');
    expect(seen.join('')).toBe('Olá, mundo');
    expect(c.usage).toEqual({ promptTokens: 11, completionTokens: 3, cachedTokens: 0 });
    expect(c.finishReason).toBe('stop');
    const req = fake.chats()[0];
    expect(req.headers.authorization).toBe('Bearer secret');
    expect(req.body?.stream).toBe(true);
    expect(req.body?.stream_options).toEqual({ include_usage: true });
    expect(req.body?.model).toBe('m');
  });

  it('keeps reasoning out of the text, from a reasoning field and from <think> tags', async () => {
    fake = await fakeOpenAI([textStep('resposta', { reasoning: 'pensando', reasoningField: 'reasoning' }), textStep('<think>hmm</think>final')]);
    const a = await client(fake.url).complete({ messages: user });
    expect(a).toMatchObject({ text: 'resposta', reasoning: 'pensando', reasoningField: 'reasoning' });
    const b = await client(fake.url).complete({ messages: user });
    expect(b).toMatchObject({ text: 'final', reasoning: 'hmm' });
  });

  it('assembles parallel tool calls streamed by index', async () => {
    fake = await fakeOpenAI([
      toolStep([
        { id: 'call_a', name: 'Read', args: { file_path: '/a' } },
        { id: 'call_b', name: 'Grep', args: { pattern: 'x' } },
      ]),
    ]);
    const c = await client(fake.url).complete({ messages: user });
    expect(c.toolCalls.map((t) => [t.id, t.function.name, JSON.parse(t.function.arguments)])).toEqual([
      ['call_a', 'Read', { file_path: '/a' }],
      ['call_b', 'Grep', { pattern: 'x' }],
    ]);
    expect(c.finishReason).toBe('tool_calls');
  });

  it('separates parallel calls that all use index 0 and carry no id', async () => {
    const piece = (name: string, args: string) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name, arguments: args } }] }, finish_reason: null }] });
    fake = await fakeOpenAI([{ chunks: [piece('Read', '{"file_path":"/a"}'), piece('Read', '{"file_path":"/b"}')] }]);
    const c = await client(fake.url).complete({ messages: user });
    expect(c.toolCalls).toHaveLength(2);
    expect(c.toolCalls.map((t) => JSON.parse(t.function.arguments).file_path)).toEqual(['/a', '/b']);
    expect(new Set(c.toolCalls.map((t) => t.id)).size).toBe(2);
  });

  it('keeps one call whose name is repeated in every chunk', async () => {
    const piece = (args: string) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: args } }] }, finish_reason: null }] });
    fake = await fakeOpenAI([{ chunks: [piece('{"file_'), piece('path":"/a"}')] }]);
    const c = await client(fake.url).complete({ messages: user });
    expect(c.toolCalls).toHaveLength(1);
    expect(JSON.parse(c.toolCalls[0].function.arguments)).toEqual({ file_path: '/a' });
  });

  it('accepts a plain JSON body from a server that ignores stream', async () => {
    fake = await fakeOpenAI([
      {
        completion: {
          choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/a"}' } }] } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } },
        },
      },
    ]);
    const c = await client(fake.url).complete({ messages: user });
    expect(c.toolCalls[0].function.name).toBe('Read');
    expect(c.usage).toEqual({ promptTokens: 5, completionTokens: 2, cachedTokens: 4 });
  });

  it('works with stream:false and sends no stream_options', async () => {
    fake = await fakeOpenAI([{ completion: { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] } }]);
    const c = await client(fake.url, { stream: false }).complete({ messages: user });
    expect(c.text).toBe('ok');
    expect(fake.chats()[0].body?.stream).toBeUndefined();
  });

  it('reports a stream cut in the middle', async () => {
    fake = await fakeOpenAI([{ chunks: [{ choices: [{ index: 0, delta: { content: 'meio' } }] }, { choices: [{ index: 0, delta: { content: 'x' } }] }], cutAfter: 1 }]);
    const e = await failure(client(fake.url).complete({ messages: user }));
    expect(e.kind).toBe('network');
  });

  it('turns an error chunk inside a 200 stream into an error', async () => {
    fake = await fakeOpenAI([{ chunks: [{ error: { message: 'Rate limit exceeded: slow down', code: 429 } }] }]);
    const e = await failure(client(fake.url).complete({ messages: user }));
    expect(e).toBeInstanceOf(EngineError);
    expect(e.message).toContain('Rate limit');
  });
});

describe('request building', () => {
  it('sends tools, tool_choice, response_format and the output cap', async () => {
    fake = await fakeOpenAI([textStep('{}')]);
    const tools = [{ type: 'function' as const, function: { name: 'Read', parameters: { type: 'object', properties: {} } } }];
    await client(fake.url, { maxOutputTokens: 1000 }).complete({
      messages: user,
      tools,
      toolChoice: 'required',
      responseFormat: { type: 'json_schema', json_schema: { name: 'a', schema: {} } },
      maxTokens: 500,
    });
    const body = fake.chats()[0].body as Record<string, any>;
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('required');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.max_tokens).toBe(500);
  });

  it('drops reasoning_content from history until the server proves it uses it', async () => {
    fake = await fakeOpenAI([textStep('a', { reasoning: 'think', reasoningField: 'reasoning_content' }), textStep('b')]);
    const c = client(fake.url);
    const history = [
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: 'r', reasoning_content: 'because' },
      { role: 'user' as const, content: 'q2' },
    ];
    await c.complete({ messages: history });
    expect(fake.chats()[0].body?.messages[1].reasoning_content).toBeUndefined();
    await c.complete({ messages: history });
    expect(fake.chats()[1].body?.messages[1].reasoning_content).toBe('because');
  });
});

describe('parameter fallbacks', () => {
  it('switches to max_completion_tokens and remembers it', async () => {
    fake = await fakeOpenAI((req) =>
      'max_tokens' in (req.body ?? {}) ? errorStep(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.") : textStep('ok'),
    );
    const c = client(fake.url, { maxOutputTokens: 100 });
    expect((await c.complete({ messages: user })).text).toBe('ok');
    expect(fake.chats()).toHaveLength(2);
    await c.complete({ messages: user });
    expect(fake.chats()).toHaveLength(3);
    expect(fake.chats()[2].body?.max_completion_tokens).toBe(100);
    expect(fake.chats()[2].body?.max_tokens).toBeUndefined();
  });

  it('clamps an output cap the server says is too large', async () => {
    fake = await fakeOpenAI((req) =>
      (req.body?.max_tokens ?? 0) > 8192 ? errorStep(400, 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]') : textStep('ok'),
    );
    const c = client(fake.url, { maxOutputTokens: 32000 });
    await c.complete({ messages: user });
    expect(fake.chats().map((r) => r.body?.max_tokens)).toEqual([32000, 8192]);
    await c.complete({ messages: user });
    expect(fake.chats()[2].body?.max_tokens).toBe(8192);
  });

  it('clamps with the room left after the prompt (vLLM wording)', async () => {
    fake = await fakeOpenAI((req) =>
      (req.body?.max_tokens ?? 0) > 7000 ? errorStep(400, "'max_tokens' is too large: 32000. This model's maximum context length is 8192 tokens and your request has 1192 input tokens (32000 > 8192 - 1192).") : textStep('ok'),
    );
    await client(fake.url, { maxOutputTokens: 32000 }).complete({ messages: user });
    expect(fake.chats().map((r) => r.body?.max_tokens)).toEqual([32000, 7000]);
  });

  it('drops parameters the server names as unsupported', async () => {
    fake = await fakeOpenAI((req) => {
      if (req.body?.stream_options) return errorStep(400, "Unknown parameter: 'stream_options'");
      if (req.body?.temperature !== undefined) return errorStep(400, "Unsupported value: 'temperature' does not support 0.2 with this model.");
      return textStep('ok');
    });
    const c = client(fake.url, { temperature: 0.2 });
    expect((await c.complete({ messages: user })).text).toBe('ok');
    expect(fake.chats()).toHaveLength(3);
    expect(fake.chats()[2].body).not.toHaveProperty('stream_options');
    expect(fake.chats()[2].body).not.toHaveProperty('temperature');
  });

  it('drops tool_choice a server does not support', async () => {
    fake = await fakeOpenAI((req) => (req.body?.tool_choice ? errorStep(400, 'tool_choice is not supported') : textStep('ok')));
    const tools = [{ type: 'function' as const, function: { name: 'Read', parameters: { type: 'object', properties: {} } } }];
    await client(fake.url).complete({ messages: user, tools, toolChoice: { type: 'function', function: { name: 'Read' } } });
    expect(fake.chats()[1].body).not.toHaveProperty('tool_choice');
    expect(fake.chats()[1].body?.tools).toHaveLength(1);
  });
});

describe('errors', () => {
  it('401 is an auth error that names the status and is not retried', async () => {
    fake = await fakeOpenAI([errorStep(401, 'Incorrect API key provided', { code: 'invalid_api_key' })]);
    const e = await failure(client(fake.url).complete({ messages: user }));
    expect(e.kind).toBe('auth');
    expect(e.message).toContain('HTTP 401');
    expect(e.message).toContain('chave');
    expect(fake.chats()).toHaveLength(1);
  });

  it('404 / model not found points at the model name', async () => {
    fake = await fakeOpenAI([errorStep(404, "model 'qwen9' not found, try pulling it first")]);
    const e = await failure(client(fake.url).complete({ messages: user }));
    expect(e.kind).toBe('not_found');
    expect(e.message).toContain('"m"');
    expect(e.message).toContain('ollama list');
  });

  it('a 400 about the context window is a context error', async () => {
    fake = await fakeOpenAI([errorStep(400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 9500 tokens.", { code: 'context_length_exceeded' })]);
    const e = await failure(client(fake.url).complete({ messages: user }));
    expect(e.kind).toBe('context');
    expect(e.message).toContain('contexto');
  });

  it('a model without tool support is reported as such', async () => {
    fake = await fakeOpenAI([errorStep(400, 'registry.ollama.ai/library/gemma:2b does not support tools')]);
    const e = await failure(client(fake.url).complete({ messages: user, tools: [{ type: 'function', function: { name: 'x', parameters: {} } }] }));
    expect(e.kind).toBe('no_tools');
  });

  it('retries a 429 and a 503, then succeeds', async () => {
    fake = await fakeOpenAI([errorStep(429, 'Rate limit reached'), errorStep(503, 'overloaded'), textStep('ok')]);
    expect((await client(fake.url).complete({ messages: user })).text).toBe('ok');
    expect(fake.chats()).toHaveLength(3);
  });

  it('gives up after the retries and says rate limit', async () => {
    fake = await fakeOpenAI([errorStep(429, 'Rate limit reached')]);
    const e = await failure(client(fake.url, { maxRetries: 1 }).complete({ messages: user }));
    expect(e.kind).toBe('rate_limit');
    expect(fake.chats()).toHaveLength(2);
  });

  it('an exhausted quota is not retried', async () => {
    fake = await fakeOpenAI([errorStep(429, 'You exceeded your current quota, please check your plan and billing details.', { code: 'insufficient_quota' })]);
    const e = await failure(client(fake.url).complete({ messages: user }));
    expect(e.kind).toBe('quota');
    expect(fake.chats()).toHaveLength(1);
  });

  it('a 402 and a 403 whose body is about the key budget are a budget refusal, not retried and naming the provider', async () => {
    fake = await fakeOpenAI([errorStep(402, 'Payment Required')]);
    const paid = await failure(client(fake.url).complete({ messages: user }));
    expect(paid.kind).toBe('budget');
    expect(paid.retryable).toBe(false);
    expect(paid.message).toContain('orçamento');

    fake = await fakeOpenAI([errorStep(403, 'Failed to authenticate. API Error: 403 Key limit exceeded (monthly limit)')]);
    const limited = await failure(client(fake.url).complete({ messages: user }));
    expect(limited.kind).toBe('budget');
    expect(limited.retryable).toBe(false);
    expect(limited.message).toContain('orçamento');
    // The provider is named: what the client talks to, not the word the SDK put in front of the message.
    expect(limited.message).toContain(fake.url.replace(/^https?:\/\//, '').split('/')[0]);
    expect(fake.chats()).toHaveLength(1);
  });

  it('a plain 403 and a plain 429 keep their own kinds', async () => {
    fake = await fakeOpenAI([errorStep(403, 'You do not have permission to use this model')]);
    const forbidden = await failure(client(fake.url).complete({ messages: user }));
    expect(forbidden.kind).toBe('forbidden');

    fake = await fakeOpenAI([errorStep(429, 'Rate limit reached')]);
    const limited = await failure(client(fake.url, { maxRetries: 0 }).complete({ messages: user }));
    expect(limited.kind).toBe('rate_limit');
    expect(limited.retryable).toBe(true);
  });

  it('connection refused says the local server is not running', async () => {
    const e = await failure(client(await closedPort()).complete({ messages: user }));
    expect(e.kind).toBe('network');
    expect(e.message).toContain('servidor local não está rodando');
    expect(e.retryable).toBe(false);
  });

  it('answers in English when asked', async () => {
    const e = await failure(client(await closedPort(), { lang: 'en' }).complete({ messages: user }));
    expect(e.message).toContain('local server is not running');
  });

  it('a call aborted by the caller is an aborted error', async () => {
    fake = await fakeOpenAI([textStep('ok')]);
    const ctl = new AbortController();
    ctl.abort();
    const e = await failure(client(fake.url).complete({ messages: user, signal: ctl.signal }));
    expect(e.kind).toBe('aborted');
  });

  it('lists the models and uses the bearer key', async () => {
    fake = await fakeOpenAI([], { models: [{ id: 'a' }, { id: 'b', context_length: 4096 }], auth: 'secret' });
    const r = await client(fake.url).listModels();
    expect(r.ids).toEqual(['a', 'b']);
  });

  it('usage with cached tokens is folded', async () => {
    fake = await fakeOpenAI([{ chunks: [{ choices: [{ index: 0, delta: { content: 'x' } }] }, { choices: [], usage: { ...usage(100, 5), prompt_tokens_details: { cached_tokens: 80 } } }] }]);
    expect((await client(fake.url).complete({ messages: user })).usage).toEqual({ promptTokens: 100, completionTokens: 5, cachedTokens: 80 });
  });
});
