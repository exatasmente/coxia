// What a paired browser may do with the persona's chat (#247): everything the window does, on purpose (the maintainer's decision at gate 1). The text of an answer being
// written is read through `persona:live-read`; the conversation itself goes through `forum:*` and the Stop through `runs:callStop`, both open. The channels of the persona's own
// are named as open, and any other `persona:` channel is denied by a pattern built from the same set, so the tools of the later issues of the epic start closed.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PERSONA_LIVE_EVENT, PERSONA_LIVE_READ } from '../src/shared/persona';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, PERSONA_CHANNELS, webAccess, webRefusal } from '../src/main/webPolicy';

// The module list pulls in every feature module, and the app's build info reads Electron at load.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
const { moduleList } = await import('../src/main/modules');
const { personaModule } = await import('../src/main/persona/module');

const SRC = join(import.meta.dirname, '../src/main');
const CHANNELS = ['persona:live-read'];

describe('web policy for the persona\'s channels', () => {
  it.each(CHANNELS)('lets a paired browser use %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('allow');
    expect(webRefusal(channel, false)).toBeNull();
    expect(webRefusal(channel, true)).toBeNull();
  });

  it('names exactly the channels as open, and puts none of them in a set of the policy', () => {
    expect([...PERSONA_CHANNELS].sort()).toEqual([...CHANNELS].sort());
    expect(PERSONA_LIVE_READ).toBe('persona:live-read');
    for (const channel of CHANNELS) {
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
  });

  it.each(['persona:made-up', 'persona:', 'persona:live-read2', 'persona:live-read:x', 'persona:LIVE-READ', 'persona:live', 'persona:round2', 'persona:save-all', 'persona:approve'])('denies %s, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
  });

  it('does not mistake a channel that only has persona in its name for one of them', () => {
    for (const channel of ['runs:persona', 'forum:persona:x', 'mypersona:round', 'personas:list', 'procedures:persona']) {
      expect(webAccess(channel) === 'deny' && channel.startsWith('persona:'), channel).toBe(false);
    }
    expect(webAccess('runs:persona')).toBe('allow');
    expect(webAccess('forum:persona:x')).toBe('allow');
  });

  it('keeps the creator\'s channels closed to a paired browser, as they were', () => {
    for (const channel of ['agentAssist:round', 'agentAssist:review', 'agentAssist:saveDraft', 'agentAssist:conclude', 'agentAssist:discard']) expect(webAccess(channel), channel).toBe('deny');
  });

  it('opens the chat through the channels that already exist: the forum and the Stop of a call', () => {
    for (const channel of ['forum:list', 'forum:read', 'forum:post', 'forum:attachment-put', 'forum:attachment-post', 'runs:callStop']) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
    }
  });

  it('classifies every persona channel a module registers: the set, no other', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*(?:'(persona:[\w-]+)'|(PERSONA_[A-Z_]+))/g)) served.push(m[1] ?? (m[2] === 'PERSONA_LIVE_READ' ? PERSONA_LIVE_READ : m[2]));
    }
    expect(served.sort()).toEqual([...CHANNELS].sort());
    for (const channel of served) expect(webAccess(channel), channel).toBe('allow');
  });
});

describe('the persona module', () => {
  it('is in the list the app registers: a module written but missing there never runs', () => {
    expect(moduleList()).toContain(personaModule);
  });

  it('registers the live read, answers it from the store, and publishes the text of an answer on the module channel the window and the browsers hear', async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const emitted: unknown[] = [];
    personaModule({ handle: (channel, fn) => void handlers.set(channel, fn), notify: () => undefined, emit: (e) => void emitted.push(e), job: () => undefined });
    expect([...handlers.keys()]).toEqual([PERSONA_LIVE_READ]);
    expect(PERSONA_LIVE_EVENT).toBe('persona:live');

    const { personaLive } = await import('../src/main/persona/runtime');
    const live = personaLive();
    live.begin('agent-me', 4, 'me');
    live.sink('agent-me', 4).settle('Hello there.');
    expect(emitted).toEqual([{ type: 'module', name: PERSONA_LIVE_EVENT, payload: { thread: 'agent-me', to: 4, agent: 'me', rev: 1, offset: 0, text: 'Hello there.' } }]);
    const read = handlers.get(PERSONA_LIVE_READ) as (thread: unknown) => unknown;
    expect(read('agent-me')).toEqual([{ thread: 'agent-me', to: 4, agent: 'me', rev: 1, text: 'Hello there.' }]);
    expect(read('agent-other')).toEqual([]);
    expect(read(7)).toEqual([]);
    live.end('agent-me', 4);
    expect(read('agent-me')).toEqual([]);
  });
});
