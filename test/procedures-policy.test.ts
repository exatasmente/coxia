// What a paired browser may do with the learned procedures (#179): read the list, one record and the figures, and nothing else. The whole `procedures:` prefix is denied by
// a pattern with the three reads as named exceptions, so a channel added later is closed from the day it exists. A test pins that as test/screen-policy.test.ts pins `screen:`.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

// The module list pulls in every feature module, and the app's build info reads Electron at load.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
const { moduleList } = await import('../src/main/modules');
const { proceduresModule, OFFERS_EVENT } = await import('../src/main/procedures/module');
const { procedureOffers } = await import('../src/main/procedures/index');

const SRC = join(import.meta.dirname, '../src/main');
const READS = ['procedures:list', 'procedures:get', 'procedures:stats'];
const WRITES = ['procedures:save', 'procedures:delete', 'procedures:review', 'procedures:restore'];
const OFFERS = ['procedures:offers', 'procedures:offer-keep', 'procedures:offer-decline'];

describe('web policy for the procedures channels', () => {
  it.each(READS)('lets a paired browser read with %s', (channel) => {
    expect(webAccess(channel)).toBe('allow');
    expect(webRefusal(channel, false)).toBeNull();
  });

  it.each([...WRITES, 'procedures:made-up', 'procedures:', 'procedures:listAll', 'procedures:get2', 'procedures:stats:x'])('denies %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
  });

  it('closes the prefix by a pattern, not by an entry: none is in a set by name', () => {
    for (const channel of [...READS, ...WRITES]) {
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
  });

  it('does not mistake a channel that only has procedures in its name for one of them', () => {
    for (const channel of ['runs:procedures', 'myprocedures:save', 'procedure:save', 'forum:procedures:save']) expect(webAccess(channel), channel).toBe('allow');
  });

  it('classifies every procedures channel a module registers: the three reads open, the rest denied', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(procedures:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual([...READS, ...WRITES, ...OFFERS].sort());
    for (const channel of served) expect(webAccess(channel), channel).toBe(READS.includes(channel) ? 'allow' : 'deny');
  });

  it('registers the channels it serves, in the list of modules the app registers', () => {
    expect(moduleList()).toContain(proceduresModule);
    const handled: string[] = [];
    proceduresModule({ handle: (channel: string) => void handled.push(channel), notify: vi.fn(), emit: vi.fn(), job: vi.fn() });
    expect(handled.sort()).toEqual([...READS, ...WRITES, ...OFFERS].sort());
  });

  it('has no channel for the agents tools: they are in process', () => {
    const tools = readdirSync(join(SRC, 'procedures')).filter((f) => /^(tools|engineTool|session)\.ts$/.test(f));
    expect(tools.length).toBeGreaterThan(0);
    for (const f of tools) expect(readFileSync(join(SRC, 'procedures', f), 'utf8')).not.toMatch(/handle\(\s*'procedures:/);
  });

  it('tells the window when an offer is raised or answered, with nothing in the event', () => {
    const emit = vi.fn();
    proceduresModule({ handle: vi.fn(), notify: vi.fn(), emit, job: vi.fn() });
    const offers = procedureOffers();
    const o = offers.raise({
      id: 'c-1',
      kind: 'repo',
      key: 'api',
      title: 'Run the tests',
      steps: [{ text: 'Install the packages', run: 'npm ci' }],
      pitfalls: [],
      waits: [],
      leftOut: 0,
      handoff: false,
      stepsFrom: 'recording',
      thread: 'app#123',
      agent: 'writer',
      writer: { by: 'writer', surface: 'stage', ref: 'app#123' },
      usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, calls: 1, costUsd: null },
    });
    expect(OFFERS_EVENT).toBe('procedures-offers');
    expect(emit).toHaveBeenCalledWith({ type: 'module', name: 'procedures-offers', payload: null });
    emit.mockClear();
    offers.decline(o.offerId);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
