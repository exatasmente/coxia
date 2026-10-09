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

  it.each(['screen:sites', 'screen:revoke'])('denies %s, the sites of an agent\'s logged-in browser, to a paired browser with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, true)).not.toBeNull();
    expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
  });

  it('is every screen channel a module serves: each one is denied, and there are the four this feature has', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(screen:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual(['screen:control', 'screen:input', 'screen:revoke', 'screen:sites']);
    for (const channel of served) expect(webAccess(channel), channel).toBe('deny');
  });

  it('keeps the input channels out of the runs family, where no channel may be desktop-only', () => {
    const module = readFileSync(join(SRC, 'runner/module.ts'), 'utf8');
    expect(module).not.toMatch(/ctx\.handle\('screen:/);
    expect([...module.matchAll(/ctx\.handle\('(runs:[\w-]+)'/g)].map((m) => m[1])).toContain('runs:screen');
  });

  it('serves no frame under screen:, where the web policy denies everything: the picture is a read of the runs family and nothing else', () => {
    const files = readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    const owners = files.filter((f) => /(?:ctx\.handle|handle)\(\s*'screen:[\w-]+'/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(owners.sort()).toEqual(['browser/module.ts', 'screen/module.ts']);
    for (const f of owners) {
      const text = readFileSync(join(SRC, f), 'utf8');
      // A module that serves `screen:` neither asks the hub for a picture nor touches the encoder or an image.
      expect(text, f).not.toMatch(/\.frame\(|createFrameEncoder|encoderHost|nativeImage|jpeg/i);
    }
    for (const m of readFileSync(join(SRC, 'screen/module.ts'), 'utf8').matchAll(/handle\('(screen:[\w-]+)'/g)) expect(m[1]).not.toMatch(/frame|image|picture|shot|pixel/i);
    expect(readFileSync(join(SRC, 'runner/module.ts'), 'utf8')).toMatch(/ctx\.handle\('runs:screen',/);
  });

  it('has no channel that moves the pointer or the keyboard outside screen:, where it would be open to a paired browser by default', () => {
    const input = /^(input|control|pointer|mouse|click|wheel|scroll|drag|touch|keyboard|keypress|keydown|keyup|type|press)/i;
    const outside: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handleDevice|[^.\w]handle)\(\s*'([\w-]+):([\w-]+)'/g)) {
        if (m[1] !== 'screen' && input.test(m[2])) outside.push(`${m[1]}:${m[2]}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('keeps the new reads and moves of the screens in the runs family: listing, closing and stopping are open, answering a held step is behind the switch', () => {
    for (const channel of ['runs:screens', 'runs:screenClose', 'runs:callStop']) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
    }
    expect(webAccess('runs:screenAnswer')).toBe('external');
    expect(webRefusal('runs:screenAnswer', false)).not.toBeNull();
    expect(webRefusal('runs:screenAnswer', true)).toBeNull();
    expect(DESKTOP_ONLY.has('runs:screenAnswer')).toBe(false);
  });
});
