// The hand-off of an agent's screen to the person (#178): every state of one hand-off, its two limits, the cases that answer `unavailable`, the order in which the typed
// values reach the mask, the end with no result, and what is left behind (a line, an audit entry, a step, a notice) and what never is. The hub is the real one over a fake
// display; the asks store is the real one; the clock and the timers are ours.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { type PendingAsk, SCREEN_ASKS_EVENT, runKey } from '../src/shared/browser';
import { HANDOFF_ASK_MS, HANDOFF_IDLE_MS, HANDOFF_TEXT_MAX } from '../src/shared/handoff';
import { setLanguage } from '../src/shared/i18n';
import { createScreenAsks } from '../src/main/browser/asks';
import { createMaskSet } from '../src/main/browser/mask';
import type { StepInput } from '../src/main/browser/stepLog';
import { type BeginInput, type CallHandoff, createHandoffService, resultText } from '../src/main/screen/handoff';
import { createScreenHub } from '../src/main/screen/hub';
import { fakeConn } from './helpers/screen';

beforeEach(() => setLanguage('en'));
afterEach(() => vi.restoreAllMocks());

const KEY = 'run:r-1';
const MARKER = 'zq-marker-4821';
const typeText = (text: string) => [...text].flatMap((c) => [{ t: 'key', key: c, down: true }, { t: 'key', key: c, down: false }]);

/** A clock and the timers that hang on it, by hand. */
function fakeClock() {
  const c = { t: 1_700_000_000_000 };
  const timers: { at: number; fn: () => void; live: boolean; ms: number }[] = [];
  return {
    now: () => c.t,
    schedule: (ms: number, fn: () => void) => {
      const timer = { at: c.t + ms, fn, live: true, ms };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    async advance(ms: number) {
      const to = c.t + ms;
      for (;;) {
        const next = timers.filter((x) => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.live = false;
        c.t = Math.max(c.t, next.at);
        next.fn();
        await new Promise((r) => setImmediate(r));
      }
      c.t = to;
    },
    live: (ms?: number) => timers.filter((x) => x.live && (ms === undefined || x.ms === ms)).length,
  };
}

interface Options {
  place?: 'stage' | 'conversation';
  key?: string;
  paths?: BeginInput['paths'];
  noScreen?: boolean;
  notifications?: boolean;
  masks?: boolean;
  about?: string;
}

async function world(o: Options = {}) {
  const clock = fakeClock();
  const conn = fakeConn();
  const lines: { thread: string; stage: string; code: string; params: Record<string, string> }[] = [];
  const hub = createScreenHub({
    enabled: true,
    encoder: { encode: (frame, width) => ({ jpeg: Uint8Array.from([0xff, 0xd8, frame.data[0]]), width, height: width / 2 }) },
    now: clock.now,
    connect: async () => conn,
    schedule: clock.schedule,
    note: (thread, stage, code, params) => lines.push({ thread, stage, code, params }),
  });
  const key = o.key ?? KEY;
  if (!o.noScreen) await hub.open({ key, thread: 'run-r-1', stage: 'qa', agent: 'qa', socket: '/x/X99', kind: 'sandbox' });
  const lists: PendingAsk[][] = [];
  let n = 0;
  const asks = createScreenAsks({ changed: (a) => lists.push(a), newId: () => `ask-${++n}`, now: () => new Date(clock.now()) });
  const audit: Omit<AuditEntry, 'at'>[] = [];
  const steps: { key: string; step: StepInput }[] = [];
  const notices: { title: string; body: string; onClick?: unknown }[] = [];
  const masks = createMaskSet();
  const clocks = { paused: 0, resumed: 0 };
  const service = createHandoffService({
    hub,
    asks,
    say: (thread, stage, code, params) => lines.push({ thread, stage, code, params }),
    audit: (e) => audit.push(e),
    notify: (notice) => notices.push(notice as never),
    ...(o.notifications === undefined ? {} : { notifications: () => o.notifications as boolean }),
    ...(o.masks === false ? {} : { masks: () => masks }),
    step: (k, step) => steps.push({ key: k, step }),
    schedule: clock.schedule,
    now: clock.now,
    newId: () => `ask-${++n}`,
  });
  const abort = new AbortController();
  const place = o.place ?? 'stage';
  const begin = (over: Partial<BeginInput> = {}): CallHandoff =>
    service.begin({
      key,
      thread: 'run-r-1',
      place,
      stage: place === 'stage' ? 'qa' : '',
      issue: 101,
      agent: 'qa',
      agentName: 'QA',
      about: o.about ?? '#123 Fix the form',
      paths: o.paths ?? { browser: true, shell: 'sandbox' },
      pause: () => {
        clocks.paused++;
        return () => void clocks.resumed++;
      },
      signal: abort.signal,
      ...over,
    });
  const take = async (id = 'ask-1') => service.take(key, id);
  /** The asks the person sees. */
  const listed = () => asks.list(key);
  /** The person types through the hub, as the viewer does. */
  const type = async (text: string) => {
    await hub.input(key, typeText(text));
  };
  return { clock, conn, hub, asks, service, audit, steps, notices, masks, clocks, lines, lists, abort, begin, take, listed, type, key };
}

const codes = (w: Awaited<ReturnType<typeof world>>) => w.lines.map((l) => l.code);

describe('the request', () => {
  it('lists a card with the agent\'s words, stops the clocks, says it in the thread, notifies, and refuses nothing yet', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in to the site', why: 'the report is behind a login' });
    expect(w.listed()).toEqual([
      { id: 'ask-1', key: KEY, agent: 'qa', kind: 'handoff', why: 'agent', step: null, site: '', agentWords: 'log in to the site', since: new Date(w.clock.now()).toISOString(), handoff: { why: 'the report is behind a login', taken: false, paths: { browser: true, shell: 'sandbox' } } },
    ]);
    expect(w.lists.at(-1)).toHaveLength(1);
    expect(w.clocks).toEqual({ paused: 1, resumed: 0 });
    expect(w.lines).toEqual([{ thread: 'run-r-1', stage: 'qa', code: 'runner.screen.handoffAsked', params: { agent: 'qa', what: 'log in to the site' } }]);
    expect(call.active()).toBe(false);
    expect(w.hub.held(KEY)).toBe(false);
    expect(w.clock.live(HANDOFF_ASK_MS)).toBe(1);
    w.service.decline('ask-1');
    expect(await p).toBe('declined');
  });

  it('clips and cleans the agent\'s words, and puts them in the card and the thread as plain text', async () => {
    const w = await world();
    const call = w.begin();
    void call.request({ what: `  ${'x'.repeat(500)}\n\nBearer abcdefghijklmnop1234 `, why: '   ' });
    const [card] = w.listed();
    expect(card.agentWords).toHaveLength(HANDOFF_TEXT_MAX);
    expect(card.agentWords).not.toMatch(/\n/);
    expect(card.handoff).not.toHaveProperty('why');
    expect(w.lines[0].params.what).toBe(card.agentWords);
    const w2 = await world();
    void w2.begin().request({ what: 'use Bearer abcdefghijklmnop1234 to log in' });
    expect(w2.listed()[0].agentWords).not.toContain('abcdefghijklmnop1234');
  });

  it('notifies with the app\'s own words and never the agent\'s, opening the run for a stage and the conversation for a call', async () => {
    const stage = await world();
    void stage.begin().request({ what: `${MARKER} secret ask` });
    expect(stage.notices).toHaveLength(1);
    expect(stage.notices[0]).toMatchObject({ title: 'QA is waiting for you', onClick: { type: 'open', screen: { name: 'run', id: 'r-1' } } });
    expect(stage.notices[0].body).toContain('#123 Fix the form');
    expect(JSON.stringify(stage.notices)).not.toContain(MARKER);
    const chat = await world({ key: 'call:team-chat:qa', place: 'conversation', about: '' });
    void chat.begin({ thread: 'team-chat' }).request({ what: 'log in' });
    expect(chat.notices[0]).toMatchObject({ onClick: { type: 'open', screen: { name: 'forum', id: 'team-chat', thread: 'team-chat' } } });
    expect(chat.notices[0].body).not.toContain('{about}');
    expect(chat.lines[0]).toMatchObject({ thread: 'team-chat', stage: '' });
  });

  it('honours the notifications setting', async () => {
    const off = await world({ notifications: false });
    void off.begin().request({ what: 'log in' });
    expect(off.notices).toEqual([]);
    const on = await world({ notifications: true });
    void on.begin().request({ what: 'log in' });
    expect(on.notices).toHaveLength(1);
  });

  it('does not let a failing notice, line or audit decide the answer', async () => {
    const w = await world();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createHandoffService({
      hub: w.hub,
      asks: w.asks,
      say: () => { throw new Error('boom'); },
      notify: () => { throw new Error('boom'); },
      audit: () => { throw new Error('boom'); },
      step: () => { throw new Error('boom'); },
      schedule: w.clock.schedule,
      newId: () => 'ask-1',
    });
    const call = service.begin({ key: KEY, thread: 'run-r-1', place: 'stage', stage: 'qa', agent: 'qa', agentName: 'QA', about: '', paths: { browser: true, shell: 'none' }, pause: () => () => undefined, signal: w.abort.signal });
    const p = call.request({ what: 'log in' });
    service.decline('ask-1');
    expect(await p).toBe('declined');
  });
});

describe('the results', () => {
  it('are four fixed sentences that carry nothing else', () => {
    expect([resultText('done'), resultText('declined'), resultText('expired'), resultText('unavailable')]).toEqual([
      'The person finished and gave the screen back.',
      'The person did not want to hand the screen over.',
      'The person did not respond in time.',
      'The screen is not available.',
    ]);
  });

  it('answers declined when the person declines, writes the line and the audit entry, and takes the card away', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    expect(w.service.decline('ask-1')).toEqual({ ok: true });
    expect(await p).toBe('declined');
    expect(w.listed()).toEqual([]);
    expect(codes(w)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffDeclined']);
    expect(w.audit).toHaveLength(1);
    expect(w.audit[0]).toMatchObject({ kind: 'screen-handoff', via: 'sandbox', ok: false, result: 'declined', fields: { agent: 'qa', place: 'stage', what: 'log in', outcome: 'declined', from: '', to: '' }, issue: 101 });
    expect(w.clocks).toEqual({ paused: 1, resumed: 1 });
    expect(w.hub.held(KEY)).toBe(false);
  });

  it('answers done after a take and a give back, in that order, with one line for the interval and none for a burst', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    expect(await w.take()).toEqual({ ok: true });
    expect(call.active()).toBe(true);
    expect(w.hub.state(KEY)?.control).toBe(true);
    await w.hub.input(KEY, [{ t: 'move', x: 1, y: 1 }]);
    w.clock.now();
    expect(w.service.give(KEY)).toEqual({ ok: true });
    expect(await p).toBe('done');
    expect(call.active()).toBe(false);
    expect(codes(w)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffTaken', 'runner.screen.handoffUsed', 'runner.screen.handoffBack']);
    expect(w.audit[0]).toMatchObject({ ok: true, result: 'done', fields: { outcome: 'done', from: expect.stringMatching(/^2023|^20/), to: expect.stringMatching(/^20/) } });
    expect(w.clocks).toEqual({ paused: 1, resumed: 1 });
    expect(w.hub.state(KEY)?.control).toBe(false);
    expect(w.listed()).toEqual([]);
  });

  it('answers expired after 15 minutes without the screen being taken, fails nothing, and stops the agent from asking again', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.clock.advance(HANDOFF_ASK_MS - 1);
    expect(w.listed()).toHaveLength(1);
    await w.clock.advance(1);
    expect(await p).toBe('expired');
    expect(w.listed()).toEqual([]);
    expect(codes(w)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffExpired']);
    expect(w.audit[0]).toMatchObject({ result: 'expired', ok: false });
    expect(w.clocks).toEqual({ paused: 1, resumed: 1 });
    expect(await call.request({ what: 'again' })).toBe('unavailable');
    expect(w.listed()).toEqual([]);
  });

  it('answers expired after 30 minutes without input once taken, with control off, the keys up and the interval closed; each delivered event restarts it', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    // The 15-minute limit is gone once the screen is taken.
    expect(w.clock.live(HANDOFF_ASK_MS)).toBe(0);
    await w.clock.advance(HANDOFF_IDLE_MS - 1000);
    await w.hub.input(KEY, [{ t: 'key', key: 'A', down: true }]);
    await w.clock.advance(HANDOFF_IDLE_MS - 1000);
    expect(w.hub.held(KEY)).toBe(true);
    w.conn.sent.length = 0;
    await w.clock.advance(1000);
    expect(await p).toBe('expired');
    expect(w.hub.held(KEY)).toBe(false);
    expect(w.hub.state(KEY)?.control).toBe(false);
    // The held key was put up before the interval closed.
    expect(w.conn.sent.flat().some((e) => e.type === 'key' && !e.down)).toBe(true);
    expect(call.active()).toBe(false);
    expect(codes(w)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffTaken', 'runner.screen.handoffUsed', 'runner.screen.handoffExpired']);
    expect(w.hub.state(KEY)).not.toBeNull();
    expect(await call.request({ what: 'again' })).toBe('unavailable');
  });

  it('does not restart the idle limit for an event that was not delivered', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.clock.advance(HANDOFF_IDLE_MS - 1000);
    w.conn.failInput = true;
    await w.hub.input(KEY, [{ t: 'move', x: 1, y: 1 }]);
    await w.clock.advance(1000);
    expect(await p).toBe('expired');
  });
});

describe('what answers unavailable', () => {
  it('a screen that is not there, a second request while one is open, and one after a decline or an expiry in the same call', async () => {
    const none = await world({ noScreen: true });
    expect(await none.begin().request({ what: 'log in' })).toBe('unavailable');
    expect(none.listed()).toEqual([]);
    expect(none.lines).toEqual([]);

    const w = await world();
    const call = w.begin();
    const first = call.request({ what: 'log in' });
    expect(await call.request({ what: 'another' })).toBe('unavailable');
    // Another call on the same screen cannot open a second one either.
    expect(await w.begin().request({ what: 'another' })).toBe('unavailable');
    expect(w.listed()).toHaveLength(1);
    w.service.decline('ask-1');
    expect(await first).toBe('declined');
    expect(await call.request({ what: 'once more' })).toBe('unavailable');
    expect(w.listed()).toEqual([]);
    // A new call is a new attempt: it may ask.
    const next = w.begin();
    const again = next.request({ what: 'a new attempt' });
    expect(w.listed()).toHaveLength(1);
    w.service.decline('ask-2');
    expect(await again).toBe('declined');
  });

  it('a request after done is accepted: a second site, a second code', async () => {
    const w = await world();
    const call = w.begin();
    const a = call.request({ what: 'log in' });
    await w.take();
    w.service.give(KEY);
    expect(await a).toBe('done');
    const b = call.request({ what: 'type the code' });
    expect(w.listed()).toHaveLength(1);
    expect(w.listed()[0].id).toBe('ask-2');
    await w.take('ask-2');
    w.service.give(KEY);
    expect(await b).toBe('done');
    expect(w.audit.map((e) => e.result)).toEqual(['done', 'done']);
  });

  it('an empty ask', async () => {
    const w = await world();
    expect(await w.begin().request({ what: '   ' })).toBe('unavailable');
    expect(w.listed()).toEqual([]);
  });

  it('the screen going away at the moment the person takes it', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    w.hub.end(KEY);
    expect(await w.take()).toEqual({ ok: false, reason: 'none' });
    expect(await p).toBe('unavailable');
    expect(call.active()).toBe(false);
    expect(w.listed()).toEqual([]);
  });

  it('a request still waiting when its screen ends, and a display that is lost while the person has it', async () => {
    const w = await world();
    const p = w.begin().request({ what: 'log in' });
    w.service.closed(KEY);
    expect(await p).toBe('unavailable');
    expect(w.listed()).toEqual([]);

    const lost = await world();
    const call = lost.begin();
    const q = call.request({ what: 'log in' });
    await lost.take();
    lost.conn.close();
    expect(await q).toBe('unavailable');
    expect(call.active()).toBe(false);
    expect(lost.clocks).toEqual({ paused: 1, resumed: 1 });
  });
});

describe('the person\'s moves', () => {
  it('cannot take what is not asked, take it twice, or decline what they hold', async () => {
    const w = await world();
    const call = w.begin();
    expect(await w.take('ask-9')).toEqual({ ok: false, reason: 'gone' });
    expect(w.service.give(KEY)).toEqual({ ok: false, reason: 'gone' });
    expect(w.service.decline('ask-9')).toEqual({ ok: false, reason: 'gone' });
    const p = call.request({ what: 'log in' });
    expect(await w.service.take('run:other', 'ask-1')).toEqual({ ok: false, reason: 'gone' });
    expect(await w.take()).toEqual({ ok: true });
    expect(await w.take()).toEqual({ ok: false, reason: 'taken' });
    expect(w.service.decline('ask-1')).toEqual({ ok: false, reason: 'taken' });
    w.service.give(KEY);
    expect(await p).toBe('done');
    expect(w.service.give(KEY)).toEqual({ ok: false, reason: 'gone' });
  });

  it('takes a bare run id as the stage\'s screen, as the hub does', async () => {
    const w = await world();
    const p = w.begin().request({ what: 'log in' });
    expect(await w.service.take('r-1', 'ask-1')).toEqual({ ok: true });
    expect(w.service.give('r-1')).toEqual({ ok: true });
    expect(await p).toBe('done');
    expect(runKey('r-1')).toBe(KEY);
  });

  it('withholds the screen from a paired browser before control is on, and marks the card as taken', async () => {
    const w = await world();
    void w.begin().request({ what: 'log in' });
    const taking = w.take();
    // Nothing has awaited yet: the interval is already open and the screen is withheld before the control that follows it runs.
    expect(w.hub.held(KEY)).toBe(true);
    expect(await w.hub.frame(KEY, 0, 640)).toEqual({ state: 'held' });
    await taking;
    expect(w.listed()[0].handoff?.taken).toBe(true);
    expect(w.lists.at(-1)?.[0].handoff?.taken).toBe(true);
  });

  it('leaves the window\'s own pictures to the person who holds the screen', async () => {
    const w = await world();
    void w.begin().request({ what: 'log in' });
    await w.take();
    expect(await w.hub.frame(KEY, 0, 640)).toEqual({ state: 'held' });
    expect(await w.hub.frame(KEY, 0, 640, 'person')).toMatchObject({ state: 'frame' });
  });
});

describe('the typed values', () => {
  it('reach the mask and the call before the gate opens and before the agent is answered, so no read can race them', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.type(MARKER);
    const seen: { active: boolean; hits: boolean; masked: string | null }[] = [];
    void p.then(() => seen.push({ active: call.active(), hits: call.typed.hits(MARKER), masked: w.masks.apply(`page ${MARKER}`) }));
    w.service.give(KEY);
    expect(await p).toBe('done');
    expect(seen).toEqual([{ active: false, hits: true, masked: 'page [secret]' }]);
    // The gate was closed when the values arrived: the shell's output is masked from the first command after.
    expect(call.typed.mask(`out ${MARKER}`)).toBe('out [secret]');
    expect(call.typed.had).toBe(true);
    expect(w.service.hadHandoff(KEY)).toBe(true);
  });

  it('are given to the call and put on the mask while the gate is still shut, whichever way the interval ends', async () => {
    for (const how of ['give', 'expire', 'abort', 'end'] as const) {
      const w = await world();
      const call = w.begin();
      const order: string[] = [];
      const add = call.typed.add.bind(call.typed);
      vi.spyOn(call.typed, 'add').mockImplementation((values) => (order.push(`values:${call.active() ? 'gate shut' : 'gate open'}`), add(values)));
      const addMask = w.masks.add.bind(w.masks);
      vi.spyOn(w.masks, 'add').mockImplementation((mask) => (order.push(`mask:${call.active() ? 'gate shut' : 'gate open'}`), addMask(mask)));
      const p = call.request({ what: 'log in' });
      await w.take();
      await w.type(MARKER);
      void p.then(() => order.push(`answered:${call.active() ? 'gate shut' : 'gate open'}`));
      if (how === 'give') w.service.give(KEY);
      else if (how === 'expire') await w.clock.advance(HANDOFF_IDLE_MS);
      else if (how === 'abort') w.abort.abort();
      else call.end();
      await p;
      await new Promise((r) => setImmediate(r));
      expect(order, how).toEqual(['values:gate shut', 'mask:gate shut', 'answered:gate open']);
    }
  });

  it('a value of fewer than 4 characters is not masked, and the call still says it had a hand-off', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'type the code' });
    await w.take();
    await w.type('123');
    w.service.give(KEY);
    await p;
    expect(w.masks.apply('code 123')).toBe('code 123');
    expect(call.typed.had).toBe(true);
  });

  it('stay for the rest of the call, are gone when it ends, and what remains is that there was a hand-off', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.type(MARKER);
    w.service.give(KEY);
    await p;
    expect(w.masks.size).toBe(1);
    expect(call.typed.hits(MARKER)).toBe(true);
    call.end();
    expect(w.masks.size).toBe(0);
    expect(call.typed.hits(MARKER)).toBe(false);
    expect(w.masks.apply(MARKER)).toBe(MARKER);
    expect(call.typed.had).toBe(true);
    expect(w.service.hadHandoff(KEY)).toBe(true);
    w.service.forget(KEY);
    expect(w.service.hadHandoff(KEY)).toBe(false);
    // One mask for the call however many intervals it had.
    const two = await world();
    const c2 = two.begin();
    const a = c2.request({ what: 'log in' });
    await two.take();
    two.service.give(KEY);
    await a;
    const b = c2.request({ what: 'the code' });
    await two.take('ask-2');
    two.service.give(KEY);
    await b;
    expect(two.masks.size).toBe(1);
  });

  it('are collected for a screen with no app browser too: the shell\'s mask works without a mask set', async () => {
    const w = await world({ masks: false });
    const call = w.begin({ paths: { browser: false, shell: 'host' } });
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.type(MARKER);
    w.service.give(KEY);
    await p;
    expect(call.typed.mask(`out ${MARKER}`)).toBe('out [secret]');
    expect(w.audit[0].via).toBe('host');
  });

  it('are in nothing the app writes: no line, audit entry, step, notice, card, result or console line', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.type(MARKER);
    await w.hub.input(KEY, [{ t: 'key', key: 'Tab', down: true }, ...typeText('another-4821-value')]);
    w.service.give(KEY);
    const result = await p;
    await w.clock.advance(60_000);
    const everything = JSON.stringify({ result, lines: w.lines, audit: w.audit, steps: w.steps, notices: w.notices, lists: w.lists, listed: w.listed(), errors: errors.mock.calls });
    expect(everything).not.toContain(MARKER);
    expect(everything).not.toContain('another-4821-value');
    expect(everything).not.toMatch(/marker|4821/);
    // The thread has exactly the lines of the spec: asked, taken, the one interval line, back.
    expect(codes(w)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffTaken', 'runner.screen.handoffUsed', 'runner.screen.handoffBack']);
  });
});

describe('the end with no result', () => {
  it('the call\'s abort while the person is asked removes the card, resumes the clocks and gives no result', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    w.abort.abort();
    expect(await p).toBeNull();
    expect(w.listed()).toEqual([]);
    expect(w.clocks).toEqual({ paused: 1, resumed: 1 });
    expect(codes(w)).toEqual(['runner.screen.handoffAsked']);
    expect(w.audit[0]).toMatchObject({ result: 'aborted', ok: false, fields: { outcome: 'aborted' } });
    expect(w.clock.live()).toBe(0);
    expect(await call.request({ what: 'after' })).toBeNull();
  });

  it('the abort while the person holds the screen ends the interval, keeps its values for the mask and gives no result', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.type(MARKER);
    w.abort.abort();
    expect(await p).toBeNull();
    expect(w.hub.held(KEY)).toBe(false);
    expect(call.active()).toBe(false);
    expect(w.masks.apply(MARKER)).toBe('[secret]');
    expect(w.audit[0]).toMatchObject({ result: 'aborted', fields: { outcome: 'aborted' } });
    expect(w.audit[0].fields.from).not.toBe('');
    expect(codes(w)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffTaken', 'runner.screen.handoffUsed']);
  });

  it('the end of the call does the same, takes the mask off and forgets the values', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.type(MARKER);
    call.end();
    expect(await p).toBeNull();
    expect(w.hub.held(KEY)).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(w.masks.size).toBe(0);
    expect(call.typed.hits(MARKER)).toBe(false);
    expect(w.clocks).toEqual({ paused: 1, resumed: 1 });
    call.end();
  });

  it('the end of the stage with the screen held by the person gives no result and leaves nothing running', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    await w.hub.finish(KEY);
    expect(await p).toBeNull();
    expect(call.active()).toBe(false);
    expect(w.clock.live()).toBe(0);
    expect(w.listed()).toEqual([]);
  });

  it('ends once however many ways ask for it', async () => {
    const w = await world();
    const call = w.begin();
    const p = call.request({ what: 'log in' });
    await w.take();
    w.service.give(KEY);
    w.service.give(KEY);
    w.abort.abort();
    call.end();
    await w.clock.advance(HANDOFF_IDLE_MS);
    expect(await p).toBe('done');
    expect(w.audit).toHaveLength(1);
    expect(w.steps).toHaveLength(1);
    expect(w.clocks).toEqual({ paused: 1, resumed: 1 });
  });
});

describe('what is left behind', () => {
  it('one step for each hand-off, with no name and no site, and the outcome as the step records it', async () => {
    const outcomes: [string, (w: Awaited<ReturnType<typeof world>>, call: CallHandoff) => Promise<void> | void][] = [
      ['ok', async (w) => (await w.take(), void w.service.give(KEY))],
      ['declined', (w) => void w.service.decline('ask-1')],
      ['declined', (w) => void w.clock.advance(HANDOFF_ASK_MS)],
      ['not-run', (w) => void w.abort.abort()],
    ];
    for (const [outcome, act] of outcomes) {
      const w = await world();
      const call = w.begin();
      const p = call.request({ what: 'log in' });
      await act(w, call);
      await p;
      expect(w.steps).toHaveLength(1);
      expect(w.steps[0].key).toBe(KEY);
      expect(w.steps[0].step).toMatchObject({ tool: 'screen_handoff', class: 'free', outcome, site: '', path: '' });
      expect(w.steps[0].step).not.toHaveProperty('name');
      expect(w.steps[0].step).not.toHaveProperty('key');
      expect(w.steps[0].step).not.toHaveProperty('reason');
    }
  });

  it('the audit entry says who, where, what was asked, how it ended and from when to when, and where the commands run', async () => {
    const w = await world({ paths: { browser: false, shell: 'host' } });
    const p = w.begin().request({ what: 'log in' });
    await w.take();
    await w.clock.advance(5 * 60_000);
    w.service.give(KEY);
    await p;
    expect(w.audit).toEqual([
      {
        issue: 101,
        origin: { actionId: '', kind: 'screen', key: KEY, summary: null },
        by: 'qa',
        kind: 'screen-handoff',
        target: `screen:${KEY}`,
        via: 'host',
        fields: { agent: 'qa', place: 'stage', what: 'log in', outcome: 'done', from: new Date(1_700_000_000_000).toISOString(), to: new Date(1_700_000_000_000 + 5 * 60_000).toISOString() },
        ok: true,
        code: null,
        result: 'done',
      },
    ]);
  });

  it('a conversation\'s hand-off writes in the conversation\'s thread, with no stage', async () => {
    const w = await world({ key: 'call:team-chat:qa', place: 'conversation' });
    const p = w.begin({ thread: 'team-chat', issue: undefined }).request({ what: 'log in' });
    w.service.decline('ask-1');
    await p;
    expect(w.lines.every((l) => l.thread === 'team-chat' && l.stage === '')).toBe(true);
    expect(w.audit[0]).toMatchObject({ fields: { place: 'conversation' }, issue: 0 });
  });
});

describe('the pause of the clocks', () => {
  it('lasts the whole hand-off, asked and held, and is given back with what was left however it ends', async () => {
    for (const how of ['decline', 'expire', 'give', 'abort'] as const) {
      const w = await world();
      const call = w.begin();
      const p = call.request({ what: 'log in' });
      expect(w.clocks).toEqual({ paused: 1, resumed: 0 });
      if (how === 'give') {
        await w.take();
        expect(w.clocks).toEqual({ paused: 1, resumed: 0 });
        w.service.give(KEY);
      } else if (how === 'decline') w.service.decline('ask-1');
      else if (how === 'expire') await w.clock.advance(HANDOFF_ASK_MS);
      else w.abort.abort();
      await p;
      expect(w.clocks, how).toEqual({ paused: 1, resumed: 1 });
    }
  });
});

describe('what it does not do', () => {
  it('writes nothing to the disk, the console or the network', () => {
    for (const file of ['handoff.ts', 'typedValues.ts']) {
      const src = readFileSync(join(__dirname, '..', 'src', 'main', 'screen', file), 'utf8');
      expect(src, file).not.toMatch(/node:fs|from 'fs'|writeFile|appendFile|createWriteStream|fetch\(|node:net|node:http/);
    }
  });

  it('is the list that carries a request: the asks store holds no promise for it and refuses an answer to it', async () => {
    const w = await world();
    void w.begin().request({ what: 'log in' });
    expect(() => w.asks.answer('ask-1', 'yes', 'window')).toThrow();
    expect(w.listed()).toHaveLength(1);
    expect(SCREEN_ASKS_EVENT).toBe('screen-asks');
  });
});
