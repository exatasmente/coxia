import { beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown>;
const calls: { prompt: string; options: Record<string, unknown> }[] = [];
let scripts: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    calls.push({ prompt, options });
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) yield m;
    })();
  },
}));

import { askAgent, conflictAsk, conflictPropose, obj, str } from '../src/main/agents';
import { classify } from '../src/main/custo-core';

const init = (id: string) => ({ type: 'system', subtype: 'init', session_id: id });
const toolUse = (command: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const result = (subtype: string, id: string, structured?: unknown) => ({
  type: 'result',
  subtype,
  session_id: id,
  ...(structured === undefined ? {} : { structured_output: structured }),
});

const schema = obj({ fala: str });
const ask = (extra = {}) => askAgent<{ fala: string }>('deep', 'Pergunta original', schema, { maxTurns: 3, ...extra });

beforeEach(() => {
  calls.length = 0;
  scripts = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('an agent that runs out of turns', () => {
  it('is resumed once, without tools, and answers partially', async () => {
    scripts = [
      [init('s1'), toolUse('glab api projects/a%2Fb/issues/1/notes'), result('error_max_turns', 's1')],
      [init('s1'), result('success', 's1', { fala: 'o que deu para ver' })],
    ];
    const r = await ask({ additionalDirectories: ['/tmp/wt'] });
    expect(r.data).toEqual({ fala: 'o que deu para ver' });
    expect(r.partial).toBe(true);
    expect(r.sessionId).toBe('s1');
    expect(r.sources).toEqual(['Bash glab api projects/a%2Fb/issues/1/notes']);
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(first.prompt).toBe('Pergunta original');
    expect(first.options.maxTurns).toBe(3);
    expect(first.options.resume).toBeUndefined();
    expect(second.prompt).toMatch(/Responda agora, no formato JSON/);
    expect(second.options).toMatchObject({ resume: 's1', maxTurns: 2, tools: [], allowedTools: [], additionalDirectories: ['/tmp/wt'] });
    expect(second.options.outputFormat).toEqual(first.options.outputFormat);
    expect(second.options.hooks).toBeDefined();
  });

  it('resumes the session it was already resuming, not a new one', async () => {
    scripts = [
      [init('s9'), result('error_max_turns', 's9')],
      [init('s9'), result('success', 's9', { fala: 'ok' })],
    ];
    const r = await ask({ resume: 's9' });
    expect(r.partial).toBe(true);
    expect(calls[1].options.resume).toBe('s9');
  });

  it('does not mark a normal answer as partial and makes one call', async () => {
    scripts = [[init('s1'), result('success', 's1', { fala: 'tudo certo' })]];
    const r = await ask();
    expect(r.partial).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('throws a clear message when the resume fails too, and never loops', async () => {
    scripts = [
      [init('s1'), result('error_max_turns', 's1')],
      [init('s1'), result('error_max_turns', 's1')],
      [init('s1'), result('success', 's1', { fala: 'never reached' })],
    ];
    await expect(ask()).rejects.toThrow(/limite de passos.*resposta parcial também falhou/);
    expect(calls).toHaveLength(2);
  });

  it('throws when the resume answers without structured output', async () => {
    scripts = [
      [init('s1'), result('error_max_turns', 's1')],
      [init('s1'), result('success', 's1')],
    ];
    await expect(ask()).rejects.toThrow(/resposta parcial também falhou/);
    expect(calls).toHaveLength(2);
  });

  it('throws without resuming when there is no session to resume', async () => {
    scripts = [[result('error_max_turns', '')]];
    await expect(ask()).rejects.toThrow(/nem deixou sessão para retomar/);
    expect(calls).toHaveLength(1);
  });

  it('does not resume on other errors', async () => {
    scripts = [[init('s1'), result('error_during_execution', 's1')]];
    await expect(ask()).rejects.toThrow('agent ended with error_during_execution');
    expect(calls).toHaveLength(1);
  });
});

describe('callers that return text or proposals to the screens', () => {
  it('conflictAsk carries the partial flag', async () => {
    scripts = [
      [init('c1'), result('error_max_turns', 'c1')],
      [init('c1'), result('success', 'c1', { fala: 'fala', texto: 'texto' })],
    ];
    const a = await conflictAsk('contexto', 'e agora?', null);
    expect(a).toMatchObject({ sessionId: 'c1', speech: 'fala', text: 'texto', partial: true });
    expect(calls[0].options.maxTurns).toBe(40);
  });

  it('conflictAsk leaves the flag out on a complete answer', async () => {
    scripts = [[init('c1'), result('success', 'c1', { fala: 'fala', texto: 'texto' })]];
    expect('partial' in (await conflictAsk('contexto', 'e agora?', null))).toBe(false);
  });

  it('conflictPropose lists the hunks that came from a partial batch', async () => {
    const item = { id: 'h1', resolucao: 'x', explicacao: 'y', confianca: 'baixa', testar: 'z' };
    scripts = [
      [init('p1'), result('error_max_turns', 'p1')],
      [init('p1'), result('success', 'p1', { resumo: 'combinei', trechos: [item] })],
    ];
    const p = await conflictPropose({ issue: 1, title: 't', mr: 'm', branch: 'b', worktree: '/tmp/wt', hunks: [{ id: 'h1', file: 'a.ts', ours: 'a', base: null, theirs: 'b' }] });
    expect(p.partialIds).toEqual(['h1']);
    expect(p.items.map((i) => i.id)).toEqual(['h1']);
    expect(p.failed).toEqual([]);
  });
});

describe('cost panel', () => {
  it('classifies conflict proposal batches, so their resumed calls are counted too', () => {
    expect(classify('Conflito de sincronização com a main depois de uma release: issue sz4#1')).toBe('release');
  });
});
