// Sub-agents of the open engine as nodes of the tree, through the real askAgent against a fake OpenAI server: a stage that delegates to three sub-agents in one turn
// shows three nodes under its own, each with only its own lines.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActivityEntry } from '../src/shared/activity';
import { type Fake, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let home: string;
let projects: string;
let fake: Fake;
let agents: typeof import('../src/main/agents');
let log: typeof import('../src/main/activity');
const pushed: ActivityEntry[] = [];

const TASKS = ['A', 'B', 'C'] as const;
// How many files each sub-agent reads before it answers: different on purpose, so their lines reach the log interleaved.
const READS: Record<string, number> = { A: 3, B: 1, C: 2 };
const FINAL = 'resposta-final-do-estagio';
const CHILD_ANSWER = 'resposta-secreta-do-subagente';

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'open-subagents-home-'));
  projects = join(home, 'projects');
  mkdirSync(projects);
  for (const t of TASKS) for (let i = 1; i <= 3; i++) writeFileSync(join(projects, `${t.toLowerCase()}${i}.txt`), `conteudo ${t}${i}\n`);
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => {
    const messages = (req.body?.messages ?? []) as { role: string; content: unknown }[];
    const tools = ((req.body?.tools ?? []) as { function: { name: string } }[]).map((x) => x.function.name);
    const toolMessages = messages.filter((m) => m.role === 'tool').length;
    if (tools.includes('Agent')) {
      // The stage: delegate in one turn, then answer once the three have returned.
      if (toolMessages === 0) {
        return toolStep(
          TASKS.map((t) => ({ id: `delegate_${t}`, name: 'Agent', args: { description: `map the tests of ${t}`, prompt: `task ${t}: list what is in ${t.toLowerCase()}`, subagent_type: 'explore' } })),
          { text: 'Vou dividir o trabalho.' },
        );
      }
      return toolStep([{ name: 'final_answer', args: { fala: FINAL } }]);
    }
    const first = String(messages.find((m) => m.role === 'user')?.content ?? '');
    const who = TASKS.find((t) => first.includes(`task ${t}:`)) ?? 'A';
    if (toolMessages < READS[who]) return toolStep([{ id: `read_${who}${toolMessages}`, name: 'Read', args: { file_path: join(projects, `${who.toLowerCase()}${toolMessages + 1}.txt`) } }]);
    return textStep(CHILD_ANSWER);
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

const rows = (entries: ActivityEntry[], runId: string) => entries.filter((e) => e.runId === runId).map((e) => [e.kind, e.state ?? null, e.label]);

describe('sub-agents of the open engine as nodes', () => {
  it('shows three sub-agents of one turn as three nodes under the stage, each with only its own lines', async () => {
    log.activityLog.setSink((e) => pushed.push(e));
    const schema = agents.obj({ fala: agents.str });
    const r = await log.withActivityContext('deep:#9:ask', () => agents.askAgent<{ fala: string }>('deep', 'Mapeie os testes', schema, { maxTurns: 6 }));
    expect(r.data).toEqual({ fala: FINAL });

    const entries = log.activityLog.get('deep:#9:ask');
    expect(entries).toEqual(pushed);
    const root = entries.find((e) => !e.parent)?.runId as string;
    const order = [...new Set(entries.filter((e) => e.parent).map((e) => e.runId))];
    expect(order).toHaveLength(3);
    expect(entries.every((e) => e.jobId === 'deep:#9:ask')).toBe(true);

    // the nodes come in the order the tool calls were run, each headed by its kind and task
    expect(order.map((id) => entries.find((e) => e.runId === id)?.node)).toEqual(TASKS.map((t) => ({ type: 'sub', label: `explore: map the tests of ${t}` })));
    for (const id of order) expect(entries.filter((e) => e.runId === id).every((e) => e.parent === root)).toBe(true);

    // each node holds its own reads and nothing of a sibling or of the parent
    const home2 = (file: string) => join(projects, file).replace(home, '~');
    TASKS.forEach((t, i) => {
      const own = Array.from({ length: READS[t] }, (_, n) => ['tool', null, `Read ${home2(`${t.toLowerCase()}${n + 1}.txt`)}`]);
      expect(rows(entries, order[i])).toEqual([['status', 'started', 'Agente iniciado'], ...own, ['status', 'finished', 'Terminou']]);
    });

    // the parent says it started them, in order, and holds no read of theirs
    expect(rows(entries, root)).toEqual([
      ['status', 'started', 'Agente iniciado'],
      ['text', null, 'Vou dividir o trabalho.'],
      ...TASKS.map((t) => ['tool', null, `Agent explore: map the tests of ${t}`]),
      ['status', 'finished', 'Terminou'],
    ]);

    // the sub-agents' lines reached the log interleaved (a flat merge by sequence would fail): the order is by node only after the tree is built
    const sequence = entries.filter((e) => e.runId !== root && e.kind === 'tool').sort((a, b) => a.seq - b.seq).map((e) => e.runId);
    const grouped = sequence.every((id, i) => i === 0 || id === sequence[i - 1] || !sequence.slice(0, i - 1).includes(id));
    expect(grouped).toBe(false);

    // a sub-agent's answer is a tool result of its parent, and neither it nor the stage's answer is a step
    const wire = JSON.stringify(entries);
    for (const leaked of [CHILD_ANSWER, FINAL, 'conteudo A1', 'conteudo B1']) expect(wire).not.toContain(leaked);
  });
});
