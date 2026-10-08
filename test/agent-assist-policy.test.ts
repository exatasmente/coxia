import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

// The module list pulls in every feature module, and the app's build info reads Electron at load: this file gives Electron what it needs before the list is read.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

// Reading the list loads every module of the app, which is slow on a busy machine: that happens once, here, and not inside a test's time.
vi.setConfig({ testTimeout: 30_000 });
const { MODULES, moduleList } = await import('../src/main/modules');
const { agentAssist } = await import('../src/main/agentAssist');

const SRC = join(import.meta.dirname, '../src/main');

// The agent assistant spends the model on every question and saves an agent with permissions to be tried out: it is the desktop window's, whatever the external-effects
// switch says. A pattern closes it, so a channel added later is closed from the day it exists.

const CHANNELS = ['agentAssist:round', 'agentAssist:review', 'agentAssist:saveDraft', 'agentAssist:conclude', 'agentAssist:discard'];

describe('web policy for the agent assistant', () => {
  it.each([...CHANNELS, 'agentAssist:anything-new'])('denies %s to a paired browser, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
    expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
  });

  it('does not change the list of desktop-only channels: the pattern is what closes them', () => {
    expect([...DESKTOP_ONLY].filter((c) => c.startsWith('agentAssist:'))).toEqual([]);
  });

  it('does not mistake a channel that only has the name in it for one of them', () => {
    expect(webAccess('runs:agentAssist')).toBe('allow');
    expect(webAccess('myagentAssist:round')).toBe('allow');
    expect(webAccess('agentAssists:round')).toBe('allow');
  });

  it('leaves what was open open, and what was closed closed', () => {
    expect(webAccess('forum:list')).toBe('allow');
    expect(webAccess('forum:post')).toBe('allow');
    expect(webAccess('config:cycle-save')).toBe('allow');
    expect(webAccess('suggestions:suggest')).toBe('deny');
    expect(webAccess('actions:approve')).toBe('external');
  });

  it('denies every agentAssist channel a module serves, and a module serves exactly the five', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(agentAssist:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual([...CHANNELS].sort());
    for (const channel of served) expect(webAccess(channel), channel).toBe('deny');
  });
});

describe('the list of modules the app registers', () => {
  it('holds the agent assistant: a module written but missing here never serves a channel', () => {
    expect(moduleList()).toContain(agentAssist);
    expect(MODULES).toContain(agentAssist);
  });

  it('registers the channels of the assistant, each once, and every one of them is denied to a browser', () => {
    const handled: string[] = [];
    agentAssist({ handle: (channel) => void handled.push(channel), notify: () => undefined, emit: () => undefined, job: () => undefined });
    expect(handled.sort()).toEqual([...CHANNELS].sort());
    for (const channel of handled) expect(webAccess(channel), channel).toBe('deny');
  });
});
