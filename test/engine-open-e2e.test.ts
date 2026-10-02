// The app's own call shapes (deepAsk, askAgent with a partial answer) on the open engine, against a fake OpenAI server, with no mock of
// the agents module: COXIA_ENGINE=open routes runOnce to the open loop. HOME is a temp folder, so the Claude path (which reads an
// OpenRouter key through ~/.local/bin) would fail loudly if it were taken.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Card } from '../src/shared/types';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let home: string;
let projects: string;
let fake: Fake;
let agents: typeof import('../src/main/agents');
let env: typeof import('../src/main/env');

const card: Card = {
  ref: '#15499',
  iid: '15499',
  title: 'Corrigir filtro',
  stage: 'In Progress',
  spec: null,
  mrs: [],
  mrPaths: [],
  blockers: [],
  pending: [],
  changes: [],
  note: null,
  url: 'https://gitlab.example/issues/15499',
};

const deepAnswer = { fala: 'Li a nota: o filtro está no arquivo.', texto: 'O filtro vive em `note.txt:1`.' };

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'open-e2e-home-'));
  projects = join(home, 'projects');
  mkdirSync(projects);
  writeFileSync(join(projects, 'note.txt'), 'filtro de grupo de usuários\nsegunda linha\n');
  writeFileSync(join(projects, '.env'), 'OPENROUTER_API_KEY=should-never-leak\n');
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => {
    const text = JSON.stringify(req.body?.messages ?? []);
    if (text.includes('Acabaram as chamadas')) return toolStep([{ name: 'final_answer', args: { fala: 'Parcial: só deu para ler a nota.', texto: 'Resposta parcial.' } }]);
    if (text.includes('forever')) return toolStep([{ id: `c${req.n}`, name: 'Read', args: { file_path: join(projects, 'note.txt') } }]);
    if (req.n === 1) {
      return toolStep(
        [
          { id: 'r1', name: 'Read', args: { file_path: join(projects, 'note.txt') } },
          { id: 'g1', name: 'Grep', args: { pattern: 'filtro', output_mode: 'content' } },
          { id: 'e1', name: 'Read', args: { file_path: join(projects, '.env') } },
        ],
        { usageTokens: [400, 60] },
      );
    }
    return toolStep([{ name: 'final_answer', args: deepAnswer }], { usageTokens: [520, 40] });
  });
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  agents = await import('../src/main/agents');
  env = await import('../src/main/env');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

describe('deepAsk on the open engine', () => {
  it('answers with tool reads, structured output, sources and a resumable session', async () => {
    const r = await agents.deepAsk(card, 'Onde está o filtro de grupo de usuários?', null);
    expect(r.speech).toBe(deepAnswer.fala);
    expect(r.text).toBe(deepAnswer.texto);
    expect(r.sources).toEqual([`Read ${join(projects, 'note.txt')}`, 'Grep filtro', `Read ${join(projects, '.env')}`]);
    expect(r.partial).toBeUndefined();
    expect(r.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const [first, second] = fake.chats().map((c) => c.body as Record<string, any>);
    expect(first.model).toBe('fake-model');
    expect(fake.chats()[0].headers.authorization).toBe('Bearer sk-local-test');
    const system = first.messages[0].content as string;
    expect(system).toContain('cerimônia por voz');
    expect(system).toContain('glab api projects/');
    const tools = first.tools.map((t: any) => t.function.name);
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash', 'Agent', 'final_answer']));
    expect(first.messages[1].content).toContain('Onde está o filtro de grupo de usuários?');
    expect(first.messages[1].content).toContain('Desbloqueio por voz da atividade #15499');
    expect(first.messages[1].content).toContain('Cartão da atividade');

    // the secret file stayed out of the model context, the note did not
    const results = second.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content as string);
    expect(results[0]).toContain('1\tfiltro de grupo de usuários');
    expect(results[1]).toContain('note.txt:1:filtro de grupo de usuários');
    expect(results[2]).toContain('fora do alcance da cerimônia');
    expect(JSON.stringify(second)).not.toContain('should-never-leak');

    // the transcript is where the cost panel and resume expect it
    expect(existsSync(join(env.ATAS, 'open-sessions', `${r.sessionId}.jsonl`))).toBe(true);
  });

  it('resumes the same session on the next question', async () => {
    const before = fake.chats().length;
    const first = await agents.deepAsk(card, 'Onde está o filtro?', null);
    const again = await agents.deepAsk(card, 'E a segunda linha?', first.sessionId);
    expect(again.sessionId).toBe(first.sessionId);
    const resumed = fake.chats()[fake.chats().length - 1].body as Record<string, any>;
    const users = resumed.messages.filter((m: any) => m.role === 'user').map((m: any) => m.content as string);
    expect(users).toHaveLength(2);
    expect(users[0]).toContain('Onde está o filtro?');
    expect(users[1]).toContain('E a segunda linha?');
    expect(fake.chats().length).toBeGreaterThan(before);
  });
});

describe('a call that runs out of turns', () => {
  it('resumes once without tools and returns a partial answer, like the Claude path', async () => {
    const schema = agents.obj({ fala: agents.str, texto: agents.str });
    const r = await agents.askAgent<{ fala: string; texto: string }>('deep', 'Investigue forever até o fim.', schema, { maxTurns: 2 });
    expect(r.partial).toBe(true);
    expect(r.data).toEqual({ fala: 'Parcial: só deu para ler a nota.', texto: 'Resposta parcial.' });
    expect(r.sources).toEqual([`Read ${join(projects, 'note.txt')}`, `Read ${join(projects, 'note.txt')}`]);
    const wrap = fake.chats()[fake.chats().length - 1].body as Record<string, any>;
    expect(wrap.tools.map((t: any) => t.function.name)).toEqual(['final_answer']);
    expect(wrap.tool_choice).toEqual({ type: 'function', function: { name: 'final_answer' } });
    expect(wrap.messages.filter((m: any) => m.role === 'tool')).toHaveLength(2);
  });
});

describe('the Claude engine stays the default', () => {
  it('does not select the open engine without the flag', async () => {
    const { openEngineFromEnv } = await import('../src/main/engine/open');
    expect(openEngineFromEnv({})).toBeNull();
    expect(openEngineFromEnv({ COXIA_ENGINE: 'claude', COXIA_LLM_OPENAI_BASEURL: 'x', COXIA_LLM_OPENAI_MODEL: 'y' })).toBeNull();
    expect(openEngineFromEnv({ COXIA_ENGINE: 'open', COXIA_LLM_OPENAI_BASEURL: 'x' })).toBeNull();
    expect(openEngineFromEnv({ COXIA_ENGINE: 'open', COXIA_LLM_OPENAI_BASEURL: 'http://h/v1', COXIA_LLM_OPENAI_MODEL: 'm', COXIA_LLM_OPENAI_KEY: 'k' })).toMatchObject({
      provider: { baseUrl: 'http://h/v1', model: 'm', apiKey: 'k' },
    });
  });
});

