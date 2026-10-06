import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginConfig, PluginsConfig, RunnerSandbox } from '../src/shared/config/types';
import { neutralPlugins, neutralSandbox } from '../src/shared/config/defaults';
import type { ReleaseAction } from '../src/shared/types';
import type { PluginRecord } from '../src/main/plugins/types';
import type { PluginDoor, PluginNote, PluginsDeps } from '../src/main/plugins/module';
import type { JsAnswer, JsCall } from '../src/main/plugins/runtime';

const guard = vi.hoisted(() => ({ test: false }));
vi.mock('../src/main/workspace', async (orig) => ({
  ...(await orig<typeof import('../src/main/workspace')>()),
  externalRefusal: (what: string) => (guard.test ? `test workspace: ${what}` : null),
}));

// The plugins service under the permission contract: a plugin that needs what it was not allowed opens a request instead of running; the person answers
// once, for the session, always or refuses; "always" is kept in the workspace's list, "session" in the running app; an allowed write goes out through the
// door (or is announced first when it cannot be undone). The deps are injected, so nothing here touches a workspace, a sandbox or the actions file.

const { answerPluginAsk, clearPluginSession, firePluginEvent, listPlugins, pluginHold, pluginNotes, revokePluginAllow, revokePluginWrite, setPluginEnabled, setPluginSecret, setPluginSetting, setPluginSettings } = await import('../src/main/plugins/module');

// The script of a plugin is read from its folder: each record points at a throwaway folder that holds one.
const root = mkdtempSync(join(tmpdir(), 'coxia-plugins-service-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const folder = (id: string): string => {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'search.sh'), 'echo "$1"\n');
  writeFileSync(join(dir, 'index.mjs'), 'export default async () => ({});\n');
  return dir;
};

const plugin = (over: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'web-search',
  name: 'Web search',
  dir: folder(over.id ?? 'web-search'),
  enabled: true,
  allow: { network: false, write: false },
  documents: [{ name: '7_WEB_SEARCH.md', label: 'Web search' }],
  events: ['stage-finished'],
  network: ['search.example.com'],
  write: { to: 'results', reversible: true },
  entry: 'search.sh',
  runtime: 'shell',
  settings: [],
  values: {},
  requests: [],
  agents: null,
  reach: 'r',
  refused: null,
  ...over,
});

/** The door of Actions in memory: requests deduplicated by key, answers recorded, writes and announcements counted. */
function memoryDoor(refuse: boolean, armed: boolean) {
  const actions: ReleaseAction[] = [];
  const written: { to: string; text: string }[] = [];
  const sent: string[] = [];
  const requested: { target: string; fields: Record<string, string> }[] = [];
  const announced: { seconds: number; write: { plugin: string; to: string; text: string } }[] = [];
  let n = 0;
  const door: PluginDoor = {
    ask: (input) => {
      if (refuse) throw new Error('test workspace: nothing is asked here');
      if (actions.some((a) => a.key === input.key && a.state === 'pending')) return null;
      const a = { id: `a${++n}`, key: input.key, kind: 'plugin-ask', issue: input.issue, issueTitle: input.issueTitle ?? '', state: 'pending', unit: { ...input.unit }, summary: input.summary, output: null } as unknown as ReleaseAction;
      actions.push(a);
      return a;
    },
    pending: () => actions.filter((a) => a.kind === 'plugin-ask' && a.state === 'pending'),
    settle: (id, allowed, words) => {
      const a = actions.find((x) => x.id === id) as ReleaseAction;
      a.state = allowed ? 'done' : 'skipped';
      a.output = words;
      return a;
    },
    now: async (_w, input) => {
      written.push({ to: input.to, text: input.text });
      return 'written';
    },
    announce: (input) => {
      announced.push({ seconds: input.seconds, write: input.write });
      const a = { id: `w${++n}`, key: input.key, kind: 'plugin-write', issue: input.issue, issueTitle: '', state: 'pending', unit: { ...input.write, runId: input.runId, due: new Date(Date.now() + input.seconds * 1000).toISOString(), ...(input.request ? { request: input.request } : {}) }, summary: input.summary, output: null } as unknown as ReleaseAction;
      actions.push(a);
      // Returned only when the test drives the deadline: the service arms a timer for what it gets back.
      return armed ? a : null;
    },
    writes: () => actions.filter((a) => a.kind === 'plugin-write' && a.state === 'pending'),
    withdraw: (id, words) => {
      const a = actions.find((x) => x.id === id) as ReleaseAction;
      a.state = 'skipped';
      a.output = words;
    },
    send: async (id, execute) => {
      const a = actions.find((x) => x.id === id) as ReleaseAction;
      if (a.state !== 'pending') return;
      if (execute) await execute(a, { issue: a.issue, actionId: a.id, kind: a.kind, key: a.key, summary: a.summary });
      a.state = 'done';
      sent.push(id);
    },
    sendRequest: async (_origin, target, fields, send) => {
      requested.push({ target, fields });
      return send();
    },
  };
  return { actions, written, announced, sent, requested, door };
}

/** Deps over an in-memory configuration: saving changes what the next read sees, as the real read of the folder would. */
function harness(initial: PluginRecord[], opts: { workspace?: RunnerSandbox; refuse?: boolean; output?: string; armed?: boolean; js?: (read: (call: JsCall) => Promise<JsAnswer>) => Promise<{ document?: string; writes?: JsCall[] }>; status?: number } = {}) {
  let config: PluginsConfig = { ...neutralPlugins(), dir: '/plugins', list: initial.map((r) => ({ id: r.id, folder: r.dir, enabled: r.enabled, allow: r.allow, settings: r.values })) };
  const runs: { plugin: string; event: string; sandbox: RunnerSandbox }[] = [];
  const settled: { runId: string; note: PluginNote | null }[] = [];
  const memory = memoryDoor(opts.refuse === true, opts.armed === true);
  const fetched: { url: string; method: string }[] = [];
  const secretsStore = new Map<string, string>();
  const deps: PluginsDeps = {
    dir: () => '/plugins',
    config: () => config,
    read: () =>
      initial.map((r) => {
        const c = config.list.find((x) => x.id === r.id);
        return c ? { ...r, enabled: c.enabled, allow: c.allow, values: c.settings ?? {} } : r;
      }),
    save: (change) => {
      config = { ...config, list: change(config.list) };
    },
    settings: (values) => {
      config = { ...config, ...values };
    },
    target: (runId) => (runId === 'gone' ? null : { worktree: '/wt', cycleFolder: 'docs/cycles/123-x' }),
    sandbox: () => opts.workspace ?? neutralSandbox(),
    run: async (p, event, _target, sandbox) => {
      runs.push({ plugin: p.id, event, sandbox });
      return { plugin: p.id, ok: true, text: opts.output ?? 'result from the sandbox', refused: null, document: null };
    },
    runJs: async (p, event, _context, _target, sandbox, read) => {
      runs.push({ plugin: p.id, event, sandbox });
      const out = opts.js ? await opts.js(read) : {};
      return { plugin: p.id, ok: true, text: out.document ?? '', refused: null, document: null, writes: out.writes ?? [] };
    },
    fetchRequest: async (p, resolved) => {
      fetched.push({ url: resolved.url.href, method: resolved.method });
      return { ok: true, status: opts.status ?? 200, contentType: 'application/json', body: '{"ok":true}', truncated: false };
    },
    secretFilled: (p, key) => secretsStore.has(`${p}.${key}`),
    setSecret: (p, key, value) => void (value ? secretsStore.set(`${p}.${key}`, value) : secretsStore.delete(`${p}.${key}`)),
    door: memory.door,
    settled: (runId, note) => void settled.push({ runId, note }),
  };
  return { deps, runs, settled, fetched, secretsStore, ...memory, list: (): PluginConfig[] => config.list, config: () => config };
}

const ctx = (runId = 'r1') => ({ issue: 123, issueTitle: 'Plugin platform', stage: 'implement', runId });

beforeEach(() => clearPluginSession());

describe('the list and the switches', () => {
  it('lists the folder, the deadline and, per plugin, what it offers, asks for and was allowed', () => {
    const h = harness([plugin()]);
    const view = listPlugins(h.deps);
    expect(view.dir).toBe('/plugins');
    expect(view.confirmSeconds).toBe(30);
    expect(view.plugins[0]).toMatchObject({ id: 'web-search', enabled: true, network: ['search.example.com'], write: { to: 'results', reversible: true }, allow: { network: false, write: false }, session: { network: false, write: false }, waiting: 0 });
  });

  it('switches only that plugin, keeps what it was allowed, and refuses an unknown id', () => {
    const h = harness([plugin({ allow: { network: true, write: false } }), plugin({ id: 'other' })]);
    expect(setPluginEnabled('web-search', false, h.deps).plugins[0].enabled).toBe(false);
    expect(setPluginEnabled('web-search', true, h.deps).plugins[0].allow).toEqual({ network: true, write: false });
    expect(h.list().find((c) => c.id === 'other')?.enabled).toBe(true);
    expect(() => setPluginEnabled('ghost', true, h.deps)).toThrow();
  });

  it('keeps the entry of a plugin the folder no longer has when another one is switched', () => {
    const h = harness([plugin()]);
    h.deps.save((list) => [...list, { id: 'gone', folder: '/old', enabled: true, allow: { network: true, write: true }, settings: {} }]);
    setPluginEnabled('web-search', false, h.deps);
    expect(h.list().map((c) => c.id)).toEqual(['web-search', 'gone']);
    expect(h.list()[1].allow).toEqual({ network: true, write: true });
  });

  it('saves the folder and the deadline, and refuses a deadline out of range', () => {
    const h = harness([plugin()]);
    expect(setPluginSettings('/opt/plugins', 45, h.deps).confirmSeconds).toBe(45);
    expect(h.config().dir).toBe('/opt/plugins');
    expect(() => setPluginSettings('', 2, h.deps)).toThrow();
    expect(() => setPluginSettings('', 99_999, h.deps)).toThrow();
  });
});

describe('calling the plugins', () => {
  it('runs only the plugins that are on, that observe the event and are not refused', async () => {
    const all = { network: true, write: true };
    const h = harness([plugin({ allow: all }), plugin({ id: 'off', enabled: false, allow: all }), plugin({ id: 'other', events: ['run-finished'], allow: all }), plugin({ id: 'bad', refused: 'no name', allow: all })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs.map((r) => r.plugin)).toEqual(['web-search']);
  });

  it('does not run a plugin without the network it declared: it opens one request and the run is held', async () => {
    const h = harness([plugin()]);
    const out = await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs).toEqual([]);
    expect(out[0].ok).toBe(false);
    expect(out[0].refused).toContain('Web search');
    expect(h.actions).toHaveLength(1);
    expect(h.actions[0].unit).toMatchObject({ plugin: 'web-search', need: 'network', hosts: ['search.example.com'], runId: 'r1', event: 'stage-finished' });
    expect(pluginHold('r1', h.deps)).toEqual({ plugin: 'Web search', need: 'network' });
    expect(pluginHold('r2', h.deps)).toBeNull();
    // The same call again does not open a second request.
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.actions).toHaveLength(1);
  });

  it('runs a plugin with no declared network without asking, its sandbox closed', async () => {
    const h = harness([plugin({ network: [], write: null })], { workspace: { ...neutralSandbox(), network: 'registry', registryHosts: ['registry.example.com'] } });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs[0].sandbox.network).toBe('off');
    expect(h.runs[0].sandbox.registryHosts).toEqual([]);
    expect(h.actions).toEqual([]);
  });

  it('allowed always, reaches exactly the destinations it declared, not the ones the workspace gives its stages', async () => {
    const h = harness([plugin({ allow: { network: true, write: true } })], { workspace: { ...neutralSandbox(), network: 'registry', registryHosts: ['registry.example.com'] } });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs[0].sandbox).toMatchObject({ network: 'registry', registryHosts: ['search.example.com'] });
  });

  it('allowed always and reversible, the write goes out through the door at once', async () => {
    const h = harness([plugin({ allow: { network: true, write: true } })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.written).toEqual([{ to: 'results', text: 'result from the sandbox' }]);
    expect(h.actions).toEqual([]);
  });

  it('without the write allowed, asks for it with the text it would write', async () => {
    const h = harness([plugin({ allow: { network: true, write: false } })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.written).toEqual([]);
    expect(h.actions[0].unit).toMatchObject({ need: 'write', reversible: true, to: 'results', text: 'result from the sandbox' });
  });

  it('writes nothing and asks nothing when the plugin returned nothing', async () => {
    const h = harness([plugin({ allow: { network: true, write: false } })], { output: '  ' });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.actions).toEqual([]);
    expect(h.written).toEqual([]);
  });

  it('allowed always and irreversible, the write is announced for the workspace deadline, never sent at once', async () => {
    const h = harness([plugin({ allow: { network: true, write: true }, write: { to: 'results', reversible: false } })]);
    h.deps.settings({ dir: null, confirmSeconds: 45 });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.written).toEqual([]);
    expect(h.announced).toEqual([{ seconds: 45, write: { plugin: 'web-search', to: 'results', text: 'result from the sandbox' } }]);
  });

  it('a write that became irreversible between the request and the answer is not sent at once', async () => {
    const declared = plugin({ allow: { network: true, write: false } });
    const h = harness([declared]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    declared.write = { to: 'results', reversible: false };
    await answerPluginAsk(h.actions[0].id, 'once', h.deps);
    expect(h.written).toEqual([]);
    expect(h.settled.at(-1)?.note?.code).toBe('run.plugin.failed');
  });

  it('an irreversible write takes neither "once" nor "session"', async () => {
    const h = harness([plugin({ allow: { network: true, write: false }, write: { to: 'results', reversible: false } })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    const ask = h.actions[0];
    await expect(answerPluginAsk(ask.id, 'session', h.deps)).rejects.toThrow();
    await expect(answerPluginAsk(ask.id, 'once', h.deps)).rejects.toThrow();
    expect(ask.state).toBe('pending');
  });

  it('in a test workspace opens no request, and says why', async () => {
    const h = harness([plugin()], { refuse: true });
    const out = await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(out[0].refused).toContain('test workspace');
    expect(h.runs).toEqual([]);
  });

  it('is not run when there is no run to write into', async () => {
    const h = harness([plugin({ allow: { network: true, write: true } })]);
    const out = await firePluginEvent('stage-finished', ctx('gone'), h.deps);
    expect(out[0].ok).toBe(false);
    expect(h.runs).toEqual([]);
  });

  it('a plugin that fails does not stop the next one', async () => {
    const all = { network: true, write: true };
    const h = harness([plugin({ id: 'first', allow: all }), plugin({ id: 'second', allow: all })]);
    h.deps.run = async (p) => (p.id === 'first' ? Promise.reject(new Error('it threw')) : { plugin: p.id, ok: true, text: 'ok', refused: null, document: null });
    const out = await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(out.map((r) => [r.plugin, r.ok])).toEqual([
      ['first', false],
      ['second', true],
    ]);
  });
});

describe('the person answers', () => {
  it('once: the plugin runs now with the network, the run is let go, and the next call asks again', async () => {
    const h = harness([plugin({ write: null })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    await answerPluginAsk(h.actions[0].id, 'once', h.deps);
    expect(h.actions[0].state).toBe('done');
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].sandbox).toMatchObject({ network: 'registry', registryHosts: ['search.example.com'] });
    expect(h.settled).toEqual([{ runId: 'r1', note: null }]);
    expect(pluginHold('r1', h.deps)).toBeNull();
    await firePluginEvent('stage-finished', ctx('r2'), h.deps);
    expect(h.actions).toHaveLength(2);
    expect(h.runs).toHaveLength(1);
  });

  it('session: answers every request of the plugin for the network, and lasts until the app closes', async () => {
    const h = harness([plugin({ write: null, events: ['stage-finished', 'stage-entered'] })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    await firePluginEvent('stage-entered', ctx(), h.deps);
    expect(h.actions).toHaveLength(2);
    await answerPluginAsk(h.actions[0].id, 'session', h.deps);
    expect(h.actions.map((a) => a.state)).toEqual(['done', 'done']);
    expect(h.runs).toHaveLength(2);
    expect(listPlugins(h.deps).plugins[0].session.network).toBe(true);
    expect(h.list()[0].allow.network).toBe(false);
    await firePluginEvent('stage-finished', ctx('r2'), h.deps);
    expect(h.runs).toHaveLength(3);
    clearPluginSession();
    await firePluginEvent('stage-finished', ctx('r3'), h.deps);
    expect(h.actions).toHaveLength(3);
  });

  it('always: kept in the workspace list, and kept when the plugin is switched off and on', async () => {
    const h = harness([plugin({ write: null })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    await answerPluginAsk(h.actions[0].id, 'always', h.deps);
    expect(h.list()[0].allow).toEqual({ network: true, write: false });
    setPluginEnabled('web-search', false, h.deps);
    setPluginEnabled('web-search', true, h.deps);
    expect(h.list()[0].allow.network).toBe(true);
    clearPluginSession();
    await firePluginEvent('stage-finished', ctx('r2'), h.deps);
    expect(h.actions).toHaveLength(1);
    expect(h.runs).toHaveLength(2);
  });

  it('refuse: the plugin does not run, the run is let go with the reason, and it asks again next time', async () => {
    const h = harness([plugin({ write: null })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    await answerPluginAsk(h.actions[0].id, 'refuse', h.deps);
    expect(h.actions[0].state).toBe('skipped');
    expect(h.runs).toEqual([]);
    expect(h.settled).toEqual([{ runId: 'r1', note: { code: 'run.plugin.refused.network', params: { plugin: 'Web search' } } }]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.actions).toHaveLength(2);
  });

  it('a write allowed once goes out through the door; an irreversible one added to the list is announced', async () => {
    const reversible = harness([plugin({ allow: { network: true, write: false } })]);
    await firePluginEvent('stage-finished', ctx(), reversible.deps);
    await answerPluginAsk(reversible.actions[0].id, 'once', reversible.deps);
    expect(reversible.written).toEqual([{ to: 'results', text: 'result from the sandbox' }]);
    expect(reversible.list()[0].allow.write).toBe(false);

    const irreversible = harness([plugin({ allow: { network: true, write: false }, write: { to: 'results', reversible: false } })]);
    await firePluginEvent('stage-finished', ctx(), irreversible.deps);
    await answerPluginAsk(irreversible.actions[0].id, 'always', irreversible.deps);
    expect(irreversible.written).toEqual([]);
    expect(irreversible.announced).toHaveLength(1);
    expect(irreversible.list()[0].allow.write).toBe(true);
  });

  it('refuses an answer that is not one of the four, and a request already answered', async () => {
    const h = harness([plugin({ write: null })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    await expect(answerPluginAsk(h.actions[0].id, 'forever' as never, h.deps)).rejects.toThrow();
    await answerPluginAsk(h.actions[0].id, 'refuse', h.deps);
    await expect(answerPluginAsk(h.actions[0].id, 'once', h.deps)).rejects.toThrow();
  });

  it('taking a permission back clears always and session: the plugin asks again', async () => {
    const h = harness([plugin({ write: null, allow: { network: true, write: false } })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs).toHaveLength(1);
    revokePluginAllow('web-search', 'network', h.deps);
    expect(h.list()[0].allow.network).toBe(false);
    await firePluginEvent('stage-finished', ctx('r2'), h.deps);
    expect(h.runs).toHaveLength(1);
    expect(h.actions).toHaveLength(1);
  });
});

describe('an announced write and its deadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const irreversible = () => plugin({ allow: { network: true, write: true }, write: { to: 'results', reversible: false } });

  it('goes out at the deadline while the plugin is on and allowed', async () => {
    const h = harness([irreversible()], { armed: true });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(h.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.sent).toHaveLength(1);
  });

  it('does not go out when the permission is taken back in the list during the countdown', async () => {
    const h = harness([irreversible()], { armed: true });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    revokePluginAllow('web-search', 'write', h.deps);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.sent).toEqual([]);
    expect(h.actions.find((a) => a.kind === 'plugin-write')?.state).toBe('skipped');
  });

  it('does not go out when the plugin is switched off during the countdown, and its waiting requests are refused', async () => {
    const h = harness([irreversible(), plugin({ id: 'asker' })], { armed: true });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    setPluginEnabled('web-search', false, h.deps);
    setPluginEnabled('asker', false, h.deps);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.sent).toEqual([]);
    expect(h.actions.find((a) => a.kind === 'plugin-ask')?.state).toBe('skipped');
    expect(h.settled).toContainEqual({ runId: 'r1', note: { code: 'run.plugin.refused.network', params: { plugin: 'Web search' } } });
  });

  it('is stopped by revoking it from the card, which also takes the permission back', async () => {
    const h = harness([irreversible()], { armed: true });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    const announced = h.actions.find((a) => a.kind === 'plugin-write') as ReleaseAction;
    await revokePluginWrite(announced.id, h.deps);
    expect(announced.state).toBe('skipped');
    expect(h.list()[0].allow.write).toBe(false);
    await expect(revokePluginWrite(announced.id, h.deps)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.sent).toEqual([]);
  });
});

describe('going on without answering', () => {
  it('a released request no longer holds the run, and stays to be answered', async () => {
    const h = harness([plugin({ write: null })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    (h.actions[0].unit as Record<string, unknown>).holdsRun = false;
    expect(pluginHold('r1', h.deps)).toBeNull();
    expect(h.deps.door.pending()).toHaveLength(1);
  });
});

describe('a JavaScript plugin and the requests the app makes for it', () => {
  const settings = [
    { key: 'url', label: 'Instance URL', kind: 'url' as const, required: true },
    { key: 'token', label: 'API key', kind: 'secret' as const, required: false },
  ];
  const search = { id: 'search', method: 'GET' as const, url: '{settings.url}/search', secret: { setting: 'token', in: 'header' as const, name: 'Authorization', format: 'Bearer {secret}' }, write: false, reversible: false };
  const post = (reversible: boolean) => ({ id: 'post', method: 'POST' as const, url: 'https://hooks.example.com/notify', secret: null, write: true, reversible });
  const js = (over: Partial<PluginRecord> = {}) => plugin({ entry: 'index.mjs', runtime: 'js', network: [], write: null, settings, requests: [search, post(true)], values: { url: 'http://127.0.0.1:8888' }, ...over });

  it('asks for the network before a plugin with declared reads runs, naming what it reaches', async () => {
    const h = harness([js()]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs).toEqual([]);
    expect(h.actions[0].unit).toMatchObject({ need: 'network', hosts: ['GET {settings.url}/search'] });
  });

  it('is not run while a required setting is empty, and says which', async () => {
    const h = harness([js({ values: {}, allow: { network: true, write: true } })]);
    const out = await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.runs).toEqual([]);
    expect(out[0].refused).toContain('Instance URL');
  });

  it('makes a declared read at the address the person set, and hands back the answer', async () => {
    let answer: JsAnswer | null = null;
    const h = harness([js({ allow: { network: true, write: true } })], { js: async (read) => ((answer = await read({ id: 'search', path: '/x', query: { q: 'plugins' } })), {}) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.fetched).toEqual([{ url: 'http://127.0.0.1:8888/search/x?q=plugins', method: 'GET' }]);
    expect(answer).toMatchObject({ id: 'search', status: 200, body: '{"ok":true}' });
  });

  it('refuses a read the plugin did not declare, or one that is a write, without calling anything', async () => {
    const answers: JsAnswer[] = [];
    const h = harness([js({ allow: { network: true, write: true } })], { js: async (read) => (answers.push(await read({ id: 'ghost' }), await read({ id: 'post' })), {}) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.fetched).toEqual([]);
    expect(answers.every((a) => 'refused' in a)).toBe(true);
  });

  it('sends an allowed reversible write request through the audited door', async () => {
    const h = harness([js({ allow: { network: true, write: true } })], { js: async () => ({ writes: [{ id: 'post', body: '{"text":"done"}' }] }) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.requested).toEqual([{ target: 'POST https://hooks.example.com/notify', fields: { plugin: 'web-search', request: 'post', method: 'POST' } }]);
    expect(h.fetched).toEqual([{ url: 'https://hooks.example.com/notify', method: 'POST' }]);
  });

  it('asks for a write request it was not allowed, and sends it once the person allows it', async () => {
    const h = harness([js({ allow: { network: true, write: false } })], { js: async () => ({ writes: [{ id: 'post', body: '{"text":"done"}' }] }) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.fetched).toEqual([]);
    const asked = h.actions.find((a) => a.kind === 'plugin-ask') as ReleaseAction;
    expect(asked.unit).toMatchObject({ need: 'write', reversible: true, to: 'post', request: { id: 'post', target: 'POST https://hooks.example.com/notify' } });
    await answerPluginAsk(asked.id, 'once', h.deps);
    expect(h.requested).toHaveLength(1);
  });

  it('announces an irreversible write request, and sends it at the deadline', async () => {
    vi.useFakeTimers();
    try {
      const h = harness([js({ allow: { network: true, write: true }, requests: [search, post(false)] })], { armed: true, js: async () => ({ writes: [{ id: 'post', body: '{}' }] }) });
      await firePluginEvent('stage-finished', ctx(), h.deps);
      expect(h.requested).toEqual([]);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(h.requested).toHaveLength(1);
      expect(h.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a write request that answers an error status is a failure the audit keeps', async () => {
    const h = harness([js({ allow: { network: true, write: true } })], { status: 500, js: async () => ({ writes: [{ id: 'post', body: '{}' }] }) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.requested).toHaveLength(1);
  });

  it('keeps plain settings in the workspace list and secrets out of it', () => {
    const h = harness([js()]);
    setPluginSetting('web-search', 'url', 'http://searx.local:8080', h.deps);
    expect(h.list()[0].settings).toEqual({ url: 'http://searx.local:8080' });
    expect(() => setPluginSetting('web-search', 'url', 'ftp://x', h.deps)).toThrow();
    expect(() => setPluginSetting('web-search', 'token', 'x', h.deps)).toThrow();
    const view = setPluginSecret('web-search', 'token', 'sk-test-123', h.deps);
    expect(JSON.stringify(h.config())).not.toContain('sk-test-123');
    expect(view.plugins[0].settings.find((x) => x.key === 'token')).toMatchObject({ value: null, filled: true });
    setPluginSecret('web-search', 'token', '', h.deps);
    expect(listPlugins(h.deps).plugins[0].settings.find((x) => x.key === 'token')?.filled).toBe(false);
  });
});

describe('the note a plugin gives the agents', () => {
  it('comes from the plugins that are on and not refused, with their names', () => {
    const h = harness([plugin({ agents: 'search for you' }), plugin({ id: 'off', name: 'Off', enabled: false, agents: 'x' }), plugin({ id: 'quiet', name: 'Quiet' })]);
    expect(pluginNotes(h.deps)).toEqual([{ name: 'Web search', note: 'search for you' }]);
    setPluginEnabled('web-search', false, h.deps);
    expect(pluginNotes(h.deps)).toEqual([]);
  });
});

describe('what the review of the requests asked for', () => {
  const settings = [{ key: 'url', label: 'Instance URL', kind: 'url' as const, required: true }];
  const read = { id: 'search', method: 'GET' as const, url: '{settings.url}/search', secret: null, write: false, reversible: false };
  const post = { id: 'post', method: 'POST' as const, url: 'https://hooks.example.com/notify', secret: null, write: true, reversible: true };
  const js = (over: Partial<PluginRecord> = {}) => plugin({ entry: 'index.mjs', runtime: 'js', network: [], write: null, settings, requests: [read, post], values: { url: 'http://127.0.0.1:8888' }, ...over });

  it('lets no read of a plugin out of a test workspace', async () => {
    guard.test = true;
    try {
      let answer: JsAnswer | null = null;
      const h = harness([js({ allow: { network: true, write: true } })], { js: async (r) => ((answer = await r({ id: 'search' })), {}) });
      await firePluginEvent('stage-finished', ctx(), h.deps);
      expect(h.fetched).toEqual([]);
      expect(answer).toMatchObject({ refused: expect.stringContaining('test workspace') });
    } finally {
      guard.test = false;
    }
  });

  it('does not send a write whose destination changed between the request and the answer', async () => {
    const record = js({ allow: { network: true, write: false } });
    const h = harness([record], { js: async () => ({ writes: [{ id: 'post', body: '{}' }] }) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    const asked = h.actions.find((a) => a.kind === 'plugin-ask') as ReleaseAction;
    record.requests = [read, { ...post, url: 'https://elsewhere.example.com/notify' }];
    await answerPluginAsk(asked.id, 'once', h.deps);
    expect(h.fetched).toEqual([]);
    expect(h.settled.at(-1)?.note?.code).toBe('run.plugin.failed');
  });

  it('asks for no permission while a required setting is empty', async () => {
    const h = harness([js({ values: {} })]);
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.actions).toEqual([]);
  });

  it('refuses a URL setting that carries a user or a password', () => {
    const h = harness([js()]);
    expect(() => setPluginSetting('web-search', 'url', 'https://me:pw@searx.example.com', h.deps)).toThrow();
    expect(h.list()[0].settings).toEqual({ url: 'http://127.0.0.1:8888' });
  });

  it('keeps two different write requests of the same id apart', async () => {
    const h = harness([js({ allow: { network: true, write: false } })], { js: async () => ({ writes: [{ id: 'post', body: '{"a":1}' }, { id: 'post', body: '{"a":2}' }] }) });
    await firePluginEvent('stage-finished', ctx(), h.deps);
    expect(h.actions.filter((a) => a.kind === 'plugin-ask')).toHaveLength(2);
  });
});

