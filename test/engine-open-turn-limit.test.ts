// The loop at a turn limit (#246): it pauses where it used to throw and asks through an injected `turnLimit.ask`. "Continue" raises the limit by a round and goes on with the dialog
// untouched; "finish now" ends a stage as running out of turns does, and hands the principal a partial result for a sub-agent. With no `turnLimit` the loop throws as before.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TurnDecision, TurnLimit, TurnStop } from '../src/main/engine/contract';
import { ChatClient } from '../src/main/engine/open/client';
import { EngineError } from '../src/main/engine/open/errors';
import { type OpenRunParams, type SubAgentHandle, OpenMaxTurnsError, runOpen } from '../src/main/engine/open/loop';
import type { PoolMember } from '../src/main/engine/open/pool';
import { restRegistry } from '../src/main/engine/open/rest';
import { DEFAULT_SUB_TURNS } from '../src/main/engine/open/subagent';
import type { Activity } from '../src/shared/config/types';
import { obj, str } from '../src/main/agents';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import { type Fake, type FakeRequest, type Step, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let dir: string;
let fakes: Fake[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-turns-'));
  mkdirSync(join(dir, 'sessions'));
  restRegistry.clear();
});

afterEach(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  fakes = [];
  restRegistry.clear();
  rmSync(dir, { recursive: true, force: true });
});

async function server(script: Step[] | ((req: FakeRequest) => Step)): Promise<Fake> {
  const f = await fakeOpenAI(script);
  fakes.push(f);
  return f;
}

const client = (f: Fake, model = 'fake-model') => new ChatClient({ baseUrl: f.url, model, retryDelayMs: 0, maxRetries: 0 });
const member = (f: Fake, name: string): PoolMember => ({ key: `key-${name}`, label: `model-${name}`, model: `model-${name}`, provider: `prov-${name}`, client: client(f, `model-${name}`), images: undefined, tools: undefined, contextWindow: undefined });
const messages = (r: FakeRequest) => (r.body?.messages ?? []) as { role: string; content: unknown }[];
const toolTexts = (r: FakeRequest): string[] => messages(r).filter((m) => m.role === 'tool').map((m) => String(m.content));
const first = (r: FakeRequest): string => String(messages(r)[1]?.content);

const look = (activity: Activity = 'explore'): ToolImpl => ({ name: 'look', activity, description: 'look', parameters: { type: 'object', properties: {} }, async run() { return { response: 'seen', render: () => 'seen' }; } });
const lookStep = (id: string): Step => toolStep([{ id, name: 'look', args: {} }], { usageTokens: [10, 2] });

/** A scripted question: it records what it was asked and answers from a queue (the last answer repeats), or from a function. */
function asker(answers: TurnDecision[] | ((stop: TurnStop, nth: number) => TurnDecision | Promise<TurnDecision>)) {
  const stops: TurnStop[] = [];
  const turnLimit: TurnLimit = {
    own: true,
    ask: async (stop) => {
      stops.push(stop);
      return typeof answers === 'function' ? answers(stop, stops.length) : (answers[Math.min(stops.length, answers.length) - 1] as TurnDecision);
    },
  };
  return { stops, turnLimit };
}

describe('the agent of the call (a stage)', () => {
  const schema = obj({ fala: str });
  const finalCall = () => toolStep([{ id: 'final', name: 'final_answer', args: { fala: 'done' } }], { usageTokens: [30, 8] });
  const stage = (f: Fake, over: Partial<OpenRunParams> = {}): Promise<{ data: unknown; turns: number }> =>
    runOpen<{ fala: string }>({ role: 'deep', prompt: 'main task', schema, client: client(f), cwd: dir, allowedTools: ['look'], extraTools: [look()], docs: {}, maxTurns: 2, sessionsDir: join(dir, 'sessions'), ripgrep: 'off', ...over });

  it('asks at the limit with the numbers, goes on with the earlier steps in the dialog on continue, and asks again after the next round', async () => {
    const f = await server((req) => (req.n <= 5 ? lookStep(`c${req.n}`) : finalCall()));
    const { stops, turnLimit } = asker(['continue']);
    const r = await stage(f, { turnLimit });
    expect(r.data).toEqual({ fala: 'done' });
    expect(stops).toMatchObject([
      { of: 'stage', role: 'deep', kind: null, used: 2, round: 2, granted: 0, canContinue: true },
      { of: 'stage', used: 4, round: 2, granted: 1 },
    ]);
    expect(f.chats()).toHaveLength(6);
    // nothing was redone: every request carries the results of the steps before it
    expect(f.chats().map((c) => toolTexts(c).length)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(messages(f.chats()[2])[1].content).toBe('main task');
  });

  it('ends the way running out of turns does on finish now: OpenMaxTurnsError with the session and the sources', async () => {
    const f = await server(() => lookStep('c'));
    const { stops, turnLimit } = asker(['finish']);
    const err = await stage(f, { turnLimit }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenMaxTurnsError);
    expect((err as OpenMaxTurnsError).sources).toEqual(['look', 'look']);
    expect(stops).toHaveLength(1);
    expect(f.chats()).toHaveLength(2);
  });

  it('is stopped by the abort during the wait, not finished: the stop is the abort\'s, and the person chose nothing', async () => {
    const f = await server(() => lookStep('c'));
    const ac = new AbortController();
    const turnLimit: TurnLimit = { own: true, ask: async () => (ac.abort(), 'finish') };
    const err = await stage(f, { turnLimit, signal: ac.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).kind).toBe('aborted');
    expect(f.chats()).toHaveLength(2);
  });

  it('throws as before with no question wired, and when the question is for the sub-agents only', async () => {
    for (const turnLimit of [undefined, { own: false, ask: async (): Promise<TurnDecision> => 'continue' }]) {
      const f = await server(() => lookStep('c'));
      await expect(stage(f, { turnLimit }), String(turnLimit)).rejects.toBeInstanceOf(OpenMaxTurnsError);
      expect(f.chats()).toHaveLength(2);
    }
  });

  it('asks at the second place the loop stops too: the repair of a stage whose closing text is outside the schema', async () => {
    const f = await server(() => textStep('this is not json', { usageTokens: [10, 2] }));
    const { stops, turnLimit } = asker(['continue', 'finish']);
    const err = await stage(f, { turnLimit, maxTurns: 1, structured: 'prompt', incoming: async () => null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenMaxTurnsError);
    expect(stops.map((s) => [s.used, s.granted])).toEqual([[1, 0], [2, 1]]);
  });
});

describe('a sub-agent', () => {
  const delegating = (kind: string, prompt = 'do the task', description = 'go') => toolStep([{ id: `call_${kind}`, name: 'Agent', args: { description, prompt, kind } }], { usageTokens: [10, 2] });
  const closing = (req: FakeRequest): boolean => req.body?.tools === undefined;

  interface Setup {
    principal: Fake;
    kind?: Fake;
    kindName?: 'explore' | 'edit';
    tools?: ToolImpl[];
    over?: Partial<OpenRunParams>;
  }
  const run = (s: Setup) =>
    runOpen<string>({
      role: 'deep',
      prompt: 'main task',
      client: client(s.principal),
      pool: { name: 'deep', primary: { key: 'key-a', label: 'model-a', provider: 'prov-a' }, fallbacks: [], activities: s.kind ? { [s.kindName ?? 'explore']: [member(s.kind, 'k')] } : undefined, mode: 'delegate' },
      cwd: dir,
      allowedTools: ['Agent', 'look', 'Ed'],
      extraTools: s.tools ?? [look(), { ...look('edit'), name: 'Ed' }],
      writeRoot: dir,
      docs: {},
      maxTurns: 8,
      sessionsDir: join(dir, 'sessions'),
      ripgrep: 'off',
      ...s.over,
    });
  const principalSaw = (a: Fake): string[] => toolTexts(a.chats()[1]);

  /** What the caller of the engine hears of each sub-agent: its node. */
  function nodes() {
    const notes: string[] = [];
    const onSubAgent = (s: { kind: string | null; prompt: string }): SubAgentHandle => {
      const tag = `${s.kind ?? 'plain'}:${s.prompt}`;
      return {
        events: {},
        within: (fn) => fn(),
        state: (state) => notes.push(`${tag} ${state}`),
        waiting: (used) => notes.push(`${tag} waiting ${used}`),
        continued: () => notes.push(`${tag} continued`),
        end: (failure) => notes.push(failure === undefined ? `${tag} end` : `${tag} failed ${failure}`),
      };
    };
    return { notes, onSubAgent };
  }

  it('asks at its own limit with its kind and task, and continue goes on in the same dialog for one more round of the same size', async () => {
    const a = await server([delegating('explore', 'map the tests', 'map tests'), textStep('principal done', { usageTokens: [10, 2] })]);
    const k = await server((req) => (req.n <= 4 ? lookStep(`c${req.n}`) : textStep('mapped all', { usageTokens: [10, 2] })));
    const { stops, turnLimit } = asker(['continue']);
    const { notes, onSubAgent } = nodes();
    const r = await run({ principal: a, kind: k, over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 3 }), events: { onSubAgent } } });
    expect(r.data).toBe('principal done');
    expect(stops).toEqual([{ of: 'sub', role: 'deep:explore', kind: 'explore', name: null, task: 'map tests', used: 3, round: 3, granted: 0, canContinue: true }]);
    expect(k.chats()).toHaveLength(5);
    expect(k.chats().map((c) => toolTexts(c).length)).toEqual([0, 1, 2, 3, 4]);
    expect(principalSaw(a)).toEqual(['mapped all']);
    expect(notes).toEqual(['explore:map the tests started', 'explore:map the tests waiting 3', 'explore:map the tests continued', 'explore:map the tests end']);
  });

  it('asks again after the round it granted is spent too, with the rounds granted so far', async () => {
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const k = await server((req) => (req.n <= 5 ? lookStep(`c${req.n}`) : textStep('done after two rounds', { usageTokens: [10, 2] })));
    const { stops, turnLimit } = asker(['continue']);
    await run({ principal: a, kind: k, over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 2 }) } });
    expect(stops.map((s) => [s.used, s.round, s.granted])).toEqual([[2, 2, 0], [4, 2, 1]]);
    expect(principalSaw(a)).toEqual(['done after two rounds']);
  });

  it('does not ask when the number is large enough for the same task', async () => {
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const k = await server((req) => (req.n <= 4 ? lookStep(`c${req.n}`) : textStep('finished by itself', { usageTokens: [10, 2] })));
    const { stops, turnLimit } = asker(['continue']);
    await run({ principal: a, kind: k, over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 20 }) } });
    expect(stops).toEqual([]);
    expect(principalSaw(a)).toEqual(['finished by itself']);
  });

  it('hands the principal a partial result on finish now: one closing call with no tool, a note first, an answer and not a tool error, and the node finished', async () => {
    const a = await server([delegating('explore'), textStep('principal went on', { usageTokens: [10, 2] })]);
    const k = await server((req) => (closing(req) ? textStep('Found A and B. Did not reach C.', { usageTokens: [10, 2] }) : lookStep(`c${req.n}`)));
    const { turnLimit } = asker(['finish']);
    const { notes, onSubAgent } = nodes();
    const r = await run({ principal: a, kind: k, over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 3 }), events: { onSubAgent } } });
    expect(r.data).toBe('principal went on');
    // three turns with tools, then the closing call
    expect(k.chats()).toHaveLength(4);
    expect(k.chats()[3].body?.tools).toBeUndefined();
    expect(messages(k.chats()[3]).at(-1)?.content).toMatch(/finished this task early|encerrou esta tarefa/);
    const [back] = principalSaw(a);
    expect(back).toMatch(/^\[partial result: the person finished this sub-agent of kind explore at its limit of 3 turns|^\[resultado parcial: a pessoa encerrou este subagente do tipo explore/);
    expect(back).toContain('Found A and B. Did not reach C.');
    expect(back).not.toMatch(/stopped after|parou após/);
    expect(notes.at(-1)).toBe('explore:do the task end');
    expect(notes.some((n) => n.includes('failed'))).toBe(false);
    // the principal's request carried it as a tool result that is not an error
    expect(messages(a.chats()[1]).filter((m) => m.role === 'tool')).toHaveLength(1);
  });

  it('falls back to the last thing the sub-agent said, and then to a line naming what it read, when the closing call gives nothing', async () => {
    for (const [said, expected] of [['I was checking the parser', 'I was checking the parser'], ['', 'look']] as const) {
      const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
      const k = await server((req) => (closing(req) ? errorStep(500, 'the server broke') : toolStep([{ id: `c${req.n}`, name: 'look', args: {} }], { ...(said ? { text: said } : {}), usageTokens: [10, 2] })));
      await run({ principal: a, kind: k, over: { turnLimit: asker(['finish']).turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 2 }) } });
      const [back] = principalSaw(a);
      expect(back, said).toContain(expected);
      if (!said) expect(back).toMatch(/nothing to report|nada a relatar/);
      restRegistry.clear();
    }
  });

  it('lets a refusal by budget or by key, or an abort, of the closing call end the work like any other call', async () => {
    for (const [status, kind] of [[402, 'budget'], [401, 'auth']] as const) {
      const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
      const k = await server((req) => (closing(req) ? errorStep(status, 'no credits left') : lookStep(`c${req.n}`)));
      await expect(run({ principal: a, kind: k, over: { turnLimit: asker(['finish']).turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 2 }) } }), kind).rejects.toMatchObject({ kind });
      restRegistry.clear();
    }
  });

  it('uses the number of a plain sub-agent for one with no kind, and asks for it too', async () => {
    const a = await server((req) => {
      if (first(req) === 'sub task') return closing(req) ? textStep('plain partial', { usageTokens: [10, 2] }) : lookStep(`s${req.n}`);
      return messages(req).at(-1)?.role === 'tool' ? textStep('principal done', { usageTokens: [10, 2] }) : toolStep([{ id: 'plain', name: 'Agent', args: { description: 'go', prompt: 'sub task' } }], { usageTokens: [10, 2] });
    });
    const { stops, turnLimit } = asker(['finish']);
    const r = await run({ principal: a, over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, plain: 2 }) } });
    expect(r.data).toBe('principal done');
    expect(stops).toMatchObject([{ of: 'sub', kind: null, used: 2, round: 2 }]);
    const sawBack = messages(a.chats().at(-1) as FakeRequest).filter((m) => m.role === 'tool').map((m) => String(m.content));
    expect(sawBack[0]).toMatch(/^\[partial result: the person finished this sub-agent at its limit of 2 turns|^\[resultado parcial: a pessoa encerrou este subagente no limite de 2 voltas/);
    expect(sawBack[0]).toContain('plain partial');
  });

  it('keeps the round it started with when the setting changes while it waits', async () => {
    const live = { ...DEFAULT_SUB_TURNS, explore: 3 };
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const k = await server((req) => (req.n <= 6 ? lookStep(`c${req.n}`) : textStep('done', { usageTokens: [10, 2] })));
    const { stops, turnLimit } = asker((_stop, nth) => {
      live.explore = 50;
      return nth === 1 ? 'continue' : 'finish';
    });
    await run({ principal: a, kind: k, over: { turnLimit, subTurns: () => live } });
    expect(stops.map((s) => [s.used, s.round, s.granted])).toEqual([[3, 3, 0], [6, 3, 1]]);
  });

  it('leaves a question for each of three parallel sub-agents, answered in any order, while the others keep running', async () => {
    const calls = (['p1', 'p2', 'p3'] as const).map((prompt, i) => ({ id: `call_${i}`, name: 'Agent', args: { description: prompt, prompt, kind: 'explore' } }));
    const a = await server([toolStep(calls, { usageTokens: [10, 2] }), textStep('principal done', { usageTokens: [10, 2] })]);
    const seen: Record<string, number> = { p1: 0, p2: 0, p3: 0 };
    // p2 needs two turns and never reaches its limit of three; p1 and p3 never stop looking
    const k = await server((req) => {
      const who = first(req) as 'p1' | 'p2' | 'p3';
      seen[who]++;
      if (who === 'p2') return seen.p2 === 1 ? lookStep('x') : textStep('p2 done', { usageTokens: [10, 2] });
      return closing(req) ? textStep(`${who} partial`, { usageTokens: [10, 2] }) : lookStep(`${who}${seen[who]}`);
    });
    const open = new Map<string, (d: TurnDecision) => void>();
    const stops: TurnStop[] = [];
    const turnLimit: TurnLimit = { own: true, ask: (stop) => new Promise((resolve) => { stops.push(stop); open.set(stop.task, resolve); }) };
    const running = run({ principal: a, kind: k, over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 3 }) } });
    await waitFor(() => stops.length === 2);
    // p2 finished while the other two wait; the principal has not gone on
    expect(seen.p2).toBe(2);
    expect(a.chats()).toHaveLength(1);
    expect(stops.map((s) => s.task).sort()).toEqual(['p1', 'p3']);
    open.get('p3')?.('finish');
    await waitFor(() => seen.p3 === 4);
    expect(a.chats()).toHaveLength(1);
    open.get('p1')?.('continue');
    await waitFor(() => stops.length === 3);
    expect(stops[2]).toMatchObject({ task: 'p1', used: 6, granted: 1 });
    open.get('p1')?.('finish');
    expect((await running).data).toBe('principal done');
    const back = principalSaw(a);
    expect(back).toHaveLength(3);
    expect(back[0]).toContain('p1 partial');
    expect(back[1]).toBe('p2 done');
    expect(back[2]).toContain('p3 partial');
  });

  it('asks one at a time for the kinds that change things: the second edit does not start before the first is answered', async () => {
    const calls = (['e1', 'e2'] as const).map((prompt, i) => ({ id: `call_${i}`, name: 'Agent', args: { description: prompt, prompt, kind: 'edit' } }));
    const a = await server([toolStep(calls, { usageTokens: [10, 2] }), textStep('principal done', { usageTokens: [10, 2] })]);
    const started: string[] = [];
    const k = await server((req) => {
      const who = first(req);
      if (req.n > 0 && !started.includes(who)) started.push(who);
      return closing(req) ? textStep(`${who} partial`, { usageTokens: [10, 2] }) : toolStep([{ id: `c${req.n}`, name: 'Ed', args: {} }], { usageTokens: [10, 2] });
    });
    const open: ((d: TurnDecision) => void)[] = [];
    const stops: TurnStop[] = [];
    const turnLimit: TurnLimit = { own: true, ask: (stop) => new Promise((resolve) => { stops.push(stop); open.push(resolve); }) };
    const running = run({ principal: a, kind: k, kindName: 'edit', over: { turnLimit, subTurns: () => ({ ...DEFAULT_SUB_TURNS, edit: 2 }) } });
    await waitFor(() => stops.length === 1);
    expect(started).toEqual(['e1']);
    open[0]('finish');
    await waitFor(() => stops.length === 2);
    expect(started).toEqual(['e1', 'e2']);
    open[1]('finish');
    await running;
    expect(principalSaw(a)).toHaveLength(2);
  });

  it('throws nothing new with no question wired: the sub-agent still ends as the tool error the principal reads, with the configured number', async () => {
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const k = await server(() => lookStep('c'));
    await run({ principal: a, kind: k, over: { subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 2 }) } });
    expect(k.chats()).toHaveLength(2);
    expect(principalSaw(a)[0]).toMatch(/sub-agent of kind explore|subagente do tipo explore/);
    expect(principalSaw(a)[0]).toContain('2');
  });
});

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
}
