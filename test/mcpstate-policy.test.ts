// The local state server's doors are desktop-only: the view answers machine-local paths and the write offers write a project folder's file, so a
// paired browser never reaches them in full — the whole `mcpstate:` prefix is denied by one pattern, and a channel added later under it is closed
// from the day it exists. The panel's rendered-empty guard is checked in test/settings-mcp-state.test.ts; this pins the channel-level denial.
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_ONLY, webAccess, webRefusal } from '../src/main/webPolicy';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() } }));

const CHANNELS = ['mcpstate:get', 'mcpstate:set-enabled', 'mcpstate:write-entry'];

describe('web policy for the mcpstate channels', () => {
  it.each([...CHANNELS, 'mcpstate:made-up', 'mcpstate:', 'mcpstate:get2'])('denies %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
  });

  it('closes the prefix by a pattern, not by an entry: none is in a set by name', () => {
    for (const channel of CHANNELS) expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
  });

  it('does not mistake a channel that only has mcpstate in its name for one of them', () => {
    for (const channel of ['runs:mcpstate', 'mcpstateful:get', 'mcpstates:write-entry']) expect(webAccess(channel), channel).toBe('allow');
  });
});
