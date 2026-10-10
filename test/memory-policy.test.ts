// What a paired browser may do with the shared memory (#215): everything the window does, on purpose (the maintainer's decision at gate 1, ahead of #218). The six channels
// are named in webPolicy.ts as open, and any other `memory:` channel is denied by a pattern, so a later change of the default cannot close or open them by accident.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MEMORY_EVENT } from '../src/shared/memoryView';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, MEMORY_CHANNELS, webAccess, webRefusal } from '../src/main/webPolicy';

// The module list pulls in every feature module, and the app's build info reads Electron at load.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
const { moduleList } = await import('../src/main/modules');
const { memoryModule } = await import('../src/main/memory/module');
const { memoryStore } = await import('../src/main/memory/instance');

const SRC = join(import.meta.dirname, '../src/main');
const CHANNELS = ['memory:list', 'memory:read', 'memory:save', 'memory:review', 'memory:remove', 'memory:remove-folder'];

describe('web policy for the memory channels', () => {
  it.each(CHANNELS)('lets a paired browser use %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('allow');
    expect(webRefusal(channel, false)).toBeNull();
    expect(webRefusal(channel, true)).toBeNull();
  });

  it('names exactly the six channels as open, and puts none of them in a set of the policy', () => {
    expect([...MEMORY_CHANNELS].sort()).toEqual([...CHANNELS].sort());
    for (const channel of CHANNELS) {
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
  });

  it.each(['memory:made-up', 'memory:', 'memory:list2', 'memory:save:x', 'memory:remove-folders', 'memory:removeFolder', 'memory:LIST', 'memory:list:all', 'memory:config', 'memory:export'])('denies %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
  });

  it('does not mistake a channel that only has memory in its name for one of them', () => {
    for (const channel of ['runs:memory', 'runs:activitySave', 'forum:memory:save', 'mymemory:list', 'memories:list', 'procedures:memory']) {
      expect(webAccess(channel) === 'deny' && channel.startsWith('memory:'), channel).toBe(false);
    }
    expect(webAccess('runs:memory')).toBe('allow');
    expect(webAccess('runs:activitySave')).toBe('allow');
    expect(webAccess('forum:memory:save')).toBe('allow');
  });

  it('turns the memory on and off from a paired browser through the config channel that already exists, and no other', () => {
    expect(webAccess('config:cycle-save')).toBe('allow');
    expect(webAccess('config:save')).toBe('deny');
  });

  it('classifies every memory channel a module registers: the six open, no other', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(memory:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual([...CHANNELS].sort());
    for (const channel of served) expect(webAccess(channel), channel).toBe('allow');
  });

  it('registers the channels it serves, in the list of modules the app registers', () => {
    expect(moduleList()).toContain(memoryModule);
    const handled: string[] = [];
    memoryModule({ handle: (channel: string) => void handled.push(channel), notify: vi.fn(), emit: vi.fn(), job: vi.fn() });
    expect(handled.sort()).toEqual([...CHANNELS].sort());
  });

  it('has no channel for the agents tools: they are in process', () => {
    for (const f of readdirSync(join(SRC, 'memory')).filter((x) => /^(tools|engineTool|session|port)\.ts$/.test(x))) {
      expect(readFileSync(join(SRC, 'memory', f), 'utf8'), f).not.toMatch(/handle\(\s*'memory:/);
    }
  });

  it('tells the window when the memory changes, with nothing in the event', () => {
    const emit = vi.fn();
    memoryModule({ handle: vi.fn(), notify: vi.fn(), emit, job: vi.fn() });
    expect(MEMORY_EVENT).toBe('memory-changed');
    const store = memoryStore();
    const made = store.save({ scope: { conversation: 'policy-test', agent: 'developer' }, kind: 'note', title: 'A note', text: 'Text of the note.' });
    expect(made.ok).toBe(true);
    expect(emit).toHaveBeenCalledWith({ type: 'module', name: 'memory-changed', payload: null });
    emit.mockClear();
    store.removeConversation('policy-test');
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
