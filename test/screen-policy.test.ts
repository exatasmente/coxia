// What a paired browser may do to an agent's virtual screen (#157): watch (a read of the runs family) and nothing else. Taking control and sending input are the desktop
// window's, denied by a pattern over the whole `screen:` prefix, so a channel added under it later is closed from the day it exists.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const SRC = join(import.meta.dirname, '../src/main');

describe('web policy for the screen channels', () => {
  it.each(['screen:control', 'screen:input', 'screen:anything-new'])('denies %s to a paired browser, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
    expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
  });

  it('denies a channel made up under the prefix without it being listed anywhere', () => {
    expect(DESKTOP_ONLY.has('screen:made-up')).toBe(false);
    expect(webAccess('screen:made-up')).toBe('deny');
    expect(webAccess('screen:')).toBe('deny');
  });

  it('lets a paired browser watch: the frame is a read of the runs family, open like the others', () => {
    expect(webAccess('runs:screen')).toBe('allow');
    expect(webRefusal('runs:screen', false)).toBeNull();
    expect(DESKTOP_ONLY.has('runs:screen')).toBe(false);
    expect(EXTERNAL_EFFECT.has('runs:screen')).toBe(false);
  });

  it('does not mistake a channel that only has screen in its name for one of them', () => {
    for (const channel of ['runs:screen', 'myscreen:read', 'runs:screenshot', 'sandbox:screen', 'screens:list']) expect(webAccess(channel), channel).toBe('allow');
  });

  it('keeps the list of desktop-only channels as it was: the prefix is closed by the pattern, not by an entry', () => {
    expect([...DESKTOP_ONLY].filter((c) => c.startsWith('screen:'))).toEqual([]);
  });

  it('is every screen channel a module serves: each one is denied, and there are the two this feature has', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(screen:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual(['screen:control', 'screen:input']);
    for (const channel of served) expect(webAccess(channel), channel).toBe('deny');
  });

  it('keeps the input channels out of the runs family, where no channel may be desktop-only', () => {
    const module = readFileSync(join(SRC, 'runner/module.ts'), 'utf8');
    expect(module).not.toMatch(/ctx\.handle\('screen:/);
    expect([...module.matchAll(/ctx\.handle\('(runs:[\w-]+)'/g)].map((m) => m[1])).toContain('runs:screen');
  });
});
