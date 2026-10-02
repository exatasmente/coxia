// The same activity lines from the open engine, against a fake OpenAI server: tool labels, narration between calls, a blocked secret read,
// and nothing a tool returned.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActivityEntry } from '../src/shared/activity';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let home: string;
let projects: string;
let fake: Fake;
let agents: typeof import('../src/main/agents');
let log: typeof import('../src/main/activity');
const pushed: ActivityEntry[] = [];

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'open-activity-home-'));
  projects = join(home, 'projects');
  mkdirSync(projects);
  writeFileSync(join(projects, 'note.txt'), 'conteudo-secreto-da-nota\nsegunda linha\n');
  writeFileSync(join(projects, '.env'), 'OPENROUTER_API_KEY=should-never-leak\n');
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => {
    if (req.n === 1) {
      return toolStep(
        [
          { id: 'r1', name: 'Read', args: { file_path: join(projects, 'note.txt') } },
          { id: 'g1', name: 'Grep', args: { pattern: 'glpat-abcdefghij1234567890', output_mode: 'content' } },
          { id: 'e1', name: 'Read', args: { file_path: join(projects, '.env') } },
        ],
        { text: 'Vou ler a nota e procurar a chave.' },
      );
    }
    return toolStep([{ name: 'final_answer', args: { fala: 'resposta-final-secreta' } }]);
  });
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  agents = await import('../src/main/agents');
  log = await import('../src/main/activity');
  await (await import('./helpers/config')).installLegacyConfig();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

describe('activity from the open engine', () => {
  it('reports tools, the narration before them, blocked calls and the end, redacted and without results', async () => {
    log.activityLog.setSink((e) => pushed.push(e));
    const schema = agents.obj({ fala: agents.str });
    const r = await log.withActivityContext('deep:#7:ask', () => agents.askAgent<{ fala: string }>('deep', 'Onde está a nota?', schema, { maxTurns: 4 }));
    expect(r.data).toEqual({ fala: 'resposta-final-secreta' });

    const entries = log.activityLog.get('deep:#7:ask');
    expect(entries).toEqual(pushed);
    expect(entries.map((e) => [e.kind, e.state ?? null, e.label])).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['text', null, 'Vou ler a nota e procurar a chave.'],
      ['tool', null, `Read ${join(projects, 'note.txt').replace(home, '~')}`],
      ['tool', null, 'Grep [key]'],
      ['tool', null, 'Read [secret file]'],
      ['status', 'blocked', 'Bloqueado: Read [secret file]'],
      ['status', 'finished', 'Terminou'],
    ]);
    expect(entries.every((e) => e.jobId === 'deep:#7:ask' && e.role === 'deep' && e.runId === entries[0].runId)).toBe(true);

    const wire = JSON.stringify(entries);
    for (const leaked of ['conteudo-secreto-da-nota', 'should-never-leak', 'glpat-abcdefghij', 'resposta-final-secreta']) expect(wire).not.toContain(leaked);
  });
});
