import { describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { mayReachNetwork, pluginAnswers, pluginNetworkSandbox, pluginWriteStep, type PluginPermission } from '../src/shared/plugins/grants';

// What the person allowed a plugin decides whether it runs with the network, what its sandbox reaches and what happens to its write. Pure: every
// combination of always / session / once / nothing, reversible or not, is pinned here without a sandbox or a file.

const none = { network: false, write: false };
const perm = (over: Partial<PluginPermission> = {}): PluginPermission => ({ allow: none, session: none, ...over });
const reversible = { to: 'results', reversible: true };
const irreversible = { to: 'results', reversible: false };

describe('the network of a plugin', () => {
  it('needs no permission when the plugin declared no destination', () => {
    expect(mayReachNetwork([], perm())).toBe(true);
  });

  it('is allowed by always, by the session, or by the answer being carried out — and by nothing else', () => {
    const hosts = ['search.example.com'];
    expect(mayReachNetwork(hosts, perm())).toBe(false);
    expect(mayReachNetwork(hosts, perm({ allow: { network: true, write: false } }))).toBe(true);
    expect(mayReachNetwork(hosts, perm({ session: { network: true, write: false } }))).toBe(true);
    expect(mayReachNetwork(hosts, perm({ once: { network: true } }))).toBe(true);
    expect(mayReachNetwork(hosts, perm({ allow: { network: false, write: true } }))).toBe(false);
  });

  it('opens the sandbox to exactly the declared destinations, never the workspace list, and closes it otherwise', () => {
    const workspace = { ...neutralSandbox(), network: 'registry' as const, registryHosts: ['registry.example.com'] };
    expect(pluginNetworkSandbox(workspace, ['Search.Example.com', 'search.example.com'], perm({ once: { network: true } }))).toMatchObject({ network: 'registry', registryHosts: ['search.example.com'] });
    expect(pluginNetworkSandbox(workspace, ['search.example.com'], perm())).toMatchObject({ network: 'off', registryHosts: [] });
    expect(pluginNetworkSandbox(workspace, [], perm({ allow: { network: true, write: false } }))).toMatchObject({ network: 'off', registryHosts: [] });
  });

  it('keeps the workspace limits and folders', () => {
    const workspace = { ...neutralSandbox(), readOnlyPaths: ['/opt/tool'] };
    expect(pluginNetworkSandbox(workspace, ['search.example.com'], perm({ once: { network: true } })).readOnlyPaths).toEqual(['/opt/tool']);
  });
});

describe('the write of a plugin', () => {
  it('is nothing without a declared write or without text', () => {
    expect(pluginWriteStep(null, 'x', perm({ allow: { network: false, write: true } }))).toBe('none');
    expect(pluginWriteStep(reversible, '  ', perm({ allow: { network: false, write: true } }))).toBe('none');
  });

  it('reversible: goes out when allowed always, for the session or once, and asks otherwise', () => {
    expect(pluginWriteStep(reversible, 'x', perm({ allow: { network: false, write: true } }))).toBe('go');
    expect(pluginWriteStep(reversible, 'x', perm({ session: { network: false, write: true } }))).toBe('go');
    expect(pluginWriteStep(reversible, 'x', perm({ once: { write: true } }))).toBe('go');
    expect(pluginWriteStep(reversible, 'x', perm())).toBe('ask');
  });

  it('irreversible: only always counts, and even then it is announced first', () => {
    expect(pluginWriteStep(irreversible, 'x', perm({ allow: { network: false, write: true } }))).toBe('announce');
    expect(pluginWriteStep(irreversible, 'x', perm({ session: { network: false, write: true } }))).toBe('ask');
    expect(pluginWriteStep(irreversible, 'x', perm({ once: { write: true } }))).toBe('ask');
  });

  it('offers only "add to the list" and refuse for an irreversible write, and all four otherwise', () => {
    expect(pluginAnswers('write', false)).toEqual(['always', 'refuse']);
    expect(pluginAnswers('write', true)).toEqual(['once', 'session', 'always', 'refuse']);
    expect(pluginAnswers('network', false)).toEqual(['once', 'session', 'always', 'refuse']);
  });
});
