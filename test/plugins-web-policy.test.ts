import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { webAccess } from '../src/main/webPolicy';

// Only the computer widens or narrows what a plugin reaches (spec rule 10): every plugin channel but the list is denied to a paired browser, and
// the list of channels is read from the module, so a new one cannot be left out. Blocking an announced write is actions:skip, open to the browser.

const channels = [...readFileSync(new URL('../src/main/plugins/module.ts', import.meta.url), 'utf8').matchAll(/ctx\.handle\('(plugins:[a-z-]+)'/g)].map((m) => m[1]);

describe('the plugin channels and a paired browser', () => {
  it('finds the channels the module registers', () => {
    expect(channels).toEqual(expect.arrayContaining(['plugins:list', 'plugins:set-enabled', 'plugins:settings', 'plugins:answer', 'plugins:revoke', 'plugins:revoke-write']));
  });

  it('denies every decision about a plugin, and only lets the list be read', () => {
    for (const channel of channels) expect(webAccess(channel), channel).toBe(channel === 'plugins:list' ? 'allow' : 'deny');
  });

  it('lets a paired browser block an announced write, and keeps approving a write behind the external-effects switch', () => {
    expect(webAccess('actions:skip')).toBe('allow');
    expect(webAccess('actions:approve')).toBe('external');
  });
});
