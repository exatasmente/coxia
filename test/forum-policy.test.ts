import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const CHANNELS = ['forum:list', 'forum:read', 'forum:post', 'forum:create', 'forum:attachment-put', 'forum:attachment-post', 'forum:attachment-drop', 'forum:attachment-get', 'forum:attachment-delete'];

describe('web policy for the forum', () => {
  it('lets a paired browser list, read, post, open a general thread and send the files of a message: they only touch the workspace\'s own files', () => {
    for (const channel of CHANNELS) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
    }
  });

  it('puts none of them behind the desktop window or the external-effects switch: nothing in them reaches the code host', () => {
    for (const channel of CHANNELS) {
      expect(DESKTOP_ONLY.has(channel)).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
    }
  });

  it('are exactly the channels the module serves', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/main/forum.ts'), 'utf8');
    const served = [...src.matchAll(/ctx\.handle\('(forum:[\w-]+)'/g)].map((m) => m[1]);
    expect(served.sort()).toEqual([...CHANNELS].sort());
  });

  it('the module imports nothing that writes to a code host or runs an agent', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/main/forum.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\/(actions|agents|vcs)/);
  });
});
