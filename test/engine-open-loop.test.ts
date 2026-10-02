import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, agentHooks, obj, secretPath, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { EngineError } from '../src/main/engine/open/errors';
import { type OpenRunParams, OpenMaxTurnsError, StructuredOutputError, runOpen } from '../src/main/engine/open/loop';
import { messagesOf, readSession, usageOf } from '../src/main/engine/open/session';
import { closeAllMcp, loadMcpConfigs, mcpTools } from '../src/main/engine/open/tools/mcp';
import { type Fake, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

const schema = obj({ fala: str, texto: str });
const answer = { fala: 'resposta falada', texto: 'resposta escrita' };
const finalCall = (args: object = answer, id = 'call_final') => toolStep([{ id, name: 'final_answer', args }], { usageTokens: [30, 8] });

let dir: string;
let sessions: string;
let fake: Fake | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-loop-'));
  sessions = join(dir, '.sessions');
  mkdirSync(join(dir, 'rules'));
  mkdirSync(join(dir, 'skills/foo'), { recursive: true });
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'a.txt'), 'hello needle\nsecond line\n');
  writeFileSync(join(dir, '.env'), 'API_KEY=needle-secret\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Projeto\nRegra do projeto XYZ.\n\nVeja @rules/r.md e `@not/an/import.md`.\n\n```\n@rules/ignored.md\n```\n');
  writeFileSync(join(dir, 'rules/r.md'), 'REGRA IMPORTADA 123');
  writeFileSync(join(dir, 'rules/ignored.md'), 'NUNCA CARREGAR');
  writeFileSync(join(dir, 'skills/foo/SKILL.md'), '---\nname: foo\ndescription: "Faz foo quando pedem foo"\n---\n\n# Foo\nPasso 1: fazer foo.\n');
  writeFileSync(join(dir, 'agents/rev.md'), '---\nname: rev\ndescription: Revisor de código\n---\nVocê é o revisor. Seja breve.\n');
});

afterEach(async () => {
  await fake?.close();
  fake = null;
  closeAllMcp();
  rmSync(dir, { recursive: true, force: true });
});

const clientFor = (f: Fake, extra = {}) => new ChatClient({ baseUrl: f.url, model: 'fake-model', retryDelayMs: 0, ...extra });

function params(f: Fake, over: Partial<OpenRunParams> = {}): OpenRunParams {
  return {
    role: 'deep',
    prompt: 'Qual é o conteúdo de a.txt?',
    schema,
    client: clientFor(f),
    cwd: dir,
    allowedTools: ['Read', 'Grep', 'Glob', 'Skill'],
    hooks: agentHooks(),
    isSecret: (p) => secretPath(p, dir),
    secretGlobs: SECRET_GLOBS,
    docs: { claudeMd: [join(dir, 'CLAUDE.md')], skillDirs: [join(dir, 'skills')], agentDirs: [join(dir, 'agents')] },
    maxTurns: 8,
    sessionsDir: sessions,
    ripgrep: 'off',
    ...over,
  };
}

const toolMessages = (body: Record<string, any>) => (body.messages as { role: string; content: string; tool_call_id?: string }[]).filter((m) => m.role === 'tool');

describe('a normal run', () => {
  it('runs parallel tool calls, feeds the results back and ends on final_answer', async () => {
    fake = await fakeOpenAI([
      toolStep(
        [
          { id: 'call_r', name: 'Read', args: { file_path: 'a.txt' } },
          { id: 'call_g', name: 'Grep', args: { pattern: 'needle', output_mode: 'content' } },
        ],
        { usageTokens: [100, 20] },
      ),
      finalCall(),
    ]);
    const used: string[] = [];
    const r = await runOpen<typeof answer>(params(fake, { events: { onToolUse: (n) => used.push(n) } }));
    expect(r.data).toEqual(answer);
    expect(r.strategy).toBe('tool');
    expect(r.turns).toBe(2);
    expect(r.sources).toEqual(['Read a.txt', `Grep needle`]);
    expect(used).toEqual(['Read', 'Grep']);
    expect(r.usage).toEqual({ promptTokens: 130, completionTokens: 28, cachedTokens: 0 });

    const second = fake.chats()[1].body as Record<string, any>;
    const results = toolMessages(second);
    expect(results.map((t) => t.tool_call_id)).toEqual(['call_r', 'call_g']);
    expect(results[0].content).toContain('1\thello needle');
    expect(results[1].content).toContain('a.txt:1:hello needle');
    expect(results[1].content).not.toContain('needle-secret');
  });

  it('offers the read tools and final_answer, with the schema as its parameters', async () => {
    fake = await fakeOpenAI([finalCall()]);
    await runOpen(params(fake));
    const body = fake.chats()[0].body as Record<string, any>;
    const names = body.tools.map((t: any) => t.function.name);
    expect(names).toEqual(['Read', 'Grep', 'Glob', 'Skill', 'final_answer']);
    expect(body.tools[4].function.parameters).toEqual(schema);
    expect(body.tool_choice).toBeUndefined();
  });

  it('builds the system prompt from CLAUDE.md with @imports, skills and the caller append', async () => {
    fake = await fakeOpenAI([finalCall()]);
    await runOpen(params(fake, { systemAppend: 'PAPEL: voce e um agente de cerimonia' }));
    const [system, user] = (fake.chats()[0].body as Record<string, any>).messages;
    expect(system.role).toBe('system');
    expect(system.content).toContain('Regra do projeto XYZ.');
    expect(system.content).toContain('REGRA IMPORTADA 123');
    expect(system.content).not.toContain('NUNCA CARREGAR');
    expect(system.content).toContain('- foo: Faz foo quando pedem foo');
    expect(system.content).toContain('PAPEL: voce e um agente de cerimonia');
    expect(system.content).toContain('call the final_answer tool');
    expect(system.content).toContain(`Working directory: ${dir}`);
    expect(user).toEqual({ role: 'user', content: 'Qual é o conteúdo de a.txt?' });
  });

  it('loads a skill body on demand', async () => {
    fake = await fakeOpenAI([toolStep([{ name: 'Skill', args: { skill: 'foo' } }]), finalCall()]);
    await runOpen(params(fake));
    const [msg] = toolMessages(fake.chats()[1].body as Record<string, any>);
    expect(msg.content).toContain('Passo 1: fazer foo.');
    expect(msg.content).not.toContain('description:');
  });

  it('does not offer tools the call did not allow', async () => {
    fake = await fakeOpenAI([finalCall()]);
    await runOpen(params(fake, { allowedTools: ['Read'], disallowedTools: ['Bash', 'Edit', 'Read(**/.env*)'] }));
    const names = (fake.chats()[0].body as Record<string, any>).tools.map((t: any) => t.function.name);
    expect(names).toEqual(['Read', 'final_answer']);
  });

  it('works without a schema: the text is the answer', async () => {
    fake = await fakeOpenAI([textStep('só texto')]);
    const r = await runOpen<string>(params(fake, { schema: undefined }));
    expect(r.data).toBe('só texto');
    expect(r.strategy).toBe('text');
  });

  it('estimates usage when the server reports none', async () => {
    fake = await fakeOpenAI([toolStep([{ name: 'final_answer', args: answer }])]);
    const seen: boolean[] = [];
    const r = await runOpen(params(fake, { events: { onUsage: (u) => seen.push(u.estimated === true) } }));
    expect(r.usage.promptTokens).toBeGreaterThan(0);
    expect(r.usage.completionTokens).toBeGreaterThan(0);
    expect(seen).toEqual([true]);
  });

  it('stops when the caller aborts', async () => {
    fake = await fakeOpenAI([finalCall()]);
    const ctl = new AbortController();
    ctl.abort();
    await expect(runOpen(params(fake, { signal: ctl.signal }))).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('tool failures are fed back, not thrown', () => {
  it('reports a missing file, a bad argument and an unknown tool to the model', async () => {
    fake = await fakeOpenAI([
      toolStep([
        { id: 'c1', name: 'Read', args: { file_path: 'nope.txt' } },
        { id: 'c2', name: 'Read', args: {} },
        { id: 'c3', name: 'Teleport', args: {} },
      ]),
      finalCall(),
    ]);
    const r = await runOpen<typeof answer>(params(fake));
    const [a, b, c] = toolMessages(fake.chats()[1].body as Record<string, any>).map((t) => t.content);
    expect(a).toContain('[erro da ferramenta]');
    expect(a).toContain('does not exist');
    expect(b).toContain('Argumentos inválidos');
    expect(b).toContain('file_path');
    expect(c).toContain('Ferramenta desconhecida: Teleport');
    expect(r.sources).toEqual(['Read nope.txt', 'Read', 'Teleport']);
  });

  it('refuses secrets and shell escapes with the shared policy text, and keeps going', async () => {
    fake = await fakeOpenAI([
      toolStep([
        { id: 's1', name: 'Read', args: { file_path: '.env' } },
        { id: 's2', name: 'Grep', args: { pattern: 'API_KEY', path: '.env', output_mode: 'content' } },
        { id: 's3', name: 'Glob', args: { pattern: '**/.env*' } },
        { id: 's4', name: 'Bash', args: { command: 'cat .env' } },
      ]),
      finalCall(),
    ]);
    const r = await runOpen<typeof answer>(params(fake, { allowedTools: ['Read', 'Grep', 'Glob', 'Bash(glab api:*)'] }));
    const msgs = toolMessages(fake.chats()[1].body as Record<string, any>).map((t) => t.content);
    expect(msgs[0]).toContain('fora do alcance da cerimônia');
    expect(msgs[1]).toContain('fora do alcance da cerimônia');
    expect(msgs[2]).toContain('fora do alcance da cerimônia');
    expect(msgs[3]).toContain('só lê');
    expect(JSON.stringify(fake.chats()[1].body)).not.toContain('needle-secret');
    expect(r.data).toEqual(answer);
    // like the Claude path, a denied call is still a source the agent tried
    expect(r.sources).toHaveLength(4);
  });

  it('runs an allowed glab command without a shell and refuses one outside the Bash rules', async () => {
    fake = await fakeOpenAI([
      toolStep([
        { id: 'g1', name: 'Bash', args: { command: 'glab api projects/acme%2Fweb/issues/1/notes; echo pwned' } },
        { id: 'g2', name: 'Bash', args: { command: 'glab mr view 3 -R acme/web' } },
      ]),
      finalCall(),
    ]);
    await runOpen(params(fake, { allowedTools: ['Read', 'Bash(glab api:*)'] }));
    const [first, second] = toolMessages(fake.chats()[1].body as Record<string, any>).map((t) => t.content);
    expect(first).toContain('só lê');
    // allowed by the hook allowlist, but this call only whitelisted `glab api`
    expect(second).toContain('fora do que a cerimônia pode rodar');
  });

  it('confines files to the working directory and the extra directories', async () => {
    const other = mkdtempSync(join(tmpdir(), 'open-other-'));
    writeFileSync(join(other, 'o.txt'), 'other root');
    try {
      fake = await fakeOpenAI([toolStep([{ name: 'Read', args: { file_path: join(other, 'o.txt') } }]), finalCall()]);
      await runOpen(params(fake));
      expect(toolMessages(fake.chats()[1].body as Record<string, any>)[0].content).toContain('fora das pastas');
      const f2 = await fakeOpenAI([toolStep([{ name: 'Read', args: { file_path: join(other, 'o.txt') } }]), finalCall()]);
      await runOpen(params(f2, { additionalDirectories: [other] }));
      expect(toolMessages(f2.chats()[1].body as Record<string, any>)[0].content).toContain('other root');
      await f2.close();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('caps the size of a tool result', async () => {
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(100_000));
    fake = await fakeOpenAI([toolStep([{ name: 'Read', args: { file_path: 'big.txt' } }]), finalCall()]);
    await runOpen(params(fake, { toolOutputMax: 2000 }));
    const [msg] = toolMessages(fake.chats()[1].body as Record<string, any>);
    expect(msg.content.length).toBeLessThan(2200);
    expect(msg.content).toContain('cortado');
  });
});

describe('max turns, partial answer and resume', () => {
  it('throws OpenMaxTurnsError with the session id and sources, and the session can be resumed without tools', async () => {
    fake = await fakeOpenAI((req) => (req.n <= 2 ? toolStep([{ id: `c${req.n}`, name: 'Read', args: { file_path: 'a.txt' } }]) : finalCall({ fala: 'parcial', texto: 'o que deu para ler' })));
    let err: OpenMaxTurnsError | null = null;
    try {
      await runOpen(params(fake, { maxTurns: 2 }));
    } catch (e) {
      err = e as OpenMaxTurnsError;
    }
    expect(err).toBeInstanceOf(OpenMaxTurnsError);
    expect(err?.sources).toEqual(['Read a.txt', 'Read a.txt']);
    expect(err?.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const r = await runOpen<typeof answer>(params(fake, { resume: err?.sessionId, maxTurns: 2, noTools: true, allowedTools: [], prompt: 'Acabaram as chamadas. Responda agora.' }));
    expect(r.data).toEqual({ fala: 'parcial', texto: 'o que deu para ler' });
    expect(r.sessionId).toBe(err?.sessionId);
    const wrap = fake.chats()[2].body as Record<string, any>;
    // only final_answer is on offer and it is forced
    expect(wrap.tools.map((t: any) => t.function.name)).toEqual(['final_answer']);
    expect(wrap.tool_choice).toEqual({ type: 'function', function: { name: 'final_answer' } });
    // the earlier reads are in the history
    expect(toolMessages(wrap)).toHaveLength(2);
    expect(wrap.messages[wrap.messages.length - 1]).toEqual({ role: 'user', content: 'Acabaram as chamadas. Responda agora.' });
  });

  it('persists a JSONL transcript with usage, and resume continues it', async () => {
    fake = await fakeOpenAI([toolStep([{ name: 'Read', args: { file_path: 'a.txt' } }], { usageTokens: [50, 5] }), finalCall(), finalCall({ fala: 'segunda', texto: 'resposta' })]);
    const first = await runOpen(params(fake));
    const lines = readSession(sessions, first.sessionId) ?? [];
    expect(lines[0]).toMatchObject({ t: 'meta', role: 'deep', model: 'fake-model' });
    const roles = messagesOf(lines).map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool']);
    expect(usageOf(lines)).toEqual({ promptTokens: 80, completionTokens: 13, cachedTokens: 0 });
    // the raw file really is JSONL
    for (const l of readFileSync(join(sessions, `${first.sessionId}.jsonl`), 'utf8').trim().split('\n')) JSON.parse(l);

    const again = await runOpen<typeof answer>(params(fake, { resume: first.sessionId, prompt: 'E agora?' }));
    expect(again.sessionId).toBe(first.sessionId);
    const body = fake.chats()[2].body as Record<string, any>;
    expect(body.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'user']);
    expect(body.messages[1].content).toBe('Qual é o conteúdo de a.txt?');
    expect(body.messages[6].content).toBe('E agora?');
    expect(readSession(sessions, first.sessionId)?.some((l) => l.t === 'resume')).toBe(true);
  });

  it('heals a transcript whose last assistant turn lost its tool results', async () => {
    fake = await fakeOpenAI([toolStep([{ id: 'c1', name: 'Read', args: { file_path: 'a.txt' } }]), finalCall()]);
    let id = '';
    try {
      await runOpen(params(fake, { maxTurns: 1 }));
    } catch (e) {
      id = (e as OpenMaxTurnsError).sessionId;
    }
    // simulate a crash right after the assistant message
    const file = join(sessions, `${id}.jsonl`);
    const kept = readFileSync(file, 'utf8').trim().split('\n').filter((l) => !l.includes('"role":"tool"'));
    writeFileSync(file, `${kept.join('\n')}\n{"t":"msg","at":"x","mess`);
    await runOpen(params(fake, { resume: id, prompt: 'continue' }));
    const body = fake.chats()[1].body as Record<string, any>;
    expect(toolMessages(body).map((m) => m.tool_call_id)).toEqual(['c1']);
  });

  it('starts a fresh session when the resume id is unknown', async () => {
    fake = await fakeOpenAI([finalCall()]);
    const r = await runOpen(params(fake, { resume: '00000000-0000-0000-0000-000000000000' }));
    expect(r.sessionId).not.toBe('00000000-0000-0000-0000-000000000000');
    expect((fake.chats()[0].body as Record<string, any>).messages[0].role).toBe('system');
  });
});

describe('structured output', () => {
  it('tool strategy: a text answer is nudged and the next call is forced to final_answer', async () => {
    fake = await fakeOpenAI([textStep('já sei a resposta, é 42'), finalCall()]);
    const r = await runOpen(params(fake));
    expect(r.data).toEqual(answer);
    const second = fake.chats()[1].body as Record<string, any>;
    expect(second.messages[second.messages.length - 1].content).toContain('Você não chamou final_answer');
    expect(second.tool_choice).toEqual({ type: 'function', function: { name: 'final_answer' } });
    // the nudge does not eat into maxTurns
    expect(r.turns).toBe(1);
  });

  it('tool strategy: a text answer that already is the JSON is accepted without a nudge', async () => {
    fake = await fakeOpenAI([textStep('```json\n' + JSON.stringify(answer) + '\n```')]);
    const r = await runOpen(params(fake));
    expect(r.data).toEqual(answer);
    expect(fake.chats()).toHaveLength(1);
  });

  it('tool strategy: invalid arguments come back as an error, then a valid call is accepted', async () => {
    fake = await fakeOpenAI([finalCall({ fala: 1 }, 'bad'), finalCall()]);
    const r = await runOpen(params(fake));
    expect(r.data).toEqual(answer);
    const second = fake.chats()[1].body as Record<string, any>;
    expect(toolMessages(second)[0].content).toContain('Argumentos inválidos');
    expect(toolMessages(second)[0].content).toContain('$.fala');
  });

  it('tool strategy: extra fields are pruned, repairable JSON is repaired, failure after the retries throws', async () => {
    fake = await fakeOpenAI([finalCall({ ...answer, sobra: 'x' }, 'a')]);
    expect((await runOpen(params(fake))).data).toEqual(answer);

    const f2 = await fakeOpenAI([toolStep([{ name: 'final_answer', args: '{"fala":"a","texto":"b",}' }])]);
    expect((await runOpen(params(f2))).data).toEqual({ fala: 'a', texto: 'b' });
    await f2.close();

    const f3 = await fakeOpenAI([finalCall({ fala: 1 })]);
    await expect(runOpen(params(f3))).rejects.toBeInstanceOf(StructuredOutputError);
    expect(f3.chats()).toHaveLength(3);
    await f3.close();
  });

  it('response_format strategy: tools run freely, then one closing call asks for the JSON with response_format and no tools', async () => {
    fake = await fakeOpenAI([toolStep([{ name: 'Read', args: { file_path: 'a.txt' } }]), textStep('Li o arquivo e ele diz hello.'), textStep(JSON.stringify(answer))]);
    const r = await runOpen(params(fake, { capabilities: { jsonSchema: true } }));
    expect(r.strategy).toBe('response_format');
    expect(r.data).toEqual(answer);
    const [first, , closing] = fake.chats().map((c) => c.body as Record<string, any>);
    expect(first.response_format).toBeUndefined();
    expect(first.tools.map((t: any) => t.function.name)).toEqual(['Read', 'Grep', 'Glob', 'Skill']);
    expect(closing.tools).toBeUndefined();
    expect(closing.response_format).toMatchObject({ type: 'json_schema', json_schema: { schema } });
    expect(closing.messages[closing.messages.length - 1].content).toContain('somente com o JSON');
    expect(first.messages[0].content).toContain('ONLY one JSON object');
  });

  it('response_format strategy: an answer that is already valid JSON costs no extra call', async () => {
    fake = await fakeOpenAI([textStep(JSON.stringify(answer))]);
    const r = await runOpen(params(fake, { capabilities: { jsonSchema: true } }));
    expect(r.data).toEqual(answer);
    expect(fake.chats()).toHaveLength(1);
  });

  it('response_format strategy: a server that rejects response_format still gets the answer, and is not asked again', async () => {
    fake = await fakeOpenAI((req) => {
      if (req.body?.response_format) return errorStep(400, "Unknown parameter: 'response_format'");
      return req.n === 1 ? textStep('prosa sem json') : textStep('```json\n' + JSON.stringify(answer) + '\n```');
    });
    const client = clientFor(fake);
    const r = await runOpen(params(fake, { client, capabilities: { jsonSchema: true } }));
    expect(r.data).toEqual(answer);
    expect(client.learned.dropParams.has('response_format')).toBe(true);
    // the next run on the same client picks the tool strategy instead
    const next = await runOpen(params(fake, { client, capabilities: { jsonSchema: true } }));
    expect(next.strategy).toBe('tool');
  });

  it('prompt strategy (no tools): the schema goes in the prompt, fenced JSON is repaired, one correction round, then it fails', async () => {
    fake = await fakeOpenAI([textStep('```json\n{"fala":"a","texto":"b"}\n```')]);
    const r = await runOpen(params(fake, { capabilities: { tools: false } }));
    expect(r.strategy).toBe('prompt');
    expect(r.data).toEqual({ fala: 'a', texto: 'b' });
    const body = fake.chats()[0].body as Record<string, any>;
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain('"required":["fala","texto"]');

    const f2 = await fakeOpenAI([textStep('não sei fazer json'), textStep('ainda não'), textStep('{"fala":"só uma chave"}')]);
    await expect(runOpen(params(f2, { capabilities: { tools: false } }))).rejects.toThrow('não segue o formato');
    expect(f2.chats()).toHaveLength(3);
    await f2.close();

    const f3 = await fakeOpenAI([textStep('talvez'), textStep('{"fala":"a","texto":"b"}')]);
    expect((await runOpen(params(f3, { capabilities: { tools: false } }))).data).toEqual({ fala: 'a', texto: 'b' });
    await f3.close();
  });

  it('a model that cannot do tools is switched to the prompt strategy instead of failing', async () => {
    fake = await fakeOpenAI((req) => (req.body?.tools ? errorStep(400, 'registry.ollama.ai/library/gemma:2b does not support tools') : textStep(JSON.stringify(answer))));
    const client = clientFor(fake);
    const r = await runOpen(params(fake, { client }));
    expect(r.data).toEqual(answer);
    expect(r.strategy).toBe('prompt');
    expect(client.learned.noTools).toBe(true);
    expect(fake.chats()).toHaveLength(2);
    const retry = fake.chats()[1].body as Record<string, any>;
    expect(retry.tools).toBeUndefined();
  });
});

describe('context window', () => {
  it('compacts old tool results and retries when the server says the context is too long', async () => {
    writeFileSync(join(dir, 'big.txt'), `${'y'.repeat(99)}\n`.repeat(100));
    fake = await fakeOpenAI((req) => {
      const msgs = (req.body?.messages ?? []) as { role: string; content: string }[];
      const big = msgs.some((m) => m.role === 'tool' && m.content.length > 3000);
      if (req.n === 1) return toolStep([{ id: 'a', name: 'Read', args: { file_path: 'big.txt' } }]);
      if (req.n === 2) return toolStep([{ id: 'b', name: 'Read', args: { file_path: 'a.txt' } }]);
      if (req.n === 3) return toolStep([{ id: 'c', name: 'Read', args: { file_path: 'a.txt' } }]);
      if (big) return errorStep(400, "This model's maximum context length is 4096 tokens. However, your messages resulted in 9000 tokens.", { code: 'context_length_exceeded' });
      return finalCall();
    });
    const r = await runOpen(params(fake));
    expect(r.data).toEqual(answer);
    const last = fake.chats()[fake.chats().length - 1].body as Record<string, any>;
    expect(toolMessages(last)[0].content).toContain('reduzido para caber no contexto');
  });

  it('compacts before the call when the estimate passes the known window', async () => {
    writeFileSync(join(dir, 'big.txt'), `${'z'.repeat(99)}\n`.repeat(200));
    fake = await fakeOpenAI([toolStep([{ id: 'a', name: 'Read', args: { file_path: 'big.txt' } }]), toolStep([{ id: 'b', name: 'Read', args: { file_path: 'a.txt' } }]), toolStep([{ id: 'c', name: 'Read', args: { file_path: 'a.txt' } }]), finalCall()]);
    await runOpen(params(fake, { capabilities: { contextWindow: 2000 } }));
    const calls = fake.chats().map((c) => c.body as Record<string, any>);
    // the tool output itself is capped by the window, and old results shrink before the last calls
    expect(calls[1].messages.find((m: any) => m.role === 'tool').content.length).toBeLessThan(5200);
    expect(calls[3].messages.filter((m: any) => m.role === 'tool')[0].content).toContain('reduzido');
  });
});

describe('sub-agents', () => {
  it('delegates to a sub-agent with its own prompt; its reads count as sources; it cannot nest', async () => {
    fake = await fakeOpenAI((req) => {
      const system = String((req.body?.messages ?? [])[0]?.content ?? '');
      if (system.includes('Você é o revisor')) {
        const hasResult = (req.body?.messages ?? []).some((m: any) => m.role === 'tool');
        return hasResult ? textStep('o revisor leu e achou ok') : toolStep([{ id: 'sub1', name: 'Read', args: { file_path: 'a.txt' } }]);
      }
      return req.n === 1 ? toolStep([{ id: 'ag', name: 'Agent', args: { description: 'revisar', prompt: 'Revise a.txt', subagent_type: 'rev' } }]) : finalCall();
    });
    const r = await runOpen<typeof answer>(params(fake, { allowedTools: ['Read', 'Agent'] }));
    expect(r.data).toEqual(answer);
    expect(r.sources).toEqual(['Agent', 'Read a.txt']);
    const parent2 = fake.chats().find((c) => c.n > 1 && !String(c.body?.messages[0].content).includes('Você é o revisor'))?.body as Record<string, any>;
    expect(toolMessages(parent2)[0].content).toBe('o revisor leu e achou ok');
    const subCalls = fake.chats().filter((c) => String(c.body?.messages[0].content).includes('Você é o revisor'));
    expect(subCalls.length).toBe(2);
    expect(subCalls[0].body?.tools.map((t: any) => t.function.name)).toEqual(['Read']);
    // the sub-agent is not persisted as a session of its own
    expect(readSession(sessions, r.sessionId)?.filter((l) => l.t === 'meta')).toHaveLength(1);
  });
});

describe('MCP', () => {
  const server = join(__dirname, 'helpers/fakeMcp.mjs');
  const config = () => {
    const file = join(dir, '.mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [server] }, remote: { type: 'http', url: 'http://x' } } }));
    return file;
  };

  it('reads stdio servers from a config file and skips remote ones', () => {
    expect(Object.keys(loadMcpConfigs([config(), join(dir, 'missing.json')]))).toEqual(['fake']);
  });

  it('exposes only the allowed tools, namespaced, and runs them', async () => {
    const tools = await mcpTools(loadMcpConfigs([config()]), ['mcp__fake__echo', 'mcp__fake__boom']);
    expect(tools.map((t) => t.name).sort()).toEqual(['mcp__fake__boom', 'mcp__fake__echo']);
    const echo = tools.find((t) => t.name === 'mcp__fake__echo');
    const ctx = { cwd: dir, roots: [dir], isSecret: () => false, secretGlobs: [], outputMax: 1000, env: {}, bashPrefixes: [], ripgrep: 'off' as const };
    const r = await echo?.run({ text: 'oi' }, ctx);
    expect(r?.render(r.response)).toBe('echo: oi');
    await expect(tools.find((t) => t.name === 'mcp__fake__boom')?.run({}, ctx)).rejects.toThrow('it blew up');
  });

  it('allows a whole server with mcp__server and nothing from a server not named', async () => {
    expect((await mcpTools(loadMcpConfigs([config()]), ['mcp__fake'])).length).toBe(4);
    expect(await mcpTools(loadMcpConfigs([config()]), ['mcp__other__echo'])).toEqual([]);
  });

  it('a server that cannot start is skipped, not fatal', async () => {
    const errors: string[] = [];
    const tools = await mcpTools({ bad: { command: '/no/such/binary-xyz' } }, ['mcp__bad__x'], (s) => errors.push(s));
    expect(tools).toEqual([]);
    expect(errors).toEqual(['bad']);
  });

  it('goes through the loop, with long tool names mapped to valid API names and back', async () => {
    const long = 'mcp__fake__get_merge_request_details_and_changes_with_a_very_long_name_for_mapping';
    fake = await fakeOpenAI((req) => {
      if (req.n > 1) return finalCall();
      const names = (req.body?.tools ?? []).map((t: any) => t.function.name) as string[];
      const mapped = names.find((n) => n.startsWith('mcp__fake__get_merge'));
      return toolStep([
        { id: 'm1', name: 'mcp__fake__echo', args: { text: 'via loop' } },
        { id: 'm2', name: mapped ?? 'missing', args: { iid: 7 } },
        { id: 'm3', name: 'mcp__fake__dangerous_write', args: {} },
      ]);
    });
    const r = await runOpen<typeof answer>(params(fake, { allowedTools: ['Read', 'mcp__fake__echo', long], docs: { mcpConfigs: [config()] } }));
    expect(r.data).toEqual(answer);
    const names = (fake.chats()[0].body as Record<string, any>).tools.map((t: any) => t.function.name) as string[];
    expect(names.every((n) => /^[a-zA-Z0-9_-]{1,64}$/.test(n))).toBe(true);
    expect(names).not.toContain('mcp__fake__dangerous_write');
    const msgs = toolMessages(fake.chats()[1].body as Record<string, any>).map((t) => t.content);
    expect(msgs[0]).toBe('echo: via loop');
    expect(msgs[1]).toContain('called get_merge_request_details_and_changes_with_a_very_long_name_for_mapping {"iid":7}');
    expect(msgs[2]).toContain('Ferramenta desconhecida');
  });
});

describe('errors surface to the caller', () => {
  it('an auth failure ends the run with the pt-BR message', async () => {
    fake = await fakeOpenAI([errorStep(401, 'Incorrect API key')]);
    const e = await runOpen(params(fake)).catch((x) => x as EngineError);
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).message).toContain('chave de API');
  });
});
