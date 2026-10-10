// The questions the screen asks the person: a held step and a confirmation. The store has the shape of the command store of the ceremonies (waits, times out as declined, is
// listed and published), every answer is audited, and only a step the app could not read can be passed for the rest of the screen on its site.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_TIMEOUT_MS, type PendingAsk } from '../src/shared/browser';
import type { AuditEntry } from '../src/shared/auditoria';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import { AskGone, MAX_PENDING_PER_SCREEN, type HoldAsk, askNotice, createScreenAsks, describeStep } from '../src/main/browser/asks';
import { createHostsTally } from '../src/main/browser/hosts';
import { createIntermediary } from '../src/main/browser/intermediary';
import { createMaskSet } from '../src/main/browser/mask';
import { createStepLog } from '../src/main/browser/stepLog';
import { fakeServer } from './helpers/browserServer';

type Entry = Omit<AuditEntry, 'at'>;

let audit: Entry[];
let changes: PendingAsk[][];
let told: PendingAsk[];
let n = 0;

beforeEach(() => {
  setLanguage('en');
  audit = [];
  changes = [];
  told = [];
  n = 0;
});
afterEach(() => vi.useRealTimers());

const make = (over: Partial<Parameters<typeof createScreenAsks>[0]> = {}) =>
  createScreenAsks({ changed: (a) => changes.push(a), asked: (a) => told.push(a), audit: (e) => audit.push(e), newId: () => `ask-${++n}`, now: () => new Date('2026-10-09T10:00:00Z'), ...over });

const ctx = { key: 'call:thread-1:coder', agent: 'coder', place: 'conversation' as const };
const submit: HoldAsk = { ...ctx, why: 'submit', step: { action: 'click', role: 'button', name: 'Send', submit: true }, site: 'example.com', agentWords: 'to send the report' };
const unread: HoldAsk = { ...ctx, why: 'unclassified', step: { action: 'drag' }, site: 'example.com' };

describe('a held step', () => {
  it('waits for the person, is listed and published, and tells the app so it can notify', async () => {
    const asks = make();
    const p = asks.hold(submit);
    expect(asks.list()).toEqual([{ id: 'ask-1', key: ctx.key, agent: 'coder', kind: 'hold', why: 'submit', step: submit.step, site: 'example.com', agentWords: 'to send the report', since: '2026-10-09T10:00:00.000Z' }]);
    expect(told.map((a) => a.id)).toEqual(['ask-1']);
    expect(changes).toHaveLength(1);
    expect(asks.list('call:other:coder')).toEqual([]);
    asks.answer('ask-1', 'yes', 'window');
    expect(await p).toEqual({ answer: 'yes' });
    expect(asks.list()).toEqual([]);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual([]);
  });

  it('is audited with who answered and through what, with the step in words and no value', async () => {
    const asks = make();
    const yes = asks.hold(submit);
    asks.answer('ask-1', 'yes', 'paired');
    await yes;
    const no = asks.hold({ ...submit, agentWords: undefined });
    asks.answer('ask-2', 'no', 'window', 'not now');
    expect(await no).toEqual({ answer: 'no', note: 'not now' });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ kind: 'screen-hold', by: 'coder', via: 'paired', ok: true, target: `screen:${ctx.key}`, fields: { why: 'submit', site: 'example.com', answer: 'yes', through: 'paired', agentWords: 'to send the report' } });
    expect(audit[0].fields?.step).toBe('click the button “Send”, which sends a form on example.com');
    expect(audit[1]).toMatchObject({ kind: 'screen-hold', via: 'window', ok: false, fields: { answer: 'no', through: 'window' } });
    expect(audit[1].fields).not.toHaveProperty('agentWords');
  });

  it('counts as declined after 15 minutes, audited as nobody having answered', async () => {
    vi.useFakeTimers();
    const asks = make();
    const p = asks.hold(submit);
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS - 1000);
    expect(asks.list()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ answer: 'timeout' });
    expect(asks.list()).toEqual([]);
    expect(audit[0]).toMatchObject({ via: 'none', ok: false, fields: { answer: 'timeout', through: 'none' } });
  });

  it('is declined as closed when its call is stopped, and never waits when it was stopped already', async () => {
    const asks = make();
    const ac = new AbortController();
    const p = asks.hold(submit, ac.signal);
    ac.abort();
    expect(await p).toEqual({ answer: 'closed' });
    expect(asks.list()).toEqual([]);
    expect(await asks.hold(submit, ac.signal)).toEqual({ answer: 'closed' });
    expect(asks.list()).toEqual([]);
    expect(audit.map((e) => e.fields?.answer)).toEqual(['closed']);
  });

  it('is declined when its screen closes, and only that screen\'s', async () => {
    const asks = make();
    const a = asks.hold(submit);
    const b = asks.hold({ ...submit, key: 'run:7' });
    expect(asks.declineAll(ctx.key)).toBe(1);
    expect(await a).toEqual({ answer: 'closed' });
    expect(asks.list().map((x) => x.key)).toEqual(['run:7']);
    asks.declineAll('run:7');
    expect(await b).toEqual({ answer: 'closed' });
    expect(asks.declineAll('call:nothing:coder')).toBe(0);
  });

  it('answers once: a second answer, an unknown question and an unknown decision fail', async () => {
    const asks = make();
    const p = asks.hold(submit);
    expect(() => asks.answer('ask-1', 'maybe' as never, 'window')).toThrow(/unknown decision/);
    asks.answer('ask-1', 'no', 'window');
    await p;
    expect(() => asks.answer('ask-1', 'yes', 'window')).toThrow(AskGone);
    expect(() => asks.answer('nope', 'yes', 'window')).toThrow(AskGone);
  });

  it('stands the clocks still while it waits, and starts them again however it ends', async () => {
    vi.useFakeTimers();
    const asks = make();
    let paused = 0;
    let resumed = 0;
    const pause = () => {
      paused++;
      return () => void resumed++;
    };
    const a = asks.hold({ ...submit, pause });
    expect([paused, resumed]).toEqual([1, 0]);
    asks.answer('ask-1', 'yes', 'window');
    await a;
    const b = asks.hold({ ...submit, pause });
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS + 10);
    await b;
    const ac = new AbortController();
    const c = asks.hold({ ...submit, pause }, ac.signal);
    ac.abort();
    await c;
    expect([paused, resumed]).toEqual([3, 3]);
  });

  it('declines a flood: a screen has so many questions waiting and no more', async () => {
    const asks = make();
    for (let i = 0; i < MAX_PENDING_PER_SCREEN; i++) void asks.hold(submit);
    expect(await asks.hold(submit)).toEqual({ answer: 'no' });
    expect(asks.list()).toHaveLength(MAX_PENDING_PER_SCREEN);
    void asks.hold({ ...submit, key: 'run:7' });
    expect(asks.list('run:7')).toHaveLength(1);
  });
});

describe('a pass for the rest of the screen on its site', () => {
  it('is given only for a step the app could not read, and holds for that screen and that site only', async () => {
    const asks = make();
    const p = asks.hold(unread);
    asks.answer('ask-1', 'site', 'window');
    expect(await p).toEqual({ answer: 'site' });
    expect(asks.passed(ctx.key, 'example.com')).toBe(true);
    expect(asks.passed(ctx.key, 'other.example.com')).toBe(false);
    expect(asks.passed('run:7', 'example.com')).toBe(false);
    expect(audit[0].fields?.answer).toBe('site');
    asks.forget(ctx.key);
    expect(asks.passed(ctx.key, 'example.com')).toBe(false);
  });

  it('is a plain yes for a step the app called irreversible, and for a confirmation', async () => {
    const asks = make();
    const a = asks.hold(submit);
    asks.answer('ask-1', 'site', 'window');
    expect(await a).toEqual({ answer: 'yes' });
    const b = asks.confirm({ ...ctx, confirmKind: 'send', words: 'send the invoice', site: 'example.com' });
    asks.answer('ask-2', 'site', 'window');
    expect(await b).toEqual({ answer: 'yes' });
    expect(asks.passed(ctx.key, 'example.com')).toBe(false);
  });

  it('is a plain yes when the site is not known', async () => {
    const asks = make();
    const p = asks.hold({ ...unread, site: '' });
    asks.answer('ask-1', 'site', 'window');
    expect(await p).toEqual({ answer: 'yes' });
    expect(asks.passed(ctx.key, '')).toBe(false);
  });
});

describe('a confirmation the agent asked for', () => {
  it('waits like a held step, says no with the person\'s note, and is audited as the agent\'s words', async () => {
    const asks = make();
    const p = asks.confirm({ ...ctx, confirmKind: 'pay', words: 'pay the invoice of 40 dollars', site: 'https://shop.example.com/cart?id=3' });
    expect(asks.list()[0]).toMatchObject({ kind: 'confirm', why: 'agent', step: null, confirmKind: 'pay', agentWords: 'pay the invoice of 40 dollars' });
    asks.answer('ask-1', 'no', 'window', `wait for the manager ${'x'.repeat(600)}`);
    const r = await p;
    expect(r.answer).toBe('no');
    expect(r.note?.length).toBe(500);
    expect(audit[0]).toMatchObject({ kind: 'screen-confirm', ok: false, fields: { confirmKind: 'pay', agentWords: 'pay the invoice of 40 dollars', site: 'shop.example.com', answer: 'no' } });
    // The audit has a site and not an address.
    expect(JSON.stringify(audit[0])).not.toContain('/cart');
  });

  it('times out as no answer', async () => {
    vi.useFakeTimers();
    const asks = make();
    const p = asks.confirm({ ...ctx, confirmKind: 'other', words: 'something' });
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS + 1);
    expect(await p).toEqual({ answer: 'timeout' });
  });
});

describe('the words of a question', () => {
  it('words a step in both languages from the page\'s role and name, with no value in it', () => {
    setLanguage('en');
    expect(describeStep({ action: 'click', role: 'button', name: 'Delete', word: 'delete' }, 'example.com')).toBe('click the button “Delete”, whose name says “delete” on example.com');
    expect(describeStep({ action: 'press', key: 'Enter', role: 'textbox', name: 'Name', submit: true })).toBe('press Enter in the textbox “Name”, which sends a form');
    expect(describeStep({ action: 'press', key: 'Control+S' })).toBe('press Control+S');
    expect(describeStep({ action: 'drag' })).toBe('drag one element onto another');
    expect(describeStep({ action: 'click', role: 'button' })).toBe('click an element with no name (a button)');
    setLanguage('pt-BR');
    expect(describeStep({ action: 'click', role: 'button', name: 'Enviar', submit: true }, 'example.com')).toBe('clicar em o button “Enviar”, que envia um formulário em example.com');
  });

  it('has a notice for each kind of question, in both languages', () => {
    const hold: PendingAsk = { id: 'a', key: ctx.key, agent: 'coder', kind: 'hold', why: 'submit', step: submit.step, site: 'example.com', since: '' };
    const confirm: PendingAsk = { id: 'b', key: ctx.key, agent: 'coder', kind: 'confirm', why: 'agent', step: null, site: '', agentWords: 'send the invoice', confirmKind: 'send', since: '' };
    setLanguage('en');
    expect(askNotice(hold)).toEqual({ title: 'coder is waiting for your answer', body: 'To click the button “Send”, which sends a form on example.com: it sends a form.' });
    expect(askNotice(confirm).body).toBe('To send: send the invoice');
    setLanguage('pt-BR');
    expect(askNotice(hold).title).toBe('coder espera a sua resposta');
    expect(askNotice(confirm).body).toContain('enviar');
  });

  it('has every key it uses in both catalogs', () => {
    const keys = Object.keys(CATALOGS.en).filter((k) => /^main\.browser\.(step|why|confirmKind|ask)\./.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(CATALOGS['pt-BR'][k], k).toBeTruthy();
    for (const why of ['submit', 'name', 'shortcut', 'dialog', 'unclassified', 'agent']) expect(t(`main.browser.why.${why}`)).not.toBe(`main.browser.why.${why}`);
  });
});

describe('through the intermediary: the three answers, and the pass', () => {
  function rig(timeoutMs?: number) {
    const server = fakeServer();
    const asks = make(timeoutMs ? { timeoutMs } : {});
    const log = createStepLog();
    const inter = createIntermediary({
      client: server.client,
      network: { mode: 'proxy', hosts: ['example.com'] },
      hosts: createHostsTally(),
      masks: createMaskSet(),
      log,
      gate: asks.gate(ctx),
      seesImages: true,
    });
    return { server, asks, log, inter };
  }
  const waitAsk = async (asks: ReturnType<typeof make>): Promise<PendingAsk> => {
    for (let i = 0; i < 100 && !asks.list().length; i++) await new Promise((r) => setTimeout(r, 5));
    return asks.list()[0];
  };

  it('a yes lets the held step through exactly once', async () => {
    const { server, asks, inter, log } = rig();
    const done = inter.call('browser_click', { target: 'e15', reason: 'to send it' });
    const ask = await waitAsk(asks);
    expect(ask).toMatchObject({ kind: 'hold', why: 'submit', site: 'example.com', agentWords: 'to send it', step: { action: 'click', role: 'button', name: 'Send', submit: true } });
    expect(server.acts()).toEqual([]);
    asks.answer(ask.id, 'yes', 'window');
    expect((await done).isError).toBe(false);
    expect(server.acts()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({ held: { why: 'submit', answer: 'yes' }, outcome: 'ok' });
  });

  it('a no, no answer and a close each leave the page unchanged and tell the agent', async () => {
    for (const how of ['no', 'timeout', 'closed'] as const) {
      const { server, asks, inter, log } = rig(how === 'timeout' ? 60 : undefined);
      const done = inter.call('browser_click', { target: 'e15' });
      const ask = await waitAsk(asks);
      if (how === 'no') asks.answer(ask.id, 'no', 'window');
      else if (how === 'closed') asks.declineAll(ctx.key);
      const r = await done;
      expect(r.isError, how).toBe(true);
      expect(server.acts(), how).toEqual([]);
      expect(log.entries()[0].held?.answer, how).toBe(how);
    }
  });

  it('a pass lets the next step the app cannot read through, and never an irreversible one', async () => {
    const { server, asks, inter, log } = rig();
    const first = inter.call('browser_drag', { startTarget: 'e1', endTarget: 'e2' });
    asks.answer((await waitAsk(asks)).id, 'site', 'window');
    await first;
    await inter.call('browser_drag', { startTarget: 'e1', endTarget: 'e2' });
    expect(asks.list()).toEqual([]);
    expect(server.acts()).toHaveLength(2);
    expect(log.entries().map((e) => [e.held?.answer ?? null, e.passed ?? null])).toEqual([['site', null], [null, true]]);
    const third = inter.call('browser_click', { target: 'e22' });
    const ask = await waitAsk(asks);
    expect(ask.why).toBe('name');
    asks.answer(ask.id, 'no', 'window');
    await third;
    expect(server.acts()).toHaveLength(2);
    // The pass ends with the screen.
    asks.forget(ctx.key);
    const fourth = inter.call('browser_drag', { startTarget: 'e1', endTarget: 'e2' });
    expect((await waitAsk(asks)).why).toBe('unclassified');
    asks.declineAll(ctx.key);
    await fourth;
  });
});

// A request to hand the screen over (#178) is listed beside the questions and is not one: the service that owns it keeps the promise and the limits, so `answer` has nothing to
// answer and a screen's questions being declined does not take it away.
describe('a request to hand the screen over', () => {
  const request = { id: 'hand-1', key: ctx.key, agent: 'coder', what: 'log in to the site', why: 'the report is behind it', paths: { browser: true, shell: 'sandbox' as const } };

  it('is listed with the agent\'s words and the card\'s parts, published, and not reported as a question that waits', () => {
    const asks = make();
    const shown = asks.show(request);
    expect(asks.list()).toEqual([
      { id: 'hand-1', key: ctx.key, agent: 'coder', kind: 'handoff', why: 'agent', step: null, site: '', agentWords: 'log in to the site', since: '2026-10-09T10:00:00.000Z', handoff: { why: 'the report is behind it', taken: false, paths: { browser: true, shell: 'sandbox' } } },
    ]);
    expect(asks.list('call:other:coder')).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(told).toEqual([]);
    shown.remove();
    expect(asks.list()).toEqual([]);
    expect(changes).toHaveLength(2);
    shown.remove();
    expect(changes).toHaveLength(2);
  });

  it('changes when the screen is taken, and a change after it was removed does nothing', () => {
    const asks = make();
    const shown = asks.show({ ...request, why: undefined });
    shown.set({ taken: true });
    expect(asks.list()[0].handoff).toEqual({ taken: true, paths: { browser: true, shell: 'sandbox' } });
    expect(changes).toHaveLength(2);
    shown.remove();
    shown.set({ taken: false });
    expect(asks.list()).toEqual([]);
    expect(changes).toHaveLength(3);
  });

  it('is listed with the questions of the same screen, and neither takes the other away', async () => {
    const asks = make();
    const held = asks.hold(submit);
    const shown = asks.show(request);
    expect(asks.list(ctx.key).map((a) => a.kind)).toEqual(['hold', 'handoff']);
    expect(asks.declineAll(ctx.key)).toBe(1);
    expect(await held).toEqual({ answer: 'closed' });
    expect(asks.list().map((a) => a.kind)).toEqual(['handoff']);
    shown.remove();
  });

  it('is not answered through the questions\' door, and does not count against the screen\'s limit', () => {
    const asks = make();
    asks.show(request);
    expect(() => asks.answer('hand-1', 'yes', 'window')).toThrow(AskGone);
    expect(asks.list()).toHaveLength(1);
    for (let i = 0; i < MAX_PENDING_PER_SCREEN; i++) void asks.hold(submit);
    expect(asks.list().filter((a) => a.kind === 'hold')).toHaveLength(MAX_PENDING_PER_SCREEN);
  });
});
