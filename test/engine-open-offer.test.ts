import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { type MemberParams, type PoolMember, type PoolSwitch, type Tuning, PoolClient } from '../src/main/engine/open/pool';
import { restRegistry } from '../src/main/engine/open/rest';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import type { Activity, PoolMode } from '../src/shared/config/types';
import { type Fake, type FakeRequest, type Step, busyStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

// Tier, effort and fail-fast in the open engine: sent only where the provider and the catalog allow them (`params` of the member), only when the call asks, and
// fail-fast only to a model that is not the last one available.

let dir: string;
let fakes: Fake[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-offer-'));
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

const ALL: MemberParams = { flex: true, effort: true, failFast: true };
// The client retries twice by itself: a refusal that is not retried is the point of fail-fast.
const member = (f: Fake, name: string, params?: MemberParams, extra: Partial<PoolMember> = {}): PoolMember => ({
  key: `key-${name}`,
  label: `model-${name}`,
  model: `model-${name}`,
  provider: `prov-${name}`,
  client: new ChatClient({ baseUrl: f.url, model: `model-${name}`, retryDelayMs: 0, maxRetries: 2 }),
  ...(params ? { params } : {}),
  ...extra,
});
const tool = (name: string, activity: Activity): ToolImpl => ({ name, activity, description: name, parameters: { type: 'object', properties: {} }, async run() { return { response: 'ok', render: () => 'done' }; } });
const call = (name: string) => toolStep([{ id: `call_${name}`, name, args: {} }], { usageTokens: [10, 2] });
const said = (text: string) => textStep(text, { usageTokens: [10, 2] });
const body = (f: Fake, n: number) => f.chats()[n].body as Record<string, unknown>;
const EXTRA = ['service_tier', 'reasoning_effort', 'fail_fast'];
const sentOf = (f: Fake, n: number) => Object.fromEntries(EXTRA.filter((k) => k in body(f, n)).map((k) => [k, body(f, n)[k]]));

interface Setup {
  primary: PoolMember;
  fallbacks?: PoolMember[];
  activities?: Partial<Record<Activity, PoolMember[]>>;
  tools?: ToolImpl[];
  mode?: PoolMode;
  tuning?: Tuning;
  over?: Partial<OpenRunParams>;
}

function run(s: Setup, events: PoolSwitch[] = []) {
  const p: OpenRunParams = {
    role: 'deep',
    prompt: 'do it',
    client: s.primary.client,
    ...(s.primary.params ? { params: s.primary.params } : {}),
    ...(s.tuning ? { tuning: s.tuning } : {}),
    pool: { name: 'deep', primary: { key: s.primary.key, label: s.primary.label, provider: s.primary.provider }, fallbacks: s.fallbacks ?? [], activities: s.activities, ...(s.mode ? { mode: s.mode } : {}) },
    cwd: dir,
    allowedTools: ['Agent', ...(s.tools ?? []).map((t) => t.name)],
    extraTools: s.tools,
    docs: {},
    maxTurns: 8,
    sessionsDir: join(dir, 'sessions'),
    ripgrep: 'off',
    events: { onSwitch: (e) => events.push(e) },
    ...s.over,
  };
  return runOpen<string>(p);
}

describe('fail-fast in a pool', () => {
  it('goes to every model but the last one still available, which waits in the queue as before', async () => {
    const a = await server([busyStep()]);
    const b = await server([busyStep()]);
    const c = await server([said('done')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a', ALL), fallbacks: [member(b, 'b', ALL), member(c, 'c', ALL)] }, events);
    expect(r.data).toBe('done');
    expect(sentOf(a, 0)).toEqual({ fail_fast: true });
    expect(sentOf(b, 0)).toEqual({ fail_fast: true });
    expect(sentOf(c, 0)).toEqual({});
    expect(events.map((e) => [e.from.label, e.to.label, e.reason])).toEqual([['model-a', 'model-b', 'overloaded'], ['model-b', 'model-c', 'overloaded']]);
  });

  it('does not repeat a refusal: the busy model is called once, though the client would retry twice', async () => {
    const a = await server([busyStep()]);
    const b = await server([said('ok')]);
    await run({ primary: member(a, 'a', ALL), fallbacks: [member(b, 'b', ALL)] });
    expect(a.chats()).toHaveLength(1);
    expect(b.chats()).toHaveLength(1);
  });

  it('rests the refusing model for a minute, not five', async () => {
    const a = await server([busyStep()]);
    const b = await server([said('ok')]);
    const events: PoolSwitch[] = [];
    await run({ primary: member(a, 'a', ALL), fallbacks: [member(b, 'b', ALL)] }, events);
    const wait = (events[0].until ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(50_000);
    expect(wait).toBeLessThanOrEqual(60_000);
  });

  it('a model at rest is not "another one": the model in use then is the last, and waits', async () => {
    const a = await server([said('ok')]);
    const b = await server([said('never')]);
    restRegistry.rest('key-b', 60_000);
    await run({ primary: member(a, 'a', ALL), fallbacks: [member(b, 'b', ALL)] });
    expect(sentOf(a, 0)).toEqual({});
    expect(b.chats()).toHaveLength(0);
  });

  it('after a model refused, the one that is left is the last of the call, and waits', async () => {
    const a = await server([busyStep()]);
    const b = await server([said('ok')]);
    await run({ primary: member(a, 'a', ALL), fallbacks: [member(b, 'b', ALL)] });
    expect(sentOf(b, 0)).toEqual({});
  });

  it('a member whose provider does not have it never gets it, and does not count as a place to go less', async () => {
    const a = await server([said('ok')]);
    const b = await server([said('never')]);
    await run({ primary: member(a, 'a', ALL), fallbacks: [member(b, 'b')] });
    // b is available, so a can ask to be refused at once; b is never asked.
    expect(sentOf(a, 0)).toEqual({ fail_fast: true });
    const lone = await server([said('ok')]);
    await run({ primary: member(lone, 'l', ALL) });
    expect(sentOf(lone, 0)).toEqual({});
  });

  it('a model of a provider without the feature waits in the queue: nothing is sent', async () => {
    const a = await server([said('ok')]);
    const b = await server([said('never')]);
    await run({ primary: member(a, 'a', { effort: true }), fallbacks: [member(b, 'b', ALL)] });
    expect(sentOf(a, 0)).toEqual({});
  });
});

describe('the tier', () => {
  it('is flex only for a call nobody waits for, on a model marked for it', async () => {
    const a = await server([said('one'), said('two'), said('three')]);
    await run({ primary: member(a, 'a', { flex: true }), tuning: { background: true } });
    await run({ primary: member(a, 'a', { flex: true }), tuning: { background: false } });
    await run({ primary: member(a, 'a', { flex: true }) });
    expect(sentOf(a, 0)).toEqual({ service_tier: 'flex' });
    expect(sentOf(a, 1)).toEqual({});
    expect(sentOf(a, 2)).toEqual({});
  });

  it('is never sent to a model not marked for it, or to a provider that does not have it', async () => {
    const a = await server([said('ok'), said('ok')]);
    await run({ primary: member(a, 'a', { effort: true }), tuning: { background: true } });
    await run({ primary: member(a, 'a'), tuning: { background: true } });
    expect(sentOf(a, 0)).toEqual({});
    expect(sentOf(a, 1)).toEqual({});
  });

  it('a flex call the server refuses with a 429 goes again in the standard tier on the same model, without leaving it', async () => {
    const a = await server((req) => ('service_tier' in (req.body ?? {}) ? ({ status: 429, json: { error: { message: 'Rate limit reached' } } } as Step) : said('ok')));
    const b = await server([said('never')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a', { flex: true }), fallbacks: [member(b, 'b')], tuning: { background: true } }, events);
    expect(r.data).toBe('ok');
    expect(a.chats()).toHaveLength(2);
    expect(sentOf(a, 1)).toEqual({});
    expect(b.chats()).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('a server that does not know the parameter teaches the client to stop sending it', async () => {
    const a = await server((req) => ('service_tier' in (req.body ?? {}) ? ({ status: 400, json: { error: { message: "Unknown parameter: 'service_tier'" } } } as Step) : said('ok')));
    await run({ primary: member(a, 'a', { flex: true }), tuning: { background: true }, over: { maxTurns: 8 } });
    expect(a.chats()).toHaveLength(2);
    expect(sentOf(a, 1)).toEqual({});
  });
});

describe('the effort', () => {
  const tools = () => [tool('look', 'explore'), tool('Sh', 'shell'), tool('Ed', 'edit')];
  const efforts = { explore: 'low', shell: 'low', edit: 'medium', write: 'high' } as const;
  const script = () => [call('Sh'), call('Ed'), call('look'), said('done')];
  const lists = (m: PoolMember): Partial<Record<Activity, PoolMember[]>> => ({ explore: [m], edit: [m], shell: [m] });

  it('in a switching pool, each turn asks for the effort of its activity: the first turn is write, then what the last results were for', async () => {
    const a = await server(script());
    const m = member(a, 'a', { effort: true });
    // `switch` acts only where the pool has lists of its own for the activities; here they hold the same model, which is all the test needs.
    await run({ primary: m, activities: lists(m), tools: tools(), mode: 'switch', tuning: { efforts } });
    expect([0, 1, 2, 3].map((n) => sentOf(a, n))).toEqual([
      { reasoning_effort: 'high' }, // write: the start of the stage
      { reasoning_effort: 'low' }, // shell
      { reasoning_effort: 'medium' }, // edit
      { reasoning_effort: 'low' }, // explore
    ]);
  });

  it('the main model of a fixed route keeps the effort of write on every turn', async () => {
    for (const mode of ['fallback', 'delegate'] as const) {
      const a = await server(script());
      await run({ primary: member(a, 'a', { effort: true }), tools: tools(), mode, tuning: { efforts } });
      expect([0, 1, 2, 3].map((n) => sentOf(a, n)), mode).toEqual(Array(4).fill({ reasoning_effort: 'high' }));
    }
  });

  it('sends nothing for an activity left to the model, or to a model not marked for it', async () => {
    const a = await server(script());
    const m = member(a, 'a', { effort: true });
    await run({ primary: m, activities: lists(m), tools: tools(), mode: 'switch', tuning: { efforts: { shell: 'low' } } });
    expect([0, 1, 2, 3].map((n) => sentOf(a, n))).toEqual([{}, { reasoning_effort: 'low' }, {}, {}]);
    const b = await server(script());
    const n = member(b, 'b', { flex: true });
    await run({ primary: n, activities: lists(n), tools: tools(), mode: 'switch', tuning: { efforts } });
    expect([0, 1, 2, 3].map((n) => sentOf(b, n))).toEqual(Array(4).fill({}));
  });

  it('a refused effort is dropped and the reasoning is still echoed back', async () => {
    const a = await server((req) => ('reasoning_effort' in (req.body ?? {}) ? ({ status: 400, json: { error: { message: 'Unknown parameter: reasoning_effort (reasoning models only)' } } } as Step) : textStep('ok', { usageTokens: [10, 2], reasoning: 'thinking' })));
    const m = member(a, 'a', { effort: true }, { client: new ChatClient({ baseUrl: a.url, model: 'model-a', retryDelayMs: 0, maxRetries: 0, echoReasoning: true }) });
    await run({ primary: m, tuning: { efforts: { write: 'high' } } });
    expect(m.client.learned.echoRefused).toBeUndefined();
    expect(m.client.learned.echoReasoning).toBe(true);
    expect(m.client.learned.dropParams.has('reasoning_effort')).toBe(true);
  });

  it('a sub-agent of a kind asks for the effort of its kind, and the main model for write\'s', async () => {
    const principal = await server([toolStep([{ id: 'c1', name: 'Agent', args: { description: 'go', prompt: 'run it', kind: 'shell' } }], { usageTokens: [10, 2] }), said('principal done')]);
    const shell = await server((req) => (req.body?.messages.at(-1).role === 'tool' ? said('ran') : call('Sh')));
    const events: PoolSwitch[] = [];
    await run(
      { primary: member(principal, 'p', { effort: true }), activities: { shell: [member(shell, 's', { effort: true })] }, tools: [tool('Sh', 'shell'), tool('look', 'explore')], mode: 'delegate', tuning: { efforts }, over: { writeRoot: dir } },
      events,
    );
    expect([0, 1].map((n) => sentOf(principal, n))).toEqual([{ reasoning_effort: 'high' }, { reasoning_effort: 'high' }]);
    expect([0, 1].map((n) => sentOf(shell, n))).toEqual([{ reasoning_effort: 'low' }, { reasoning_effort: 'low' }]);
  });
});

describe('a provider without the features', () => {
  it('sends none of the three, whatever the call asks for', async () => {
    const a = await server([call('look'), said('done')]);
    const b = await server([said('never')]);
    await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], tools: [tool('look', 'explore')], tuning: { background: true, efforts: { explore: 'low', write: 'high' } } });
    expect([0, 1].map((n) => sentOf(a, n))).toEqual([{}, {}]);
  });
});

describe('waiting in the flex queue', () => {
  // A client that answers when told to: the wait is what is under test.
  const stub = (release: Promise<void>, seen: unknown[]) =>
    ({
      cfg: { model: 'm' },
      learned: { dropParams: new Set<string>() },
      async complete(o: unknown) {
        seen.push(o);
        await release;
        return { text: 'ok', reasoning: '', toolCalls: [], finishReason: 'stop', usage: null, reasoningField: null };
      },
    }) as unknown as ChatClient;

  it('tells the caller every so often while a flex call waits, and stops when it ends', async () => {
    let free!: () => void;
    const release = new Promise<void>((r) => (free = r));
    const seen: unknown[] = [];
    const m: PoolMember = { key: 'k', label: 'm', client: stub(release, seen), params: { flex: true } };
    let waits = 0;
    const pc = new PoolClient(m, undefined, { tuning: { background: true }, onWait: () => void waits++, waitEveryMs: 5 });
    const done = pc.complete({ messages: [] }, { activity: 'write', tools: false, tokens: 0 });
    await new Promise((r) => setTimeout(r, 40));
    expect(waits).toBeGreaterThanOrEqual(3);
    free();
    await done;
    const after = waits;
    await new Promise((r) => setTimeout(r, 30));
    expect(waits).toBe(after);
    expect(seen[0]).toMatchObject({ serviceTier: 'flex' });
  });

  it('says nothing for a call that is not in the flex tier', async () => {
    const seen: unknown[] = [];
    const m: PoolMember = { key: 'k', label: 'm', client: stub(new Promise((r) => setTimeout(r, 30)), seen), params: { flex: true } };
    let waits = 0;
    const pc = new PoolClient(m, undefined, { tuning: { background: false }, onWait: () => void waits++, waitEveryMs: 5 });
    await pc.complete({ messages: [] }, { activity: 'write', tools: false, tokens: 0 });
    expect(waits).toBe(0);
    expect(seen[0]).not.toHaveProperty('serviceTier');
  });
});
