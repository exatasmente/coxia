import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient } from '../src/main/engine/open/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type OpenRunParams, type SubAgentHandle, type SubAgentStart, runOpen } from '../src/main/engine/open/loop';
import type { PoolMember, PoolSwitch } from '../src/main/engine/open/pool';
import { restRegistry } from '../src/main/engine/open/rest';
import { readSession, type UsageRecord } from '../src/main/engine/open/session';
import { DEFAULT_SUB_TURNS, KIND_ACTIVITIES, KIND_TURNS, SUB_KINDS, modelOfKind, offeredKinds, subTurnsOf, toolsOfKind, type SubKind } from '../src/main/engine/open/subagent';
import { type ScreenToolset, screenToolImpls } from '../src/main/browser/engineTool';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import { HANDOFF_HELD_TEXT } from '../src/shared/handoff';
import type { Activity, PoolMode } from '../src/shared/config/types';
import { type Fake, type FakeRequest, type Step, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

// `delegate` mode: the main model stays put and hands edit, command and screen work to sub-agents of a kind, each on the list of its activity. What a sub-agent may do
// is a subset of what its parent may do, by construction: the kind only filters the parent's tools.

let dir: string;
let fakes: Fake[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-sub-'));
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

const client = (f: Fake, model: string) => new ChatClient({ baseUrl: f.url, model, retryDelayMs: 0, maxRetries: 0 });
const member = (f: Fake, name: string, extra: Partial<PoolMember> = {}): PoolMember => ({ key: `key-${name}`, label: `model-${name}`, model: `model-${name}`, provider: `prov-${name}`, client: client(f, `model-${name}`), ...extra });
const BUSY = { ...errorStep(429, 'Rate limit reached'), headers: { 'retry-after': '120' } } as Step;

const log: string[] = [];
const tool = (name: string, activity: Activity | undefined, wait = 0): ToolImpl => ({
  name,
  ...(activity ? { activity } : {}),
  description: name,
  parameters: { type: 'object', properties: {} },
  async run() {
    log.push(`start ${name}`);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    log.push(`end ${name}`);
    return { response: 'ok', render: () => `${name} done` };
  },
});

const usageOf = (r: FakeRequest) => (r.body?.messages ?? []) as { role: string; content: unknown }[];
const names = (r: FakeRequest): string[] => ((r.body?.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name).sort();
const agentTool = (r: FakeRequest) => ((r.body?.tools ?? []) as { function: { name: string; description: string; parameters: any } }[]).find((t) => t.function.name === 'Agent')?.function;
const delegating = (kind: SubKind, prompt = 'do the task') => toolStep([{ id: `call_${kind}`, name: 'Agent', args: { description: 'go', prompt, kind } }], { usageTokens: [10, 2] });

interface Setup {
  primary: PoolMember;
  fallbacks?: PoolMember[];
  activities?: Partial<Record<Activity, PoolMember[]>>;
  tools?: ToolImpl[];
  mode?: PoolMode;
  write?: boolean;
  over?: Partial<OpenRunParams>;
}

function run(s: Setup, events: PoolSwitch[] = [], usage: (UsageRecord & { model: string })[] = []) {
  const p: OpenRunParams = {
    role: 'deep',
    prompt: 'main task',
    client: s.primary.client,
    pool: { name: 'deep', primary: { key: s.primary.key, label: s.primary.label, provider: s.primary.provider }, fallbacks: s.fallbacks ?? [], activities: s.activities, mode: s.mode ?? 'delegate' },
    cwd: dir,
    allowedTools: ['Agent', ...(s.tools ?? []).map((t) => t.name)],
    extraTools: s.tools,
    ...(s.write ? { writeRoot: dir } : {}),
    docs: {},
    maxTurns: 8,
    sessionsDir: join(dir, 'sessions'),
    ripgrep: 'off',
    events: { onSwitch: (e) => events.push(e), onUsage: (u) => usage.push(u) },
    ...s.over,
  };
  return runOpen<string>(p);
}

describe('a sub-agent of a kind', () => {
  const tools = () => [tool('Sh', 'shell'), tool('Ed', 'edit'), tool('Snap', 'screen'), tool('look', 'explore'), tool('Ext', undefined)];

  it('runs on the list of its activity with the tools of its kind and the reading ones, and the principal gets only its final answer', async () => {
    const a = await server([delegating('shell'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server((req) => (req.body?.messages.at(-1).role === 'tool' ? textStep('ran it: all green', { usageTokens: [10, 2] }) : toolStep([{ id: 'c1', name: 'Sh', args: {} }], { usageTokens: [10, 2] })));
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: tools(), write: true }, events);
    expect(r.data).toBe('principal done');
    // The principal's own model answered both of its turns; the work in between went to b.
    expect(a.chats()).toHaveLength(2);
    expect(b.chats()).toHaveLength(2);
    expect(b.chats()[0].body?.model).toBe('model-b');
    // Only the shell tool and the reading ones: no edit, no screen, no tool without a kind, and no Agent (it does not nest).
    expect(names(b.chats()[0])).toEqual(['Sh', 'look']);
    // It starts with an empty history: its own system prompt and the task the principal wrote, nothing of the conversation.
    const sent = usageOf(b.chats()[0]);
    expect(sent.map((m) => m.role)).toEqual(['system', 'user']);
    expect(sent[1].content).toBe('do the task');
    expect(String(sent[0].content)).toContain('sub-agent of kind shell');
    expect(JSON.stringify(sent)).not.toContain('main task');
    // The principal reads the final answer and nothing of the steps.
    const back = usageOf(a.chats()[1]).filter((m) => m.role === 'tool');
    expect(back).toHaveLength(1);
    expect(back[0].content).toBe('ran it: all green');
    // The principal's model did not move; the thread is told once that the work went to another model.
    expect(events).toMatchObject([{ from: { label: 'model-a', provider: 'prov-a' }, to: { label: 'model-b', provider: 'prov-b' }, reason: 'delegate', until: null, activity: 'shell' }]);
  });

  it('is a subset of its parent\'s tools whatever the kind: the parent offers what it has, the sub-agent a filter of it', async () => {
    const all = tools();
    for (const kind of SUB_KINDS) {
      const got = toolsOfKind(kind, [...all, tool('Agent', 'explore')]);
      expect(got.every((x) => all.includes(x)), kind).toBe(true);
      expect(got.map((x) => x.name)).not.toContain('Agent');
      expect(got.every((x) => x.activity !== undefined && KIND_ACTIVITIES[kind].includes(x.activity))).toBe(true);
    }
    expect(toolsOfKind('explore', all).map((x) => x.name)).toEqual(['look']);
    expect(toolsOfKind('edit', all).map((x) => x.name)).toEqual(['Ed', 'look']);
    expect(toolsOfKind('screen', all).map((x) => x.name)).toEqual(['Snap', 'look']);
  });

  it('offers a kind only when the activity has a list and the parent has a tool of it, and never edit or shell to a reader', async () => {
    const t = tools();
    const lists = { edit: [1], shell: [1], screen: [1] };
    expect(offeredKinds({ lists, tools: t, writes: true })).toEqual(['explore', 'edit', 'shell', 'screen']);
    // A reader: no edit and no shell, even with a shell tool of a sandbox and lists for both.
    expect(offeredKinds({ lists, tools: t, writes: false })).toEqual(['explore', 'screen']);
    // A kind without a list, or without a tool of its kind, is not offered.
    expect(offeredKinds({ lists: { shell: [1] }, tools: t, writes: true })).toEqual(['explore', 'shell']);
    expect(offeredKinds({ lists, tools: [tool('look', 'explore')], writes: true })).toEqual(['explore']);
    expect(offeredKinds({ lists: undefined, tools: t, writes: true })).toEqual(['explore']);
    expect(offeredKinds({ lists: { shell: [] }, tools: t, writes: true })).toEqual(['explore']);
  });

  it('gives the model a tool whose kinds are the ones on offer, required, and tells it to delegate by kind', async () => {
    const a = await server([textStep('done', { usageTokens: [10, 2] })]);
    const b = await server([]);
    await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')], edit: [member(b, 'b')] }, tools: [tool('Sh', 'shell'), tool('look', 'explore')], write: true });
    const def = agentTool(a.chats()[0])!;
    // edit has a list but the parent has no edit tool: not offered.
    expect(def.parameters.properties.kind.enum).toEqual(['explore', 'shell']);
    expect(def.parameters.required).toEqual(['prompt', 'kind']);
    expect(def.description).toContain('complete task');
    const system = String(usageOf(a.chats()[0])[0].content);
    expect(system).toContain('Sub-agents:');
    expect(system).toContain('shell: run commands');
    expect(system).not.toContain('edit: change files');
  });

  it('leaves the tool and the prompt as they are in fallback and switch, and in delegate without a list for an activity', async () => {
    for (const [mode, activities] of [['fallback', 'shell'], ['switch', 'shell'], ['delegate', 'none']] as const) {
      restRegistry.clear();
      const a = await server([textStep('done', { usageTokens: [10, 2] })]);
      const b = await server([]);
      await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], activities: activities === 'shell' ? { shell: [member(b, 'b')] } : undefined, mode, tools: [tool('Sh', 'shell')], write: true });
      const def = agentTool(a.chats()[0])!;
      expect(def.parameters.properties.kind, mode).toBeUndefined();
      expect(def.parameters.required).toEqual(['prompt']);
      expect(def.description).toContain('read-only');
      expect(String(usageOf(a.chats()[0])[0].content)).not.toContain('Sub-agents:');
    }
  });

  it('refuses a kind that is not on offer, naming the ones that are, and the principal goes on', async () => {
    const a = await server([delegating('edit'), textStep('did it myself', { usageTokens: [10, 2] })]);
    const b = await server([]);
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('Sh', 'shell')], write: true });
    expect(r.data).toBe('did it myself');
    expect(b.chats()).toHaveLength(0);
    const answer = usageOf(a.chats()[1]).find((m) => m.role === 'tool')!.content as string;
    expect(answer).toMatch(/kind/);
    expect(answer).toMatch(/explore.*shell/);
  });

  it('an explore sub-agent with no list of its own works on the principal\'s model', async () => {
    const a = await server((req) => {
      const last = req.body?.messages.at(-1);
      if (req.n === 1) return delegating('explore', 'search it');
      return last.role === 'tool' && String(last.content).includes('found') ? textStep('principal done', { usageTokens: [10, 2] }) : textStep('found it', { usageTokens: [10, 2] });
    });
    const b = await server([]);
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('Sh', 'shell'), tool('look', 'explore')], write: true });
    expect(r.data).toBe('principal done');
    expect(a.chats()).toHaveLength(3);
    expect(b.chats()).toHaveLength(0);
  });

  it('a busy model of the list hands the sub-agent to the next of that list, and says so; the principal\'s model does not change', async () => {
    const a = await server([delegating('shell'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b1 = await server([BUSY]);
    const b2 = await server([textStep('sub done', { usageTokens: [10, 2] })]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b1, 'b1'), member(b2, 'b2')] }, tools: [tool('Sh', 'shell')], write: true }, events);
    expect(r.data).toBe('principal done');
    expect(events.map((e) => [e.from.label, e.to.label, e.reason])).toEqual([['model-a', 'model-b1', 'delegate'], ['model-b1', 'model-b2', 'rate_limit']]);
    expect(b2.chats()).toHaveLength(1);
  });

  it('says it once for a kind and a model, and not at all when the sub-agent runs on the model the principal is on', async () => {
    const twice = toolStep([{ id: 'c1', name: 'Agent', args: { description: 'go', prompt: 'one', kind: 'shell' } }, { id: 'c2', name: 'Agent', args: { description: 'go', prompt: 'two', kind: 'shell' } }], { usageTokens: [10, 2] });
    const a = await server([twice, textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server(() => textStep('sub done', { usageTokens: [10, 2] }));
    const events: PoolSwitch[] = [];
    await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('Sh', 'shell')], write: true }, events);
    expect(events.filter((e) => e.reason === 'delegate')).toHaveLength(1);
    // The same model (the list holds the principal's own): nothing to say.
    const c = await server([delegating('shell'), textStep('sub done', { usageTokens: [10, 2] }), textStep('principal done', { usageTokens: [10, 2] })]);
    const same: PoolSwitch[] = [];
    await run({ primary: member(c, 'c'), activities: { shell: [member(c, 'c')] }, tools: [tool('Sh', 'shell')], write: true }, same);
    expect(same).toEqual([]);
  });

  it('skips a model of the list that is resting when it starts', async () => {
    const a = await server([delegating('shell'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b1 = await server([]);
    const b2 = await server([textStep('sub done', { usageTokens: [10, 2] })]);
    restRegistry.rest('key-b1', 60_000);
    await run({ primary: member(a, 'a'), activities: { shell: [member(b1, 'b1'), member(b2, 'b2')] }, tools: [tool('Sh', 'shell')], write: true });
    expect(b1.chats()).toHaveLength(0);
    expect(b2.chats()).toHaveLength(1);
  });

  it('runs out of turns as an error the principal reads, not a failure of the stage, and what it did stays', async () => {
    const a = await server([delegating('explore'), textStep('split it then', { usageTokens: [10, 2] })]);
    const forever = await server(() => toolStep([{ id: 'c', name: 'look', args: {} }], { usageTokens: [10, 2] }));
    const r = await run({ primary: member(a, 'a'), activities: { explore: [member(forever, 'f')] }, tools: [tool('look', 'explore')], write: true });
    expect(r.data).toBe('split it then');
    expect(forever.chats()).toHaveLength(KIND_TURNS.explore);
    const answer = usageOf(a.chats()[1]).find((m) => m.role === 'tool')!.content as string;
    expect(answer).toMatch(/sub-agent of kind explore|subagente do tipo explore/);
    expect(answer).toContain(String(KIND_TURNS.explore));
  });

  it('a refusal by budget or by key of the sub-agent\'s model ends the call like the principal\'s own: it is not a tool error the principal reads', async () => {
    for (const [status, kind] of [[402, 'budget'], [401, 'auth']] as const) {
      restRegistry.clear();
      const a = await server([delegating('shell'), textStep('principal went on', { usageTokens: [10, 2] })]);
      const b = await server([errorStep(status, 'no credits left')]);
      await expect(run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('Sh', 'shell')], write: true }), kind).rejects.toMatchObject({ kind });
      // the principal never heard of it: it was not asked again
      expect(a.chats(), kind).toHaveLength(1);
    }
  });

  it('does not build the MCP tools for a sub-agent of a kind: its tools never include one, so the servers are not asked about a second time', async () => {
    // A server that cannot start says so once per build of the tools: one for the principal, none for the sub-agent.
    const config = join(dir, '.mcp.json');
    writeFileSync(config, JSON.stringify({ mcpServers: { fake: { command: join(dir, 'no-such-server'), args: [] } } }));
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server([textStep('sub done', { usageTokens: [10, 2] })]);
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await run({ primary: member(a, 'a'), activities: { explore: [member(b, 'b')] }, tools: [tool('look', 'explore')], over: { allowedTools: ['Agent', 'look', 'mcp__fake__echo'], docs: { mcpConfigs: [config] } } });
      expect(said.mock.calls.filter((c) => c[0] === '[open-engine] mcp')).toHaveLength(1);
    } finally {
      said.mockRestore();
    }
    expect(names(b.chats()[0])).toEqual(['look']);
  });

  it('runs edit and shell sub-agents one at a time and explore ones together', async () => {
    const both = (kinds: SubKind[]) => toolStep(kinds.map((k) => ({ id: `call_${k}_${Math.random()}`, name: 'Agent', args: { description: 'go', prompt: `task ${k}`, kind: k } })), { usageTokens: [10, 2] });
    const sub = (name: string) => (req: FakeRequest): Step => (req.body?.messages.at(-1).role === 'tool' ? textStep('sub done', { usageTokens: [10, 2] }) : toolStep([{ id: 'c', name, args: {} }], { usageTokens: [10, 2] }));
    for (const [kinds, ordered] of [[['edit', 'shell'], true], [['explore', 'explore'], false]] as const) {
      log.length = 0;
      restRegistry.clear();
      const a = await server([both([...kinds]), textStep('principal done', { usageTokens: [10, 2] })]);
      const eb = await server(sub('Ed'));
      const sb = await server(sub('Sh'));
      const xb = await server(sub('look'));
      await run({
        primary: member(a, 'a'),
        activities: { edit: [member(eb, 'e')], shell: [member(sb, 's')], explore: [member(xb, 'x')] },
        tools: [tool('Ed', 'edit', 40), tool('Sh', 'shell', 40), tool('look', 'explore', 40)],
        write: true,
      });
      if (ordered) expect(log).toEqual(['start Ed', 'end Ed', 'start Sh', 'end Sh']);
      else expect(log).toEqual(['start look', 'start look', 'end look', 'end look']);
    }
  });

  it('adds the sub-agent\'s use to the stage\'s, once, and writes a line for it in the principal\'s session', async () => {
    const a = await server([delegating('shell'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server((req) => (req.body?.messages.at(-1).role === 'tool' ? textStep('sub done', { usageTokens: [7, 3] }) : toolStep([{ id: 'c', name: 'Sh', args: {} }], { usageTokens: [7, 3] })));
    const used: (UsageRecord & { model: string })[] = [];
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('Sh', 'shell')], write: true }, [], used);
    expect(used.map((u) => [u.model, u.promptTokens, u.completionTokens])).toEqual([['model-a', 10, 2], ['model-b', 7, 3], ['model-b', 7, 3], ['model-a', 10, 2]]);
    const lines = readSession(join(dir, 'sessions'), r.sessionId)!;
    expect(lines.filter((l) => l.t === 'sub')).toMatchObject([{ kind: 'shell', model: 'model-b', turns: 2, promptTokens: 14, completionTokens: 6 }]);
    // The line is no message: the history of a resumed session has none of it.
    expect(lines.filter((l) => l.t === 'msg' && l.message.role === 'assistant')).toHaveLength(2);
  });

  it('does not take the messages the stage\'s door holds: they are the principal\'s', async () => {
    const a = await server([delegating('shell'), textStep('principal done', { usageTokens: [10, 2] }), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server((req) => (req.body?.messages.at(-1).role === 'tool' ? textStep('sub done', { usageTokens: [10, 2] }) : toolStep([{ id: 'c', name: 'Sh', args: {} }], { usageTokens: [10, 2] })));
    let asked = 0;
    await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('Sh', 'shell')], write: true, over: { incoming: async () => (asked++ === 0 ? 'a word from the person' : null) } });
    expect(JSON.stringify(b.chats().map((c) => c.body?.messages))).not.toContain('a word from the person');
    expect(JSON.stringify(a.chats().map((c) => c.body?.messages))).toContain('a word from the person');
  });

  it('a screen sub-agent drives the stage\'s own screen: the same browser, the same hand-off, and a hold counts as if the principal had asked', async () => {
    const calls: { tool: string; held: boolean }[] = [];
    let holding = false;
    let handoffs = 0;
    const set: ScreenToolset = {
      browser: {
        tools: () => [{ name: 'browser_click', kind: 'act', description: 'click', properties: {}, required: [] }],
        call: async (tool, _args, options) => {
          calls.push({ tool, held: options?.held?.() ?? false });
          return { text: 'clicked', images: [], isError: false } as never;
        },
      },
      confirm: (async () => ({ answer: 'yes' })) as never,
      handoff: { request: async () => { handoffs++; holding = true; return 'done'; }, active: () => holding } as never,
    };
    const a = await server([delegating('screen'), textStep('principal done', { usageTokens: [10, 2] })]);
    const steps = [
      toolStep([{ id: 'c1', name: 'browser_click', args: {} }], { usageTokens: [10, 2] }),
      toolStep([{ id: 'c2', name: 'screen_handoff', args: { what: 'log in' } }], { usageTokens: [10, 2] }),
      // The person has the screen now: the confirmation is refused, exactly as it is for the principal.
      toolStep([{ id: 'c3', name: 'screen_confirm', args: { kind: 'send', words: 'send it' } }], { usageTokens: [10, 2] }),
      textStep('sub done', { usageTokens: [10, 2] }),
    ];
    const b = await server((req) => steps[req.n - 1]);
    await run({ primary: member(a, 'a'), activities: { screen: [member(b, 'b', { images: true })] }, tools: screenToolImpls(set) });
    expect(names(b.chats()[0])).toEqual(['browser_click', 'screen_confirm', 'screen_handoff']);
    expect(calls).toEqual([{ tool: 'browser_click', held: false }]);
    expect(handoffs).toBe(1);
    const refused = usageOf(b.chats()[3]).filter((m) => m.role === 'tool').at(-1)!.content as string;
    expect(refused).toContain(HANDOFF_HELD_TEXT);
  });
});

// What a sub-agent may write is exactly what the run may: it inherits the principal's fence (`writeRoot`, the reserved names, the lift of the fence of an unconfined
// run) and nothing else, whichever kind it is.
describe('the fence of the run, under a sub-agent', () => {
  let outside: string;
  beforeEach(() => {
    outside = mkdtempSync(join(tmpdir(), 'open-sub-out-'));
  });
  afterEach(() => rmSync(outside, { recursive: true, force: true }));

  // The sub-agent of kind edit tries each path in turn, then answers.
  async function writes(paths: string[], s: Partial<Setup> & { over?: Partial<OpenRunParams> }): Promise<void> {
    const a = await server([delegating('edit'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server((req) => (req.n <= paths.length ? toolStep([{ id: `w${req.n}`, name: 'Write', args: { file_path: paths[req.n - 1], content: 'x' } }], { usageTokens: [10, 2] }) : textStep('sub done', { usageTokens: [10, 2] })));
    await run({ primary: member(a, 'a'), activities: { edit: [member(b, 'b')] }, write: true, ...s, over: { allowedTools: ['Agent', 'Write', 'Edit'], ...s.over } });
    expect(b.chats()).toHaveLength(paths.length + 1);
  }

  it('under a narrow write folder: inside it only, the reserved names refused, and the lift of the fence never applies', async () => {
    mkdirSync(join(dir, 'work'));
    const paths = [join(dir, 'work', 'in.txt'), join(dir, 'beside.txt'), join(outside, 'far.txt'), join(dir, 'work', '.kept', 'x.txt')];
    await writes(paths, { over: { writeRoot: join(dir, 'work'), writeReserved: ['.kept'], writeAnywhere: true } });
    expect(existsSync(paths[0])).toBe(true);
    expect(existsSync(paths[1])).toBe(false);
    expect(existsSync(paths[2])).toBe(false);
    expect(existsSync(paths[3])).toBe(false);
  });

  it('under a run that is not unconfined: nothing outside the run\'s folder', async () => {
    const paths = [join(dir, 'in.txt'), join(outside, 'far.txt')];
    await writes(paths, {});
    expect(existsSync(paths[0])).toBe(true);
    expect(existsSync(paths[1])).toBe(false);
  });

  it('under an unconfined run: anywhere, and still not `.git`', async () => {
    mkdirSync(join(dir, '.git'));
    const paths = [join(dir, 'in.txt'), join(outside, 'far.txt'), join(dir, '.git', 'config')];
    await writes(paths, { over: { writeAnywhere: true } });
    expect(existsSync(paths[0])).toBe(true);
    expect(existsSync(paths[1])).toBe(true);
    expect(existsSync(paths[2])).toBe(false);
  });

  it('under a read-only run: no kind that writes is offered, and a sub-agent that reads has no writing tool', async () => {
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server([textStep('sub done', { usageTokens: [10, 2] })]);
    await run({ primary: member(a, 'a'), activities: { edit: [member(b, 'b')], explore: [member(b, 'b')] }, tools: [tool('look', 'explore')], over: { allowedTools: ['Agent', 'Read', 'Write', 'Edit', 'look'] } });
    expect(agentTool(a.chats()[0])!.parameters.properties.kind.enum).toEqual(['explore']);
    expect(names(b.chats()[0])).toEqual(['Read', 'look']);
  });
});

// A sub-agent is told to the caller before it runs, so the caller can show it as a node: one handle each, in the order the tool calls ran.
describe('a sub-agent as a node', () => {
  const where = new AsyncLocalStorage<string>();
  const seen: string[] = [];

  // What a caller would do: note every call of the handle, and run the sub-agent with its tag as the async context.
  function caller() {
    const notes: string[] = [];
    const starts: SubAgentStart[] = [];
    const onSubAgent = (s: SubAgentStart): SubAgentHandle => {
      const tag = `${s.kind ?? s.name ?? 'agent'}#${starts.length}`;
      starts.push(s);
      notes.push(`open ${tag}`);
      return {
        events: { onToolUse: (name) => notes.push(`${tag} tool ${name}`), onInterim: (text) => notes.push(`${tag} says ${text}`), onThought: (text) => notes.push(`${tag} thinks ${text}`) },
        within: (fn) => where.run(tag, fn),
        state: (state) => notes.push(`${tag} ${state}`),
        end: (failure) => notes.push(failure === undefined ? `${tag} end` : `${tag} end ${failure}`),
      };
    };
    return { notes, starts, onSubAgent };
  }
  const watching = (name: string, wait = 0): ToolImpl => ({
    ...tool(name, name === 'look' ? 'explore' : name === 'Sh' ? 'shell' : 'edit', wait),
    async run() {
      seen.push(`${name} in ${where.getStore() ?? 'none'}`);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      return { response: 'ok', render: () => `${name} done` };
    },
  });
  const sub = (name: string) => (req: FakeRequest): Step => (req.body?.messages.at(-1).role === 'tool' ? textStep('sub done', { usageTokens: [10, 2] }) : toolStep([{ id: 'c', name, args: {} }], { usageTokens: [10, 2] }));
  const many = (calls: { kind?: SubKind; description?: string; prompt: string }[]) => toolStep(calls.map((c, i) => ({ id: `call_${i}`, name: 'Agent', args: c })), { usageTokens: [10, 2] });

  it('hands the caller one handle per sub-agent, in order, with the kind and the task, and the sub-agent\'s own steps go to it and not to the parent', async () => {
    seen.length = 0;
    const { notes, starts, onSubAgent } = caller();
    const a = await server([many([{ kind: 'explore', description: 'first task', prompt: 'p1' }, { kind: 'explore', description: 'second task', prompt: 'p2' }]), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server(sub('look'));
    const parent: string[] = [];
    await run({ primary: member(a, 'a'), activities: { explore: [member(b, 'b')] }, tools: [watching('look')], over: { events: { onToolUse: (name) => parent.push(name), onSubAgent } } });
    expect(starts).toEqual([
      { role: 'deep:explore', kind: 'explore', name: null, description: 'first task', prompt: 'p1' },
      { role: 'deep:explore', kind: 'explore', name: null, description: 'second task', prompt: 'p2' },
    ]);
    expect(notes.slice(0, 4)).toEqual(['open explore#0', 'explore#0 started', 'open explore#1', 'explore#1 started']);
    // each sub-agent's tool use reached its own handle, once, and the parent heard only of the Agent calls
    expect(notes.filter((n) => n === 'explore#0 tool look' || n === 'explore#1 tool look')).toHaveLength(2);
    expect(notes.filter((n) => n.endsWith('tool look')).map((n) => n.split(' ')[0]).sort()).toEqual(['explore#0', 'explore#1']);
    expect(parent).toEqual(['Agent', 'Agent']);
    expect(notes.filter((n) => n.includes(' end'))).toHaveLength(2);
    expect(notes.some((n) => n.includes('end ') && n.length > 'explore#0 end'.length)).toBe(false);
    // the tool ran inside the handle's own context, so what a sub-agent starts hangs under its node
    expect([...seen].sort()).toEqual(['look in explore#0', 'look in explore#1']);
  });

  it('heads a plain sub-agent with the definition it named, or nothing, and hands the parent\'s tools nothing of its own', async () => {
    const { starts, notes, onSubAgent } = caller();
    const a = await server([many([{ description: 'look around', prompt: 'p1' }]), textStep('principal done', { usageTokens: [10, 2] })]);
    await run({ primary: member(a, 'a'), activities: {}, mode: 'fallback', over: { events: { onSubAgent }, allowedTools: ['Agent', 'Read'] } });
    expect(starts).toEqual([{ role: 'deep:agent', kind: null, name: null, description: 'look around', prompt: 'p1' }]);
    expect(notes).toEqual(['open agent#0', 'agent#0 started', 'agent#0 end']);
  });

  it('puts a sub-agent that changes things on hold while another is ahead of it, and runs explore ones together', async () => {
    seen.length = 0;
    const { notes, onSubAgent } = caller();
    const a = await server([many([{ kind: 'edit', prompt: 'e' }, { kind: 'shell', prompt: 's' }, { kind: 'explore', prompt: 'x' }]), textStep('principal done', { usageTokens: [10, 2] })]);
    const eb = await server(sub('Ed'));
    const sb = await server(sub('Sh'));
    const xb = await server(sub('look'));
    await run({
      primary: member(a, 'a'),
      activities: { edit: [member(eb, 'e')], shell: [member(sb, 's')], explore: [member(xb, 'x')] },
      tools: [watching('Ed', 40), watching('Sh', 10), watching('look', 10)],
      write: true,
      over: { events: { onSubAgent } },
    });
    // the first of them runs at once, the second waits; the explore one never waits
    expect(notes.filter((n) => /^(edit|shell|explore)#\d (queued|started)$/.test(n))).toEqual(['edit#0 started', 'shell#1 queued', 'explore#2 started', 'shell#1 started']);
    expect(notes.indexOf('edit#0 end')).toBeLessThan(notes.indexOf('shell#1 started'));
    expect(notes.filter((n) => n.startsWith('open'))).toEqual(['open edit#0', 'open shell#1', 'open explore#2']);
  });

  it('ends a sub-agent that ran out of turns as failed with the reason, and leaves the model-switch notice with the parent', async () => {
    const { notes, onSubAgent } = caller();
    const a = await server([many([{ kind: 'explore', prompt: 'p' }]), textStep('split it then', { usageTokens: [10, 2] })]);
    const forever = await server(() => toolStep([{ id: 'c', name: 'look', args: {} }], { usageTokens: [10, 2] }));
    const switches: PoolSwitch[] = [];
    await run({ primary: member(a, 'a'), activities: { explore: [member(forever, 'f')] }, tools: [watching('look')], over: { events: { onSubAgent, onSwitch: (e) => switches.push(e) } } });
    const end = notes.find((n) => n.startsWith('explore#0 end '));
    expect(end).toContain(String(KIND_TURNS.explore));
    expect(notes.filter((n) => n.includes(' end'))).toHaveLength(1);
    expect(switches).toMatchObject([{ reason: 'delegate', activity: 'explore' }]);
    expect(notes.some((n) => n.includes('delegate'))).toBe(false);
  });

  it('ends the node as failed when the model-switch notice throws before the sub-agent runs, once, and never runs the sub-agent', async () => {
    seen.length = 0;
    const { notes, onSubAgent } = caller();
    const a = await server([many([{ kind: 'explore', prompt: 'p' }]), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server(sub('look'));
    await run({ primary: member(a, 'a'), activities: { explore: [member(b, 'b')] }, tools: [watching('look')], over: { events: { onSubAgent, onSwitch: () => { throw new Error('listener broke'); } } } });
    expect(notes.filter((n) => n.startsWith('open'))).toEqual(['open explore#0']);
    expect(notes.filter((n) => n.includes(' end'))).toEqual(['explore#0 end listener broke']);
    expect(seen).toEqual([]);
  });

  it('reports the reasoning of each turn once to whoever took the turn: the parent\'s to the parent, a sub-agent\'s to its own handle', async () => {
    const { notes, onSubAgent } = caller();
    const a = await server([many([{ kind: 'explore', description: 'think about it', prompt: 'p' }]), textStep('principal done', { usageTokens: [10, 2], reasoning: 'The principal concludes.' })]);
    const b = await server((req: FakeRequest) => (req.body?.messages.at(-1).role === 'tool' ? textStep('sub done', { usageTokens: [10, 2] }) : toolStep([{ id: 'c', name: 'look', args: {} }], { usageTokens: [10, 2], reasoning: ['The sub-agent ', 'looks first.'] })));
    const parent: string[] = [];
    await run({ primary: member(a, 'a'), activities: { explore: [member(b, 'b')] }, tools: [watching('look')], over: { events: { onThought: (text) => parent.push(text), onSubAgent } } });
    expect(parent).toEqual(['The principal concludes.']);
    expect(notes.filter((n) => n.includes(' thinks '))).toEqual(['explore#0 thinks The sub-agent looks first.']);
  });

  it('does not hand a sub-agent\'s reasoning to the parent when the caller made no node for it', async () => {
    const a = await server([many([{ kind: 'explore', prompt: 'p' }]), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server((req: FakeRequest) => (req.body?.messages.at(-1).role === 'tool' ? textStep('sub done', { usageTokens: [10, 2] }) : toolStep([{ id: 'c', name: 'look', args: {} }], { usageTokens: [10, 2], reasoning: 'Private to the sub-agent.' })));
    const parent: string[] = [];
    await run({ primary: member(a, 'a'), activities: { explore: [member(b, 'b')] }, tools: [watching('look')], over: { events: { onThought: (text) => parent.push(text) } } });
    expect(parent).toEqual([]);
  });

  it('behaves as before for a caller that does not follow sub-agents', async () => {
    const a = await server([many([{ kind: 'explore', prompt: 'p' }]), textStep('principal done', { usageTokens: [10, 2] })]);
    const b = await server([textStep('sub done', { usageTokens: [10, 2] })]);
    const r = await run({ primary: member(a, 'a'), activities: { explore: [member(b, 'b')] }, tools: [watching('look')] });
    expect(r.data).toBe('principal done');
  });
});

describe('the model of a kind', () => {
  const m = (key: string, extra: Partial<PoolMember> = {}): PoolMember => ({ key, label: key, client: {} as never, ...extra });

  it('is the first model of the list that can use tools, with the rest of the list as its spares and no way to move by activity', () => {
    const pool = { name: 'deep', primary: { key: 'a', label: 'a' }, fallbacks: [], activities: { shell: [m('x', { tools: false }), m('y', { contextWindow: 64_000, images: true }), m('z')] } };
    const got = modelOfKind('shell', pool)!;
    expect(got.pool.primary.key).toBe('y');
    expect(got.pool.fallbacks.map((f) => f.key)).toEqual(['x', 'z']);
    expect(got.pool.mode).toBe('fallback');
    expect(got.capabilities).toEqual({ contextWindow: 64_000, images: true });
  });

  it('is none for a kind without a list', () => {
    expect(modelOfKind('shell', { name: 'deep', primary: { key: 'a', label: 'a' }, fallbacks: [], activities: { edit: [m('x')] } })).toBeNull();
    expect(modelOfKind('shell', undefined)).toBeNull();
  });
});

describe('the turns of a sub-agent are a setting', () => {
  const forever = () => toolStep([{ id: 'c', name: 'look', args: {} }], { usageTokens: [10, 2] });
  const fewThenDone = (n: number) => {
    let seen = 0;
    return (): Step => (++seen > n ? textStep('sub done', { usageTokens: [10, 2] }) : forever());
  };
  const answerOf = (a: Fake): string => usageOf(a.chats()[1]).find((m) => m.role === 'tool')!.content as string;

  it('takes the number from the setting, and the default of its kind when there is none or it is not a sensible number', () => {
    expect(DEFAULT_SUB_TURNS).toEqual({ explore: 12, edit: 30, shell: 20, screen: 30, plain: 12 });
    expect(subTurnsOf(undefined, 'edit')).toBe(30);
    expect(subTurnsOf(undefined, undefined)).toBe(12);
    expect(subTurnsOf(() => ({ explore: 3, plain: 9 }), 'explore')).toBe(3);
    expect(subTurnsOf(() => ({ explore: 3, plain: 9 }), undefined)).toBe(9);
    expect(subTurnsOf(() => ({ explore: 3 }), 'shell')).toBe(20);
    for (const bad of [0, -1, 2.5, Number.NaN, '4' as unknown as number]) expect(subTurnsOf(() => ({ explore: bad }), 'explore'), String(bad)).toBe(12);
  });

  it('stops an explore sub-agent at the configured number, and says that number to the principal', async () => {
    const a = await server([delegating('explore'), textStep('split it then', { usageTokens: [10, 2] })]);
    const f = await server(forever);
    const r = await run({ primary: member(a, 'a'), activities: { explore: [member(f, 'f')] }, tools: [tool('look', 'explore')], write: true, over: { subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 3 }) } });
    expect(r.data).toBe('split it then');
    expect(f.chats()).toHaveLength(3);
    expect(answerOf(a)).toContain('3');
    expect(answerOf(a)).not.toContain(String(KIND_TURNS.explore));
  });

  it('lets the same task finish when the number is larger: it stops asking for more than it needs', async () => {
    const a = await server([delegating('explore'), textStep('principal done', { usageTokens: [10, 2] })]);
    const f = await server(fewThenDone(5));
    await run({ primary: member(a, 'a'), activities: { explore: [member(f, 'f')] }, tools: [tool('look', 'explore')], write: true, over: { subTurns: () => ({ ...DEFAULT_SUB_TURNS, explore: 20 }) } });
    expect(answerOf(a)).toBe('sub done');
    expect(f.chats()).toHaveLength(6);
  });

  it('gives each kind its own number: edit, shell and screen read theirs, not the explore one', async () => {
    for (const [kind, name] of [['edit', 'Ed'], ['shell', 'Sh'], ['screen', 'Snap']] as const) {
      restRegistry.clear();
      const a = await server([delegating(kind), textStep('done', { usageTokens: [10, 2] })]);
      const f = await server(() => toolStep([{ id: 'c', name, args: {} }], { usageTokens: [10, 2] }));
      await run({ primary: member(a, 'a'), activities: { [kind]: [member(f, 'f')] }, tools: [tool(name, kind)], write: true, over: { subTurns: () => ({ explore: 1, edit: 4, shell: 5, screen: 6, plain: 2 }) } });
      expect(f.chats(), kind).toHaveLength({ edit: 4, shell: 5, screen: 6 }[kind]);
    }
  });

  it('gives a sub-agent that is not of a kind the number of `plain`, on the principal\'s own model', async () => {
    const starter = toolStep([{ id: 'call_plain', name: 'Agent', args: { description: 'go', prompt: 'sub task' } }], { usageTokens: [10, 2] });
    let sub = 0;
    const a = await server((req) => {
      const first = String(usageOf(req)[1]?.content);
      if (first !== 'sub task') return req.body?.messages.at(-1).role === 'tool' ? textStep('principal done', { usageTokens: [10, 2] }) : starter;
      sub++;
      return toolStep([{ id: `s${sub}`, name: 'look', args: {} }], { usageTokens: [10, 2] });
    });
    await run({ primary: member(a, 'a'), tools: [tool('look', 'explore')], over: { subTurns: () => ({ ...DEFAULT_SUB_TURNS, plain: 2 }) } });
    expect(sub).toBe(2);
    // with nothing wired it is the tool error of today
    sub = 0;
    restRegistry.clear();
    await run({ primary: member(a, 'a'), tools: [tool('look', 'explore')] });
    expect(sub).toBe(12);
  });

  it('reads the number when the sub-agent really starts: one that waited its turn gets the setting as it is then, and one already running keeps its own', async () => {
    const live = { ...DEFAULT_SUB_TURNS, edit: 6 };
    const a = await server([
      toolStep([{ id: 'c0', name: 'Agent', args: { description: 'one', prompt: 'p1', kind: 'edit' } }, { id: 'c1', name: 'Agent', args: { description: 'two', prompt: 'p2', kind: 'edit' } }], { usageTokens: [10, 2] }),
      textStep('principal done', { usageTokens: [10, 2] }),
    ]);
    const turns = { p1: 0, p2: 0 };
    const edits = await server((req) => {
      const who = String(usageOf(req)[1]?.content) as 'p1' | 'p2';
      turns[who]++;
      // the first one changes the setting with its first step and then finishes; the second never does
      if (who === 'p1') return turns.p1 === 1 ? toolStep([{ id: 'e', name: 'Ed', args: {} }], { usageTokens: [10, 2] }) : textStep('one done', { usageTokens: [10, 2] });
      return toolStep([{ id: `e${turns.p2}`, name: 'Ed', args: {} }], { usageTokens: [10, 2] });
    });
    const changing: ToolImpl = { ...tool('Ed', 'edit'), async run() { live.edit = 2; return { response: 'ok', render: () => 'Ed done' }; } };
    await run({ primary: member(a, 'a'), activities: { edit: [member(edits, 'e')] }, tools: [changing], write: true, over: { subTurns: () => live } });
    expect(turns).toEqual({ p1: 2, p2: 2 });
  });
});
