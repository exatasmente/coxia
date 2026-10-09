import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderBusyError } from '../src/main/engine/contract';
import { ChatClient } from '../src/main/engine/open/client';
import { EngineError } from '../src/main/engine/open/errors';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { type PoolMember, type PoolSwitch } from '../src/main/engine/open/pool';
import { MAX_REST_MS, restRegistry } from '../src/main/engine/open/rest';
import { readSession } from '../src/main/engine/open/session';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import type { Activity, PoolMode, ScoreOverrides } from '../src/shared/config/types';
import { type Fake, type Step, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let dir: string;
let fakes: Fake[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-pool-'));
  mkdirSync(join(dir, 'sessions'));
  restRegistry.clear();
});

afterEach(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  fakes = [];
  restRegistry.clear();
  rmSync(dir, { recursive: true, force: true });
});

async function server(script: Step[]): Promise<Fake> {
  const f = await fakeOpenAI(script);
  fakes.push(f);
  return f;
}

const BUSY = { ...errorStep(429, 'Rate limit reached'), headers: { 'retry-after': '120' } } as Step;
const client = (f: Fake, model: string, extra = {}) => new ChatClient({ baseUrl: f.url, model, retryDelayMs: 0, maxRetries: 0, ...extra });
const member = (f: Fake, name: string, extra: Partial<PoolMember> = {}, clientExtra = {}): PoolMember => ({ key: `key-${name}`, label: `model-${name}`, model: `model-${name}`, provider: `prov-${name}`, client: client(f, `model-${name}`, clientExtra), ...extra });

interface Setup {
  primary: PoolMember;
  fallbacks?: PoolMember[];
  activities?: Partial<Record<Activity, PoolMember[]>>;
  tools?: ToolImpl[];
  scoreOverrides?: ScoreOverrides;
  mode?: PoolMode;
  over?: Partial<OpenRunParams>;
}

function run(s: Setup, events: PoolSwitch[] = []) {
  const p: OpenRunParams = {
    role: 'deep',
    prompt: 'do it',
    client: s.primary.client,
    pool: { name: 'deep', primary: { key: s.primary.key, label: s.primary.label, provider: s.primary.provider }, fallbacks: s.fallbacks ?? [], activities: s.activities, ...(s.scoreOverrides ? { scoreOverrides: s.scoreOverrides } : {}), ...(s.mode ? { mode: s.mode } : {}) },
    capabilities: { images: s.primary.images },
    cwd: dir,
    allowedTools: (s.tools ?? []).map((t) => t.name),
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

const tool = (name: string, activity: Activity | undefined, images = false): ToolImpl => ({
  name,
  ...(activity ? { activity } : {}),
  description: name,
  parameters: { type: 'object', properties: {} },
  async run() {
    return { response: 'ok', render: () => 'done', ...(images ? { images: [{ path: 'shot', mediaType: 'image/png', data: 'AAAA' }] } : {}) };
  },
});
const call = (name: string, id = `call_${name}`) => toolStep([{ id, name, args: {} }], { usageTokens: [10, 2] });
const said = (text: string) => textStep(text, { usageTokens: [10, 2] });
const messagesOf = (f: Fake, n: number) => (f.chats()[n].body?.messages ?? []) as { role: string; content: unknown; reasoning_content?: string }[];

describe('a busy model moves the call to the next one', () => {
  it('finishes on the second model, in the same session, with the whole history, and says so', async () => {
    const a = await server([call('look'), BUSY]);
    const b = await server([said('all done')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], tools: [tool('look', 'explore')] }, events);
    expect(r.data).toBe('all done');
    // The second model got what the first one had said and been answered: the same dialog.
    const roles = messagesOf(b, 0).map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(messagesOf(b, 0)[1].content).toBe('do it');
    expect(b.chats()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from: { label: 'model-a', provider: 'prov-a' }, to: { label: 'model-b', provider: 'prov-b' }, reason: 'rate_limit', activity: 'explore' });
    expect(events[0].until).toBeGreaterThan(Date.now() + 100_000);
    // One session on disk: each answer with the model that wrote it, and the switch between them.
    const lines = readSession(join(dir, 'sessions'), r.sessionId)!;
    expect(lines.filter((l) => l.t === 'msg' && l.message.role === 'assistant').map((l) => (l as { model?: string }).model)).toEqual(['model-a', 'model-b']);
    expect(lines.filter((l) => l.t === 'switch')).toMatchObject([{ from: 'model-a', to: 'model-b', reason: 'rate_limit', activity: 'explore' }]);
    expect(lines.filter((l) => l.t === 'meta')).toHaveLength(1);
  });

  it('retries the model first (the client\'s own retries) and only then moves on', async () => {
    const a = await server([errorStep(429, 'Rate limit reached')]);
    const b = await server([said('ok')]);
    await run({ primary: member(a, 'a', {}, { maxRetries: 2 }), fallbacks: [member(b, 'b')] });
    expect(a.chats()).toHaveLength(3);
    expect(b.chats()).toHaveLength(1);
  });

  it('moves on for an overload and a server error too, but not for a timeout', async () => {
    for (const step of [errorStep(503, 'overloaded'), errorStep(500, 'internal error')]) {
      restRegistry.clear();
      const a = await server([step]);
      const b = await server([said('ok')]);
      await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] });
      expect(b.chats()).toHaveLength(1);
    }
    restRegistry.clear();
    const a = await server([errorStep(504, 'gateway timeout')]);
    const b = await server([said('ok')]);
    const failure = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] }).catch((e) => e);
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).kind).toBe('timeout');
    expect(b.chats()).toHaveLength(0);
    expect(restRegistry.resting('key-a')).toBe(false);
  });

  it('does not move for a bad key or a request the server calls wrong', async () => {
    const a = await server([errorStep(401, 'Incorrect API key')]);
    const b = await server([said('ok')]);
    const failure = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] }).catch((e) => e);
    expect((failure as EngineError).kind).toBe('auth');
    expect(b.chats()).toHaveLength(0);
  });

  it('without a pool a refusal is the client\'s own error and nothing rests', async () => {
    const a = await server([errorStep(429, 'Rate limit reached')]);
    const failure = await run({ primary: member(a, 'a') }).catch((e) => e);
    expect(failure).toBeInstanceOf(EngineError);
    expect((failure as EngineError).kind).toBe('rate_limit');
    expect(restRegistry.resting('key-a')).toBe(false);
  });

  it('stays on the second model after the first is back, until that one refuses', async () => {
    const a = await server([BUSY, said('from a')]);
    const b = await server([call('look'), call('look'), said('from b')]);
    const events: PoolSwitch[] = [];
    // Turn 1 goes to a, which is busy; b takes over and keeps going after a is free again.
    const clear = { run: tool('look', 'explore').run };
    const look: ToolImpl = { ...tool('look', 'explore'), async run(i, c) { restRegistry.clear(); return clear.run(i, c); } };
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], tools: [look] }, events);
    expect(r.data).toBe('from b');
    expect(a.chats()).toHaveLength(1);
    expect(b.chats()).toHaveLength(3);
    expect(events).toHaveLength(1);
  });
});

describe('the rest is for the whole app', () => {
  it('a model that refused is skipped by the next run, and comes back after its rest', async () => {
    const a = await server([BUSY, said('a is back')]);
    const b = await server([said('first'), said('second')]);
    const setup = (): Setup => ({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] });
    expect((await run(setup())).data).toBe('first');
    const events: PoolSwitch[] = [];
    // The second run never asks a: it is resting. It says why it starts on b.
    expect((await run(setup(), events)).data).toBe('second');
    expect(a.chats()).toHaveLength(1);
    expect(events).toMatchObject([{ from: { label: 'model-a' }, to: { label: 'model-b' }, reason: 'resting' }]);
    // After the rest it is the first of the list again.
    restRegistry.clear();
    expect((await run(setup())).data).toBe('a is back');
  });

  it('rests by the Retry-After, capped at 15 minutes, else the default of 5', async () => {
    const a = await server([{ ...errorStep(429, 'slow'), headers: { 'retry-after': '99999' } } as Step]);
    const b = await server([said('ok')]);
    const before = Date.now();
    await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] });
    const until = restRegistry.until('key-a')!;
    expect(until - before).toBeGreaterThan(MAX_REST_MS - 5000);
    expect(until - before).toBeLessThanOrEqual(MAX_REST_MS + 5000);
    restRegistry.clear();
    const c = await server([errorStep(503, 'overloaded')]);
    const d = await server([said('ok')]);
    const start = Date.now();
    await run({ primary: member(c, 'c'), fallbacks: [member(d, 'd')] });
    expect(restRegistry.until('key-c')! - start).toBeGreaterThan(5 * 60_000 - 5000);
    expect(restRegistry.until('key-c')! - start).toBeLessThanOrEqual(5 * 60_000 + 5000);
  });
});

describe('every model busy', () => {
  it('fails with an error that names the pool, its models and when the first is back', async () => {
    const a = await server([BUSY]);
    const b = await server([{ ...errorStep(529, 'overloaded'), headers: { 'retry-after': '30' } } as Step]);
    const failure = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] }).catch((e) => e);
    expect(failure).toBeInstanceOf(ProviderBusyError);
    const e = failure as ProviderBusyError;
    expect(e.pool).toBe('deep');
    expect(e.models).toEqual(['model-a', 'model-b']);
    expect(e.until).toBeGreaterThan(Date.now() + 20_000);
    expect(e.until).toBeLessThan(Date.now() + 60_000);
    expect(e.message).toMatch(/deep/);
    expect(e.message).toMatch(/model-a, model-b/);
    // A call that finds the whole pool resting does not even ask.
    const again = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')] }).catch((x) => x);
    expect(again).toBeInstanceOf(ProviderBusyError);
    expect(a.chats()).toHaveLength(1);
    expect(b.chats()).toHaveLength(1);
  });
});

describe('the activity of a turn', () => {
  it('goes to the list of the activity and back, switching only when the model in use is not in it', async () => {
    const a = await server([call('run'), call('look'), said('done')]);
    const b = await server([call('look')]);
    const events: PoolSwitch[] = [];
    // a serves everything but the shell, which is b's alone.
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, tools: [tool('run', 'shell'), tool('look', 'explore')] }, events);
    expect(r.data).toBe('done');
    expect(events.map((e) => [e.from.label, e.to.label, e.reason, e.activity])).toEqual([
      ['model-a', 'model-b', 'activity', 'shell'],
      ['model-b', 'model-a', 'activity', 'explore'],
    ]);
    expect(a.chats()).toHaveLength(3);
    expect(b.chats()).toHaveLength(1);
  });

  it('moves to the stronger model of an activity\'s own list when the model in use is under its floor, and stays on it for a turn without a floor', async () => {
    const a = await server([call('run')]);
    const b = await server([call('look'), said('done')]);
    const events: PoolSwitch[] = [];
    const scoreOverrides = { floors: { shell: 90 }, models: { 'model-a': { shell: 87 }, 'model-b': { shell: 91 } } };
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], activities: { shell: [member(b, 'b'), member(a, 'a')] }, scoreOverrides, tools: [tool('run', 'shell'), tool('look', 'explore')] }, events);
    expect(r.data).toBe('done');
    // a started (the start of a stage), b took the shell turn, and the explore turn after it stayed on b: explore has no floor.
    expect(events.map((e) => [e.from.label, e.to.label, e.reason, e.activity])).toEqual([['model-a', 'model-b', 'activity', 'shell']]);
    expect(a.chats()).toHaveLength(1);
    expect(b.chats()).toHaveLength(2);
  });

  it('keeps the model in use for an activity\'s list when it reaches the floor, even if another is first', async () => {
    const a = await server([call('run'), said('done')]);
    const b = await server([said('unused')]);
    const events: PoolSwitch[] = [];
    const scoreOverrides = { floors: { shell: 90 }, models: { 'model-a': { shell: 90.5 }, 'model-b': { shell: 95 } } };
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b'), member(a, 'a')] }, scoreOverrides, tools: [tool('run', 'shell')] }, events);
    expect(r.data).toBe('done');
    expect(events).toEqual([]);
    expect(b.chats()).toHaveLength(0);
  });

  it('a turn that answers a screenshot only runs on a model that takes images', async () => {
    const a = await server([call('snap'), said('should not be asked')]);
    const b = await server([said('seen')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a', { images: false }), fallbacks: [member(b, 'b', { images: true })], tools: [tool('snap', 'screen', true)] }, events);
    expect(r.data).toBe('seen');
    expect(a.chats()).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'activity', activity: 'screen' });
    const sent = JSON.stringify(messagesOf(b, 0));
    expect(sent).toContain('image_url');
  });

  it('an image from a tool with no tag is a screen turn too: a model known not to see is not asked', async () => {
    const a = await server([call('snap'), said('a should not answer')]);
    const b = await server([said('seen')]);
    const r = await run({ primary: member(a, 'a', { images: false }), fallbacks: [member(b, 'b', { images: true })], tools: [tool('snap', undefined, true)] });
    expect(r.data).toBe('seen');
    expect(a.chats()).toHaveLength(1);
  });

  it('a pool where nobody sees falls back to the role\'s list and strips the picture', async () => {
    const a = await server([call('snap'), said('a answered')]);
    const b = await server([said('unused')]);
    const r = await run({ primary: member(a, 'a', { images: false }), fallbacks: [member(b, 'b', { images: false })], tools: [tool('snap', 'screen', true)] });
    expect(r.data).toBe('a answered');
    expect(JSON.stringify(messagesOf(a, 1))).not.toContain('"image_url"');
    expect(b.chats()).toHaveLength(0);
  });

  it('a sub-agent shares the pool: the model that took over for the parent is the one the sub-agent works on', async () => {
    const a = await server([toolStep([{ id: 'call_agent', name: 'Agent', args: { prompt: 'dig' } }], { usageTokens: [10, 2] }), BUSY]);
    const b = await server([said('sub result'), said('parent final')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], over: { allowedTools: ['Agent'] } }, events);
    expect(r.data).toBe('parent final');
    // The sub-agent's first turn went to a, which was busy; b answered it and went on to answer the parent.
    expect(events).toMatchObject([{ from: { label: 'model-a' }, to: { label: 'model-b' }, activity: 'explore' }]);
    expect(a.chats()).toHaveLength(2);
    expect(b.chats()).toHaveLength(2);
  });
});

describe('the way a pool is used', () => {
  // a is the model in use; b is the list of shell and a spare.
  const lists = (b: PoolMember) => ({ fallbacks: [b], activities: { shell: [b] } as Partial<Record<Activity, PoolMember[]>> });

  it('fallback: a turn of shell with a list of shell stays on the model in use, and the other list is never used', async () => {
    const a = await server([call('run'), said('done')]);
    const b = await server([said('unused')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), ...lists(member(b, 'b')), mode: 'fallback', tools: [tool('run', 'shell')] }, events);
    expect(r.data).toBe('done');
    expect(events).toEqual([]);
    expect(a.chats()).toHaveLength(2);
    expect(b.chats()).toHaveLength(0);
  });

  it('fallback: a busy model passes the call to a spare, as in every mode', async () => {
    const a = await server([call('run'), BUSY]);
    const b = await server([said('done')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), ...lists(member(b, 'b')), mode: 'fallback', tools: [tool('run', 'shell')] }, events);
    expect(r.data).toBe('done');
    expect(events.map((e) => [e.from.label, e.to.label, e.reason])).toEqual([['model-a', 'model-b', 'rate_limit']]);
  });

  it('fallback: the spare that took over stays, and the list of an activity is not consulted when it is back', async () => {
    const a = await server([call('run'), BUSY]);
    const b = await server([call('look'), said('done')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], activities: { shell: [member(a, 'a')] }, mode: 'fallback', tools: [tool('run', 'shell'), tool('look', 'explore')] }, events);
    expect(r.data).toBe('done');
    expect(events).toHaveLength(1);
    expect(a.chats()).toHaveLength(2);
  });

  it('fallback: a turn that answers a screenshot never goes to a model known not to see, even when it is the one in use', async () => {
    const a = await server([call('snap'), said('a should not answer')]);
    const b = await server([said('seen')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a', { images: false }), fallbacks: [member(b, 'b', { images: true })], activities: { shell: [member(a, 'a')] }, mode: 'fallback', tools: [tool('snap', 'screen', true)] }, events);
    expect(r.data).toBe('seen');
    expect(events[0]).toMatchObject({ reason: 'activity', activity: 'screen' });
    expect(a.chats()).toHaveLength(1);
  });

  it('fallback: the role\'s own list for the start of a stage (write) is the one the model in use belongs to', async () => {
    const a = await server([said('unused')]);
    const b = await server([said('done')]);
    const events: PoolSwitch[] = [];
    // The list of write puts b first; a, the model the call started on, is not in it: the first that is not resting answers.
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], activities: { write: [member(b, 'b')], shell: [member(a, 'a')] }, mode: 'fallback' }, events);
    expect(r.data).toBe('done');
    expect(a.chats()).toHaveLength(0);
  });

  it('delegate keeps the main model fixed like fallback: no switch by activity', async () => {
    const a = await server([call('run'), call('look'), said('done')]);
    const b = await server([said('unused')]);
    const events: PoolSwitch[] = [];
    const r = await run({ primary: member(a, 'a'), ...lists(member(b, 'b')), mode: 'delegate', tools: [tool('run', 'shell'), tool('look', 'explore')] }, events);
    expect(r.data).toBe('done');
    expect(events).toEqual([]);
    expect(b.chats()).toHaveLength(0);
  });

  it('switch is what a pool did before the modes: each turn goes to the list of its activity', async () => {
    for (const mode of ['switch', undefined] as const) {
      restRegistry.clear();
      const a = await server([call('run'), said('done')]);
      const b = await server([call('look')]);
      const events: PoolSwitch[] = [];
      const r = await run({ primary: member(a, 'a'), activities: { shell: [member(b, 'b')] }, mode, tools: [tool('run', 'shell'), tool('look', 'explore')] }, events);
      expect(r.data).toBe('done');
      expect(events.map((e) => [e.from.label, e.to.label, e.activity])).toEqual([['model-a', 'model-b', 'shell'], ['model-b', 'model-a', 'explore']]);
    }
  });

  it('switch and delegate without a list for explore, edit, shell or screen are a fallback: the model in use stays on the write list', async () => {
    for (const mode of ['switch', 'delegate'] as const) {
      restRegistry.clear();
      const a = await server([call('run'), said('done')]);
      const b = await server([said('unused')]);
      const events: PoolSwitch[] = [];
      const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b')], activities: { write: [member(a, 'a'), member(b, 'b')] }, mode, tools: [tool('run', 'shell')] }, events);
      expect(r.data).toBe('done');
      expect(events).toEqual([]);
    }
  });

  it('a lone model with lists of activities only is still a straight pass', async () => {
    const a = await server([call('run'), said('done')]);
    const r = await run({ primary: member(a, 'a'), activities: { shell: [member(a, 'a')] }, mode: 'delegate', tools: [tool('run', 'shell')] });
    expect(r.data).toBe('done');
    expect(a.chats()).toHaveLength(2);
  });
});

describe('a spare that cannot use tools', () => {
  it('is left out of the session, and the next one answers', async () => {
    const a = await server([call('look'), BUSY]);
    const b = await server([errorStep(400, 'registry.example/model-b does not support tools')]);
    const c = await server([said('c done')]);
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b'), member(c, 'c')], tools: [tool('look', 'explore')] });
    expect(r.data).toBe('c done');
    expect(b.chats()).toHaveLength(1);
    expect(c.chats()).toHaveLength(1);
  });

  it('a member known not to do tools is not asked in a session that has them', async () => {
    const a = await server([BUSY]);
    const b = await server([said('should not be asked')]);
    const c = await server([said('c done')]);
    const r = await run({ primary: member(a, 'a'), fallbacks: [member(b, 'b', { tools: false }), member(c, 'c')], tools: [tool('look', 'explore')] });
    expect(r.data).toBe('c done');
    expect(b.chats()).toHaveLength(0);
  });
});

describe('the reasoning of a model', () => {
  const think = (name: string, reasoning: string): Step => toolStep([{ id: `call_${name}`, name: 'look', args: {} }], { usageTokens: [10, 2] }) && ({ ...toolStep([{ id: `call_${name}`, name: 'look', args: {} }], { usageTokens: [10, 2] }), chunks: [{ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] }, ...(toolStep([{ id: `call_${name}`, name: 'look', args: {} }], { usageTokens: [10, 2] }) as { chunks: object[] }).chunks] } as Step);

  it('is sent back to the model that wrote it, from the first call when the entry says so', async () => {
    const a = await server([think('a', 'thought of a'), said('done')]);
    const r = await run({ primary: member(a, 'a', {}, { echoReasoning: true }), tools: [tool('look', 'explore')] });
    expect(r.data).toBe('done');
    expect(messagesOf(a, 1).find((m) => m.role === 'assistant')?.reasoning_content).toBe('thought of a');
  });

  it('never reaches another model after a switch, even one that echoes; each model gets back only its own', async () => {
    const a = await server([think('a', 'thought of a'), BUSY]);
    const b = await server([think('b', 'thought of b'), said('done')]);
    const r = await run({ primary: member(a, 'a', {}, { echoReasoning: true }), fallbacks: [member(b, 'b', {}, { echoReasoning: true })], tools: [tool('look', 'explore')] });
    expect(r.data).toBe('done');
    // b's first request carries a's turn without a's reasoning; its next one carries its own reasoning and still not a's.
    expect(JSON.stringify(messagesOf(b, 0))).not.toContain('thought of a');
    const last = messagesOf(b, 1).filter((m) => m.role === 'assistant');
    expect(last.map((m) => m.reasoning_content)).toEqual([undefined, 'thought of b']);
  });

});
