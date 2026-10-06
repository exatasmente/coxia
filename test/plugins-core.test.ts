import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_CONTRACT, readPluginDeclaration } from '../src/shared/plugins/declaration';
import { PLUGIN_EVENTS } from '../src/shared/plugins/events';
import { pluginsDirOf, pluginViews, readPlugins, withChoice } from '../src/main/plugins/read';
import { neutralPlugins } from '../src/shared/config/defaults';

// The plugin core is pure: it reads the text of a declaration and the folder a plugin lives in, and judges it. The folder read is
// exercised against a throwaway directory, never the person's workspace.

const declaration = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: 'web-search',
    name: 'Web search',
    contract: PLUGIN_CONTRACT,
    offers: {
      events: ['stage-finished'],
      documents: [{ name: '7_WEB_SEARCH.md', label: 'plugins.webSearch.document' }],
      network: ['search.example.com'],
      write: { to: 'results', reversible: true },
      entry: 'search.sh',
    },
    ...over,
  });

describe('the plugin declaration', () => {
  it('reads a valid declaration into what the plugin offers', () => {
    const r = readPluginDeclaration(declaration(), '/plugins/web-search');
    expect(r.refused).toBeNull();
    expect(r.declaration).toMatchObject({
      id: 'web-search',
      name: 'Web search',
      contract: PLUGIN_CONTRACT,
      offers: { events: ['stage-finished'], network: ['search.example.com'], write: { to: 'results', reversible: true }, entry: 'search.sh' },
    });
    expect(r.declaration?.offers.documents).toEqual([{ name: '7_WEB_SEARCH.md', label: 'plugins.webSearch.document' }]);
  });

  it('refuses a declaration with no name, with no identity, and one that is not a plugin id', () => {
    expect(readPluginDeclaration(declaration({ name: '' }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ id: '' }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ id: 'Bad Id' }), '/p').refused).toBeTruthy();
  });

  it('refuses an empty, non-JSON or non-object declaration', () => {
    expect(readPluginDeclaration('', '/p').refused).toBeTruthy();
    expect(readPluginDeclaration('not json', '/p').refused).toBeTruthy();
    expect(readPluginDeclaration('[]', '/p').refused).toBeTruthy();
  });

  it('refuses a contract version this app does not understand', () => {
    const r = readPluginDeclaration(declaration({ contract: 99 }), '/p');
    expect(r.declaration).toBeNull();
    expect(r.refused).toBeTruthy();
  });

  it('refuses an event outside the fixed catalog', () => {
    const r = readPluginDeclaration(declaration({ offers: { events: ['stage-exploded'] } }), '/p');
    expect(r.declaration).toBeNull();
    expect(r.refused).toBeTruthy();
  });

  it('accepts every event of the catalog', () => {
    const r = readPluginDeclaration(declaration({ offers: { events: [...PLUGIN_EVENTS] } }), '/p');
    expect(r.declaration?.offers.events).toEqual([...PLUGIN_EVENTS]);
  });

  it('refuses a document name the cycle folder would not take', () => {
    for (const name of ['.hidden', 'a/b.md', '', 'x'.repeat(101)]) {
      expect(readPluginDeclaration(declaration({ offers: { documents: [{ name, label: 'x' }] } }), '/p').refused, name).toBeTruthy();
    }
  });

  it('refuses a write destination that is not a plain name, and an entry script that escapes the plugin folder', () => {
    expect(readPluginDeclaration(declaration({ offers: { write: '../out' } }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ offers: { write: '/etc/passwd' } }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ offers: { write: { to: 'plugin://x/y', reversible: true } } }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ offers: { entry: '../../bin/sh' } }), '/p').refused).toBeTruthy();
    expect(readPluginDeclaration(declaration({ offers: { entry: '/bin/sh' } }), '/p').refused).toBeTruthy();
  });

  it('reads a write as reversible only when it says so: silence is the irreversible write', () => {
    expect(readPluginDeclaration(declaration({ offers: { write: { to: 'results', reversible: true } } }), '/p').declaration?.offers.write).toEqual({ to: 'results', reversible: true });
    expect(readPluginDeclaration(declaration({ offers: { write: { to: 'results' } } }), '/p').declaration?.offers.write).toEqual({ to: 'results', reversible: false });
    expect(readPluginDeclaration(declaration({ offers: { write: { to: 'results', reversible: 'yes' } } }), '/p').declaration?.offers.write).toEqual({ to: 'results', reversible: false });
    expect(readPluginDeclaration(declaration({ offers: { write: 'results' } }), '/p').declaration?.offers.write).toEqual({ to: 'results', reversible: false });
  });

  it('refuses a network destination that is not a host name', () => {
    for (const host of ['https://example.com', 'a b', '-x', 'x-']) {
      expect(readPluginDeclaration(declaration({ offers: { network: [host] } }), '/p').refused, host).toBeTruthy();
    }
  });

  it('reads a declaration that offers nothing else', () => {
    const r = readPluginDeclaration(JSON.stringify({ id: 'plain', name: 'Plain' }), '/p');
    expect(r.refused).toBeNull();
    expect(r.declaration?.offers).toEqual({ events: [], documents: [], network: [], write: null, entry: null, runtime: 'shell', settings: [], requests: [], agents: null });
  });
});

describe('reading the plugins folder', () => {
  let dir: string;
  const write = (name: string, text: string): void => {
    const folder = join(dir, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'plugin.json'), text);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coxia-plugins-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads one record per plugin folder, and ignores a folder without a declaration', () => {
    write('web-search', declaration());
    mkdirSync(join(dir, 'empty'), { recursive: true });
    const records = readPlugins(dir, neutralPlugins());
    expect(records.map((r) => r.id)).toEqual(['web-search']);
    expect(records[0].enabled).toBe(false);
    expect(records[0].refused).toBeNull();
  });

  it('returns nothing for a folder that does not exist', () => {
    expect(readPlugins(join(dir, 'nope'), neutralPlugins())).toEqual([]);
  });

  it('keeps a refused declaration in the list with its reason, without throwing', () => {
    write('bad', declaration({ offers: { events: ['nope'] } }));
    const records = readPlugins(dir, neutralPlugins());
    expect(records).toHaveLength(1);
    expect(records[0].refused).toBeTruthy();
    expect(records[0].enabled).toBe(false);
  });

  it('refuses a repeated identity, keeping the first', () => {
    write('a', declaration());
    write('b', declaration());
    const records = readPlugins(dir, neutralPlugins());
    expect(records).toHaveLength(2);
    expect(records[0].refused).toBeNull();
    expect(records[1].refused).toContain('duplicate');
  });

  it('applies the person choices by identity: what is on, what was allowed always', () => {
    write('web-search', declaration());
    const records = readPlugins(dir, { ...neutralPlugins(), list: [{ id: 'web-search', folder: null, enabled: true, allow: { network: true, write: false }, settings: {} }] });
    expect(records[0].enabled).toBe(true);
    expect(records[0].allow).toEqual({ network: true, write: false });
  });

  it('reads an allow that is not exactly true as not allowed', () => {
    write('web-search', declaration());
    const list = [{ id: 'web-search', folder: null, enabled: true, allow: { network: 'yes', write: 1 } }] as never;
    expect(readPlugins(dir, { ...neutralPlugins(), list })[0].allow).toEqual({ network: false, write: false });
  });

  it('offers nothing for a plugin that is off, and everything for one that is on', () => {
    write('web-search', declaration());
    const none = () => ({ network: false, write: false });
    const off = pluginViews(readPlugins(dir, neutralPlugins()), none, () => 0);
    expect(off[0].enabled).toBe(false);
    const on = pluginViews(readPlugins(dir, { ...neutralPlugins(), list: [{ id: 'web-search', folder: null, enabled: true, allow: none(), settings: {} }] }), () => ({ network: true, write: false }), () => 2);
    expect(on[0]).toMatchObject({ session: { network: true, write: false }, waiting: 2 });
    expect(on[0]).toMatchObject({ enabled: true, events: ['stage-finished'] });
    expect(on[0].documents).toEqual([{ name: '7_WEB_SEARCH.md', label: 'plugins.webSearch.document' }]);
  });

  it('changes only the entry of the plugin being decided, and keeps the entry of a plugin the read did not find', () => {
    const gone = { id: 'gone', folder: '/old/gone', enabled: true, allow: { network: true, write: true }, settings: {} };
    const list = [gone, { id: 'web-search', folder: null, enabled: false, allow: { network: true, write: false }, settings: {} }];
    const next = withChoice(list, { id: 'web-search', dir: join(dir, 'web-search') }, (c) => ({ ...c, enabled: true }));
    expect(next).toEqual([gone, { id: 'web-search', folder: join(dir, 'web-search'), enabled: true, allow: { network: true, write: false }, settings: {} }]);
  });

  it('adds the entry of a plugin decided for the first time, off and allowed nothing until the change says otherwise', () => {
    const next = withChoice([], { id: 'web-search', dir: '/p/web-search' }, (c) => c);
    expect(next).toEqual([{ id: 'web-search', folder: '/p/web-search', enabled: false, allow: { network: false, write: false }, settings: {} }]);
  });
});

describe('the plugins folder of a workspace', () => {
  it('is what the config lists, expanded, or the plugins folder of the data folder', () => {
    expect(pluginsDirOf(neutralPlugins(), '/home/ana', '/data/ws')).toBe('/data/ws/plugins');
    expect(pluginsDirOf({ ...neutralPlugins(), dir: '~/my-plugins' }, '/home/ana', '/data/ws')).toBe('/home/ana/my-plugins');
    expect(pluginsDirOf({ ...neutralPlugins(), dir: '/opt/plugins' }, '/home/ana', '/data/ws')).toBe('/opt/plugins');
  });
});
