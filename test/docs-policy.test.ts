import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const SRC = join(import.meta.dirname, '../src/main');

// The documentation of the repositories lives in Settings, which is the desktop window's: starting a run that writes in a worktree and proposes a push, and reading
// what the repositories' folders hold, are not for a paired browser, with the external-effects switch on or off.

describe('web policy for the documentation channels', () => {
  it.each(['docs:start', 'docs:status', 'docs:anything-new'])('denies %s to a paired browser, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
    expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
  });

  it('does not mistake a channel that only has docs in its name for one of them', () => {
    expect(webAccess('runs:docs')).toBe('allow');
    expect(webAccess('mydocs:read')).toBe('allow');
  });

  it('keeps the runs open to the browser as they were, and starts a documentation run only from the desktop', () => {
    expect(webAccess('runs:start')).toBe('allow');
    expect(webAccess('runs:get')).toBe('allow');
    expect([...DESKTOP_ONLY].filter((c) => c.startsWith('docs:'))).toEqual([]);
  });

  it('is every docs channel a module serves: each one is denied', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(docs:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served).toContain('docs:start');
    for (const channel of served) expect(webAccess(channel), channel).toBe('deny');
  });
});
