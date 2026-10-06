import { describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { PluginConfig, PluginsConfig } from '../src/shared/config/types';
import type { PluginRecord } from '../src/main/plugins/types';

// The plugins service: the list the person sees, the switch that only the computer may throw, and the hook that runs a plugin and
// hands what it asked to write to the single door of Actions. The deps are injected, so nothing here touches the real workspace.

const guard = vi.hoisted(() => ({ test: false }));
vi.mock('../src/main/workspace', async (orig) => {
  const refusal = (what: string) => (guard.test ? `test workspace: ${what}` : null);
  return {
    ...(await orig<typeof import('../src/main/workspace')>()),
    externalRefusal: refusal,
    assertExternalWrite: (what: string) => {
      const message = refusal(what);
      if (message) throw new Error(message);
    },
  };
});

const proposed = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock('../src/main/actions', async (orig) => ({
  ...(await orig<typeof import('../src/main/actions')>()),
  proposePluginWrite: (input: Record<string, unknown>) => void proposed.calls.push(input),
}));

const { firePluginEvent, listPlugins, setPluginEnabled, setPluginGrant } = await import('../src/main/plugins/module');
const { neutralPlugins } = await import('../src/shared/config/defaults');

const record = (over: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'web-search',
  name: 'Web search',
  dir: '/plugins/web-search',
  enabled: true,
  granted: 'none',
  documents: [{ name: '7_WEB_SEARCH.md', label: 'plugins.webSearch.document' }],
  events: ['stage-finished'],
  network: ['search.example.com'],
  write: 'plugin://web-search/results',
  entry: 'search.sh',
  refused: null,
  ...over,
});

/** Deps over an in-memory list: saving replaces the config the next read uses. */
function harness(initial: PluginRecord[]) {
  let config: PluginsConfig = neutralPlugins();
  let records = initial;
  const runs: { plugin: string; event: string }[] = [];
  return {
    runs,
    deps: {
      config: () => config,
      read: () => records,
      worktree: () => '/wt',
      run: async (plugin: PluginRecord, event: string) => {
        runs.push({ plugin: plugin.id, event });
        return { plugin: plugin.id, ok: true, text: 'result from the sandbox', refused: null };
      },
      save: (list: PluginConfig[]) => {
        config = { ...config, list };
        records = records.map((r) => {
          const c = list.find((x) => x.id === r.id);
          return c ? { ...r, enabled: c.enabled, granted: c.granted } : r;
        });
      },
    } as unknown as import('../src/main/plugins/module').PluginsDeps,
  };
}

describe('the plugins service', () => {
  it('lists what each plugin offers and whether it is on', () => {
    const h = harness([record()]);
    expect(listPlugins(h.deps)).toEqual([
      { id: 'web-search', name: 'Web search', folder: '/plugins/web-search', enabled: true, events: ['stage-finished'], documents: [{ name: '7_WEB_SEARCH.md', label: 'plugins.webSearch.document' }], network: ['search.example.com'], granted: 'none', refused: null },
    ]);
  });

  it('switches a plugin off and on, and the change is in force at the next read', () => {
    const h = harness([record()]);
    expect(setPluginEnabled('web-search', false, h.deps)[0].enabled).toBe(false);
    expect(listPlugins(h.deps)[0].enabled).toBe(false);
    expect(setPluginEnabled('web-search', true, h.deps)[0].enabled).toBe(true);
    expect(listPlugins(h.deps)[0].enabled).toBe(true);
  });

  it('grants what a plugin may reach, and refuses an unknown id', () => {
    const h = harness([record()]);
    expect(setPluginGrant('web-search', 'network', h.deps)[0].granted).toBe('network');
    expect(() => setPluginEnabled('ghost', true, h.deps)).toThrow();
  });

  it('runs only the plugins that are on, that observe the event and are not refused', async () => {
    const h = harness([record(), record({ id: 'off', enabled: false, events: ['stage-finished'] }), record({ id: 'other', events: ['run-finished'] }), record({ id: 'bad', refused: 'no name' }), record({ id: 'no-entry', entry: null, write: null })]);
    const out = await firePluginEvent('stage-finished', { issue: 84 }, h.deps);
    expect(h.runs.map((r) => r.plugin)).toEqual(['web-search', 'no-entry']);
    expect(out.every((r) => r.ok)).toBe(true);
  });

  it('hands what the plugin asked to write for to the single door, and nothing when the plugin has no destination', async () => {
    proposed.calls.length = 0;
    const h = harness([record(), record({ id: 'no-entry', entry: null, write: null })]);
    await firePluginEvent('stage-finished', { issue: 84, issueTitle: 'Plugin platform' }, h.deps);
    expect(proposed.calls).toHaveLength(1);
    expect(proposed.calls[0]).toMatchObject({ issue: 84, plugin: 'web-search', destination: 'plugin://web-search/results' });
  });

  it('a plugin that fails does not stop the next one', async () => {
    const h = harness([record({ id: 'first' }), record({ id: 'second' })]);
    h.deps.run = (async (plugin: PluginRecord) => (plugin.id === 'first' ? { plugin: 'first', ok: false, text: '', refused: 'it threw' } : { plugin: 'second', ok: true, text: 'ok', refused: null })) as never;
    const out = await firePluginEvent('stage-finished', { issue: 84 }, h.deps);
    expect(out.map((r) => [r.plugin, r.ok])).toEqual([['first', false], ['second', true]]);
  });
});
