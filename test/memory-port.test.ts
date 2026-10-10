import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMemoryPort } from '../src/main/memory/port';
import { conversationsPath } from '../src/main/memory/store';
import { memoryWorld, openCtx } from './helpers/memory';

// The door a call goes through for its memory: off is nothing at all, a reader makes no folder, and a memory that cannot be opened never fails the call.

describe('the port', () => {
  it('answers null when the switch is off or absent, and makes no folder', async () => {
    const w = memoryWorld();
    w.config.runner.sharedMemory = false;
    expect(await w.port().open(openCtx())).toBeNull();
    delete w.config.runner.sharedMemory;
    expect(await w.port().open(openCtx())).toBeNull();
    expect(existsSync(conversationsPath(w.ws))).toBe(false);
    expect(w.lines).toEqual([]);
    expect(w.audits).toEqual([]);
  });

  it('opens a writing session with its folder, and a read-only one without', async () => {
    const w = memoryWorld();
    const read = await w.port().open(openCtx({ surface: 'chain', conversation: null, writes: false }));
    expect(read?.writes).toBe(false);
    expect(read?.tools?.save).toBeUndefined();
    expect(existsSync(conversationsPath(w.ws))).toBe(false);
    const write = await w.port().open(openCtx());
    expect(write?.writes).toBe(true);
    expect(existsSync(`${conversationsPath(w.ws)}/general/developer`)).toBe(true);
  });

  it('reads the switch at every open, so turning it on later takes effect without a restart', async () => {
    const w = memoryWorld();
    const port = w.port();
    w.config.runner.sharedMemory = false;
    expect(await port.open(openCtx())).toBeNull();
    w.config.runner.sharedMemory = true;
    expect(await port.open(openCtx())).not.toBeNull();
  });

  it('logs the entries, characters and entries left out of every call, and keeps them on the session', async () => {
    const w = memoryWorld();
    const s = await w.port().open(openCtx({ surface: 'direct', agent: { id: 'qa', permission: 'read', model: { role: null, provider: 'p', model: 'm' } } as never }));
    expect(w.lines).toEqual([`[memory] direct qa entries=${s?.list.entries} chars=${s?.list.chars} omitted=${s?.list.omitted}`]);
  });

  it('goes on without memory when opening throws, and says so once', async () => {
    const w = memoryWorld();
    const errors: string[] = [];
    const port = createMemoryPort({
      config: () => w.config,
      store: w.store,
      index: {
        ...w.index,
        list: async () => {
          throw new Error('/home/person/private/path exploded');
        },
      },
      onError: (source, e) => errors.push(`${source}: ${e.message}`),
    });
    expect(await port.open(openCtx())).toBeNull();
    expect(await port.open(openCtx())).toBeNull();
    expect(errors).toEqual(['memory: the memory could not be opened (Error)']);
    expect(errors.join()).not.toContain('private');
  });
});
