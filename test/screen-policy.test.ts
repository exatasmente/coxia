// What a paired browser may do to an agent's virtual screen (#157): watch (a read of the runs family) and nothing else. Taking control and sending input are the desktop
// window's, denied by a pattern over the whole `screen:` prefix, so a channel added under it later is closed from the day it exists.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const SRC = join(import.meta.dirname, '../src/main');

describe('web policy for the screen channels', () => {
  it.each(['screen:control', 'screen:input', 'screen:handoffTake', 'screen:handoffGive', 'screen:handoffFrame', 'screen:anything-new'])('denies %s to a paired browser, with or without the external-effects switch', (channel) => {
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

  it('is every screen channel a module serves: each one is denied, and there are the seven this feature has', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(screen:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served.sort()).toEqual(['screen:control', 'screen:handoffFrame', 'screen:handoffGive', 'screen:handoffTake', 'screen:input', 'screen:revoke', 'screen:sites']);
    for (const channel of served) expect(webAccess(channel), channel).toBe('deny');
  });

  it('keeps the input channels out of the runs family, where no channel may be desktop-only', () => {
    const module = readFileSync(join(SRC, 'runner/module.ts'), 'utf8');
    expect(module).not.toMatch(/ctx\.handle\('screen:/);
    expect([...module.matchAll(/ctx\.handle\('(runs:[\w-]+)'/g)].map((m) => m[1])).toContain('runs:screen');
  });

  it('serves one picture under screen:, the desktop window\'s own for a hand-off, and every other reader\'s is a read of the runs family', () => {
    const files = readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    const owners = files.filter((f) => /(?:ctx\.handle|handle)\(\s*'screen:[\w-]+'/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(owners.sort()).toEqual(['browser/module.ts', 'screen/module.ts']);
    // A module that serves `screen:` neither makes a picture nor touches the encoder or an image; the one exception is the hand-off's frame read, which asks the hub for the
    // person's picture (the one reader the withheld interval lets through) and nothing else.
    const browser = readFileSync(join(SRC, 'browser/module.ts'), 'utf8');
    expect(browser).not.toMatch(/\.frame\(|createFrameEncoder|encoderHost|nativeImage|jpeg/i);
    const screen = readFileSync(join(SRC, 'screen/module.ts'), 'utf8');
    expect(screen).not.toMatch(/createFrameEncoder|encoderHost|nativeImage|jpeg/i);
    const reads = [...screen.matchAll(/\.frame\(([^\n]*)\)/g)].map((m) => m[1]);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("'person')");
    const named = [...screen.matchAll(/handle\('(screen:[\w-]+)'/g)].map((m) => m[1]);
    expect(named.filter((c) => /frame|image|picture|shot|pixel/i.test(c))).toEqual(['screen:handoffFrame']);
    expect(readFileSync(join(SRC, 'runner/module.ts'), 'utf8')).toMatch(/ctx\.handle\('runs:screen',/);
  });

  it('serves the watching of a paired browser from the runs family only, as the web viewer, which is withheld while the person holds the screen', () => {
    const module = readFileSync(join(SRC, 'runner/module.ts'), 'utf8');
    const read = module.split('\n').find((l) => l.includes("ctx.handle('runs:screen',")) ?? '';
    expect(read).toContain('hub.frame(');
    expect(read).not.toContain("'person'");
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

describe('the hand-off channels', () => {
  it('keeps taking the screen, giving it back and its picture to the desktop window, and declining open to a paired browser', () => {
    for (const channel of ['screen:handoffTake', 'screen:handoffGive', 'screen:handoffFrame']) {
      expect(webAccess(channel), channel).toBe('deny');
      expect(webRefusal(channel, true), channel).not.toBeNull();
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
    }
    // Declining gives the agent nothing and takes no screen: a person away from the computer can do it from the phone.
    expect(webAccess('runs:handoffDecline')).toBe('allow');
    expect(webRefusal('runs:handoffDecline', false)).toBeNull();
    expect(DESKTOP_ONLY.has('runs:handoffDecline')).toBe(false);
    expect(EXTERNAL_EFFECT.has('runs:handoffDecline')).toBe(false);
  });
});
