// The offers to keep a procedure (#187): raised, replaced, capped and expired in memory, and the person's yes and no over a real store in a temp folder (never the app's data).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { StageUsage } from '../src/shared/runs/types';
import { OFFER_MAX_PENDING, OFFER_TTL_MS, createProcedureOffers, type OfferInput, type ProcedureOffers } from '../src/main/procedures/offers';
import { createProcedureStore, type ProcedureStore } from '../src/main/procedures/store';

let ws: string;
let clock: number;
let counter: number;
let store: ProcedureStore;
let config: WorkspaceConfig;
let marks: Map<string, number>;
let offers: ProcedureOffers;
let audits: Omit<AuditEntry, 'at'>[];
let changes: number;
let notes: { thread: string; code: string; params: Record<string, string | number> }[];

const T0 = Date.parse('2026-10-09T10:00:00Z');
const usage: StageUsage = { promptTokens: 9000, completionTokens: 400, cachedTokens: 0, calls: 7, costUsd: null };
const writer = { by: 'writer', surface: 'stage' as const, stage: 'development', ref: 'app#123', permission: 'worktree' as const, shell: 'sandbox' as const };

const input = (over: Partial<OfferInput> = {}): OfferInput => ({
  id: 'c-1',
  kind: 'repo',
  key: 'api',
  title: 'Run the tests',
  steps: [{ text: 'Install the packages', run: 'npm ci' }, { text: 'Run the suite', run: 'npm test' }],
  pitfalls: ['The suite needs the packages first'],
  waits: [],
  leftOut: 2,
  handoff: false,
  stepsFrom: 'recording',
  thread: 'app#123',
  stage: 'development',
  agent: 'writer',
  writer,
  usage,
  ...over,
});
const screen = (over: Partial<OfferInput> = {}): OfferInput =>
  input({ id: 'd-1', kind: 'gui', key: 'example.com', title: 'Close the month', steps: [{ text: 'Open the page' }, { text: 'Press "Close"' }], keyedBy: 'app', screen: 'call:t-1:writer', upTo: 12, thread: 't-1', writer: { ...writer, surface: 'forum', ref: 't-1' }, ...over });

const fakeSessions = () => ({ markOf: (k: string) => marks.get(k) ?? 0, mark: (k: string, n: number) => void marks.set(k, n) });

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-offers-'));
  clock = T0;
  counter = 0;
  marks = new Map();
  audits = [];
  changes = 0;
  notes = [];
  config = { ...neutralConfig(), projects: { ...neutralConfig().projects, repos: [{ id: 'api', path: '/tmp/api', remoteUrl: null, vcsId: null, projectPath: null }] } };
  store = createProcedureStore(ws, { now: () => clock, hex: () => (++counter).toString(16).padStart(8, '0') });
  offers = createProcedureOffers({ store, config: () => config, sessions: fakeSessions, now: () => clock, hex: () => (++counter + 0x100).toString(16).padStart(8, '0'), audit: (e) => void audits.push(e), note: (thread, code, params) => void notes.push({ thread, code, params }) });
  offers.onChange(() => void changes++);
});

describe('raising an offer', () => {
  it('holds it under an id of "o-" and 8 hex digits and lists it for its thread, with no usage and no reference in the view', () => {
    const o = offers.raise(input());
    expect(o.offerId).toMatch(/^o-[0-9a-f]{8}$/);
    const [v] = offers.list('app#123');
    expect(v).toMatchObject({ offerId: o.offerId, kind: 'repo', key: 'api', title: 'Run the tests', leftOut: 2, handoff: false, screen: false, stage: 'development', at: '2026-10-09T10:00:00.000Z', expiresAt: '2026-10-10T10:00:00.000Z' });
    expect(v.steps).toEqual([{ text: 'Install the packages', run: 'npm ci' }, { text: 'Run the suite', run: 'npm test' }]);
    expect(Object.keys(v)).not.toContain('usage');
    expect(Object.keys(v)).not.toContain('writer');
    expect(JSON.stringify(v)).not.toContain('app#123"}');
    expect(offers.list('another-thread')).toEqual([]);
    expect(offers.list()).toHaveLength(1);
  });

  it('replaces the offer for the same thread, agent, kind and key, and only that one', () => {
    const first = offers.raise(input());
    clock += 1000;
    const second = offers.raise(input({ title: 'Run the tests again', key: 'API' }));
    expect(offers.list().map((o) => o.offerId)).toEqual([second.offerId]);
    expect(offers.list()[0].title).toBe('Run the tests again');
    expect(first.offerId).not.toBe(second.offerId);

    offers.raise(input({ agent: 'other' }));
    offers.raise(input({ thread: 'app#124' }));
    offers.raise(input({ kind: 'tool', key: 'npm' }));
    expect(offers.list()).toHaveLength(4);
  });

  it('keeps ten per workspace and drops the oldest first', () => {
    const ids: string[] = [];
    for (let i = 0; i < OFFER_MAX_PENDING + 1; i++) {
      clock += 1000;
      ids.push(offers.raise(input({ thread: `t-${i}` })).offerId);
    }
    const left = offers.list().map((o) => o.offerId);
    expect(left).toHaveLength(OFFER_MAX_PENDING);
    expect(left).toEqual(ids.slice(1));
  });

  it('lets an offer go after 24 hours, with nothing said', () => {
    offers.raise(input());
    clock += OFFER_TTL_MS - 1;
    expect(offers.list()).toHaveLength(1);
    clock += 1;
    expect(offers.list()).toEqual([]);
  });
});

describe('a yes', () => {
  it('saves the record as the person\'s and reviewed, created by the agent, from the work\'s surface and reference, with the work\'s usage as its baseline', () => {
    const o = offers.raise(input());
    const r = offers.keep(o.offerId, 'Run the tests');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toMatchObject({ kind: 'repo', key: 'api', title: 'Run the tests', reviewed: true, stepsFrom: 'recording', revision: 1 });
    expect(r.record.origin).toMatchObject({ by: 'person', createdBy: 'writer', surface: 'stage', stage: 'development', ref: 'app#123', permission: 'worktree', shell: 'sandbox' });
    expect(r.record.origin.handoff).toBeUndefined();
    expect(r.record.stats.baseline).toEqual(usage);
    expect(r.record.stats.uses).toBe(0);
    expect(r.record.steps).toEqual([{ text: 'Install the packages', run: 'npm ci' }, { text: 'Run the suite', run: 'npm test' }]);
    expect(store.get(r.record.id)).toMatchObject({ status: 'ok' });
    expect(offers.list()).toEqual([]);
  });

  it('saves under the title the person typed, and under the offered one when they typed none', () => {
    const a = offers.keep(offers.raise(input()).offerId, 'My own title');
    expect(a.ok && a.record.title).toBe('My own title');
    const b = offers.keep(offers.raise(input({ key: 'web', title: 'Offered title' })).offerId, '   ');
    expect(b.ok).toBe(false);
    config.projects.repos.push({ id: 'web', path: '/tmp/web', remoteUrl: null, vcsId: null, projectPath: null });
    const c = offers.keep(offers.raise(input({ key: 'web', title: 'Offered title' })).offerId, undefined);
    expect(c.ok && c.record.title).toBe('Offered title');
  });

  it('keeps a hand-off screen record reviewed and moves the screen\'s mark to the draft\'s last step', () => {
    marks.set('call:t-1:writer', 3);
    const r = offers.keep(offers.raise(screen({ handoff: true })).offerId, 'Close the month');
    expect(r.ok && r.record).toMatchObject({ kind: 'gui', key: 'example.com', reviewed: true, keyedBy: 'app' });
    expect(r.ok && r.record.origin).toMatchObject({ by: 'person', createdBy: 'writer', surface: 'forum', ref: 't-1' });
    expect(r.ok && r.record.origin.handoff).toBeUndefined();
    expect(marks.get('call:t-1:writer')).toBe(12);
  });

  it('never moves a mark back', () => {
    marks.set('call:t-1:writer', 20);
    offers.keep(offers.raise(screen()).offerId, 'Close the month');
    expect(marks.get('call:t-1:writer')).toBe(20);
  });

  it('moves no mark for commands', () => {
    offers.keep(offers.raise(input()).offerId, 'Run the tests');
    expect(marks.size).toBe(0);
  });

  it('refuses with the store\'s words and leaves the offer and the mark where they are', () => {
    const first = offers.keep(offers.raise(input()).offerId, 'Run the tests');
    expect(first.ok).toBe(true);
    const o = offers.raise(input({ key: 'api' }));
    const again = offers.keep(o.offerId, 'run  the TESTS');
    expect(again).toMatchObject({ ok: false, code: 'duplicate' });
    expect(again.ok === false && again.text).toMatch(/exists/);
    expect(offers.list().map((x) => x.offerId)).toEqual([o.offerId]);

    const onScreen = offers.raise(screen({ title: 'Close the month', steps: [{ text: 'Open the page', run: 'password=hunter2' }] }));
    const bad = offers.keep(onScreen.offerId, 'Close the month');
    expect(bad.ok).toBe(false);
    expect(marks.size).toBe(0);
    expect(offers.list()).toHaveLength(2);
  });

  it('refuses a repository the workspace no longer has', () => {
    const o = offers.raise(input());
    config.projects.repos = [];
    const r = offers.keep(o.offerId, 'Run the tests');
    expect(r.ok).toBe(false);
    expect(offers.list()).toHaveLength(1);
  });

  it('says the offer is gone when it expired, was answered, or never was', () => {
    const o = offers.raise(input());
    clock += OFFER_TTL_MS;
    expect(offers.keep(o.offerId, 'Run the tests')).toMatchObject({ ok: false, code: 'gone' });
    const p = offers.raise(input());
    offers.decline(p.offerId);
    expect(offers.keep(p.offerId, 'Run the tests')).toMatchObject({ ok: false, code: 'gone' });
    expect(offers.keep('o-ffffffff', 'x')).toMatchObject({ ok: false, code: 'gone' });
    expect(offers.keep(42, 'x')).toMatchObject({ ok: false, code: 'gone' });
    expect(store.list().records).toEqual([]);
  });

  it('answers a second yes for the same offer as gone, and writes one record', () => {
    const o = offers.raise(input());
    expect(offers.keep(o.offerId, 'Run the tests').ok).toBe(true);
    expect(offers.keep(o.offerId, 'Run the tests')).toMatchObject({ ok: false, code: 'gone' });
    expect(store.list().records).toHaveLength(1);
  });
});

describe('a no', () => {
  it('drops the offer, writes nothing, and moves the mark of a screen draft', () => {
    const o = offers.raise(screen());
    expect(offers.decline(o.offerId)).toEqual({ ok: true });
    expect(offers.list()).toEqual([]);
    expect(store.list().records).toEqual([]);
    expect(marks.get('call:t-1:writer')).toBe(12);
  });

  it('moves no mark for commands, and says gone for an offer that is not there', () => {
    const o = offers.raise(input());
    expect(offers.decline(o.offerId)).toEqual({ ok: true });
    expect(marks.size).toBe(0);
    expect(offers.decline(o.offerId)).toEqual({ ok: false, code: 'gone' });
    expect(offers.decline(undefined)).toEqual({ ok: false, code: 'gone' });
  });

  it('survives a screen that is gone', () => {
    const broken = createProcedureOffers({ store, config: () => config, sessions: () => { throw new Error('closed'); }, now: () => clock });
    const o = broken.raise(screen());
    expect(broken.decline(o.offerId)).toEqual({ ok: true });
  });
});

describe('the last turn of a screen mark', () => {
  it('is given once per screen and mark, and forgotten when the screen closes', () => {
    expect(offers.turned('call:t-1:writer', 4)).toBe(false);
    expect(offers.turned('call:t-1:writer', 4)).toBe(true);
    expect(offers.turned('call:t-1:writer', 9)).toBe(false);
    expect(offers.turned('call:t-2:writer', 4)).toBe(false);
    offers.forget('call:t-1:writer');
    expect(offers.turned('call:t-1:writer', 4)).toBe(false);
    expect(offers.turned('call:t-2:writer', 4)).toBe(true);
  });

  it('does not take the offers a closing screen raised', () => {
    offers.raise(screen());
    offers.forget('call:t-1:writer');
    expect(offers.list()).toHaveLength(1);
  });
});

describe('the audit and the change signal', () => {
  it('writes a line when an offer is raised, by the agent, with the id, kind, key and title and no step, pitfall or wait', () => {
    const o = offers.raise(input({ waits: ['About 30 s after the packages'] }));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ kind: 'procedure', target: 'procedures:offer', via: 'stage', by: 'writer', ok: true, result: 'offered to keep', origin: { key: 'app#123' } });
    expect(audits[0].fields).toEqual({ agent: 'writer', surface: 'stage', offer: o.offerId, kind: 'repo', key: 'api', title: 'Run the tests' });
    const text = JSON.stringify(audits);
    for (const secret of ['npm ci', 'Install the packages', 'The suite needs', 'About 30 s']) expect(text).not.toContain(secret);
  });

  it('writes the existing save line for a yes, as the person, and a decline line for a no', () => {
    const a = offers.keep(offers.raise(input()).offerId, 'Run the tests');
    expect(audits[1]).toMatchObject({ target: 'procedures:save', by: 'person', via: 'stage', ok: true, result: 'saved' });
    expect(audits[1].fields).toMatchObject({ id: a.ok ? a.record.id : '', revision: '1', kind: 'repo', key: 'api', title: 'Run the tests', agent: 'person' });
    const b = offers.raise(input({ key: 'web' }));
    offers.decline(b.offerId);
    expect(audits.at(-1)).toMatchObject({ target: 'procedures:decline', by: 'person', ok: true, result: 'declined the offer' });
    expect(audits.at(-1)?.fields).toMatchObject({ offer: b.offerId, kind: 'repo', key: 'web' });
  });

  it('audits a refusal by its code and fields, never by the title or the key', () => {
    const o = offers.raise(input({ steps: [{ text: 'Log in', run: 'tool --password hunter2' }] }));
    const r = offers.keep(o.offerId, 'Run the tests');
    expect(r.ok).toBe(false);
    const line = audits.at(-1);
    expect(line).toMatchObject({ target: 'procedures:save', ok: false, result: 'refused', by: 'person' });
    expect(line?.fields.fields).toMatch(/steps\[\d\]/);
    expect(JSON.stringify(line)).not.toContain('hunter2');
    expect(line?.fields).not.toHaveProperty('title');
    expect(line?.fields).not.toHaveProperty('key');
  });

  it('keeps going when the log fails', () => {
    const noisy = createProcedureOffers({ store, config: () => config, now: () => clock, audit: () => { throw new Error('disk full'); } });
    const o = noisy.raise(input());
    expect(noisy.keep(o.offerId, 'Run the tests').ok).toBe(true);
  });

  it('tells the listeners after a raise, a yes and a no, and not after an answer that did nothing', () => {
    const a = offers.raise(input());
    expect(changes).toBe(1);
    offers.keep(a.offerId, 'Run the tests');
    expect(changes).toBe(2);
    const b = offers.raise(input({ key: 'web' }));
    expect(changes).toBe(3);
    offers.keep(b.offerId, 'Run the tests');
    expect(changes).toBe(3);
    offers.decline(b.offerId);
    expect(changes).toBe(4);
    offers.decline(b.offerId);
    offers.keep('o-ffffffff', 'x');
    expect(changes).toBe(4);
  });

  it('lets a listener stop and does not mind one that throws', () => {
    let seen = 0;
    const stop = offers.onChange(() => void seen++);
    offers.onChange(() => {
      throw new Error('broken');
    });
    offers.raise(input());
    stop();
    offers.raise(input({ key: 'web' }));
    expect(seen).toBe(1);
    expect(changes).toBe(2);
  });
});

describe('the lines in the thread', () => {
  it('says once that an offer was made, and not again when a newer one replaces it', () => {
    offers.raise(input({ thread: 'run-1', agent: 'developer' }));
    expect(notes).toEqual([{ thread: 'run-1', code: 'runner.procedures.offered', params: { agent: 'developer', count: 2, title: 'Run the tests' } }]);
    offers.raise(input({ thread: 'run-1', agent: 'developer', title: 'Run the tests again' }));
    expect(notes).toHaveLength(1);
    offers.raise(input({ thread: 'run-1', agent: 'developer', key: 'web' }));
    expect(notes).toHaveLength(2);
  });

  it('says what was kept, with the id and revision, and what was declined, and says nothing for an answer that did nothing', () => {
    const a = offers.raise(input({ thread: 'run-1' }));
    notes.length = 0;
    const kept = offers.keep(a.offerId, 'Run the tests, my way');
    expect(notes).toEqual([{ thread: 'run-1', code: 'runner.procedures.offerKept', params: { agent: 'writer', id: kept.ok ? kept.record.id : '', revision: 1, title: 'Run the tests, my way' } }]);
    const b = offers.raise(input({ thread: 'run-2', key: 'web' }));
    notes.length = 0;
    offers.decline(b.offerId);
    expect(notes).toEqual([{ thread: 'run-2', code: 'runner.procedures.offerDeclined', params: { agent: 'writer', title: 'Run the tests' } }]);
    notes.length = 0;
    offers.decline(b.offerId);
    offers.keep(b.offerId, 'x');
    const c = offers.raise(input({ thread: 'run-3' }));
    notes.length = 0;
    offers.keep(c.offerId, 'Run the tests, my way');
    expect(notes).toEqual([]);
  });

  it('writes no line for a refused yes, and goes on when the line cannot be written', () => {
    const a = offers.raise(input({ thread: 'run-1', steps: [{ text: 'Log in', run: 'tool --password hunter2' }] }));
    notes.length = 0;
    expect(offers.keep(a.offerId, 'Run the tests').ok).toBe(false);
    expect(notes).toEqual([]);
    const broken = createProcedureOffers({ store, config: () => config, now: () => clock, note: () => { throw new Error('no thread'); } });
    expect(broken.keep(broken.raise(input({ key: 'api', title: 'Another one' })).offerId, 'Another one').ok).toBe(true);
  });

  it.each(['en', 'pt-BR'] as const)('has the four lines in %s, with every parameter filled', (language) => {
    setLanguage(language);
    try {
      const params = { agent: 'developer', tokens: 1200, count: 4, title: 'Run the tests', id: 'p-00000001', revision: 1 };
      for (const code of ['wrapUp', 'offered', 'offerKept', 'offerDeclined']) {
        const key = `main.forum.code.runner.procedures.${code}`;
        expect(CATALOGS[language][key], key).toBeTruthy();
        const text = t(key, params);
        expect(text, key).not.toMatch(/\{\w+\}/);
        if (code !== 'offered') expect(text, key).toContain('developer');
      }
    } finally {
      setLanguage('pt-BR');
    }
  });
});
