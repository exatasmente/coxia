import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { procedureScreen } from '../src/main/procedures/screen';
import { createTypedValues } from '../src/main/screen/typedValues';
import { fakeSteps } from './helpers/screenSteps';

// The procedure memory reads a call's screen through one adapter file (#179, plan section 7): these tests pin what it hands over and that nothing else in the folder
// reaches a browser or a screen module.

const KEY = 'call:t-1:agent';

describe('the steps of a screen', () => {
  it('are all the steps the app\'s browser took since the screen opened, the ones an earlier answer left in a screen kept between messages included (#187)', () => {
    const f = fakeSteps(KEY);
    f.navigate('/old');
    f.click('button', 'Earlier');
    const screen = procedureScreen({ key: KEY, sessions: f.sessions, browser: true });
    expect(screen.steps().map((s) => s.n)).toEqual([1, 2]);
    f.navigate('/budget');
    f.click('button', 'Save');
    expect(screen.steps().map((s) => s.tool)).toEqual(['browser_navigate', 'browser_click', 'browser_navigate', 'browser_click']);
    expect(screen.steps().map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });

  it('start after the mark of the screen, which a call that begins later sees as well', () => {
    const f = fakeSteps(KEY);
    f.navigate('/old');
    f.click('button', 'Earlier');
    f.sessions.mark(KEY, 2);
    f.navigate('/budget');
    const screen = procedureScreen({ key: KEY, sessions: f.sessions, browser: true });
    expect(screen.steps().map((s) => s.n)).toEqual([3]);
    f.sessions.mark(KEY, 3);
    expect(screen.steps()).toEqual([]);
  });

  it('know the last step of the screen and move the mark forward to a step, never back, and quietly when there is no screen', () => {
    const f = fakeSteps(KEY);
    const screen = procedureScreen({ key: KEY, sessions: f.sessions, browser: true });
    expect(screen.lastStep()).toBe(0);
    f.navigate('/a');
    f.click('button', 'Save');
    f.navigate('/b');
    expect(screen.lastStep()).toBe(3);
    screen.advance(2);
    expect(f.sessions.markOf(KEY)).toBe(2);
    expect(screen.steps().map((s) => s.n)).toEqual([3]);
    screen.advance(1);
    expect(f.sessions.markOf(KEY)).toBe(2);
    screen.advance(screen.lastStep());
    expect(screen.steps()).toEqual([]);
    expect(() => procedureScreen({ key: KEY, browser: true }).advance(5)).not.toThrow();
    expect(procedureScreen({ key: KEY, browser: true }).lastStep()).toBe(0);
  });

  it('are none when there is no log: no sessions, another key, or a log that throws', () => {
    const f = fakeSteps(KEY);
    f.navigate('/a');
    expect(procedureScreen({ key: KEY, browser: true }).steps()).toEqual([]);
    expect(procedureScreen({ key: 'call:t-2:agent', sessions: f.sessions, browser: true }).steps()).toEqual([]);
    const broken = procedureScreen({ key: KEY, sessions: { stepsOf: () => { throw new Error('gone'); }, markOf: () => { throw new Error('gone'); }, mark: () => undefined }, browser: true });
    expect(broken.steps()).toEqual([]);
    expect(broken.visited()).toEqual([]);
  });

  it('say whether the call has the app\'s browser, which is what a draft needs', () => {
    expect(procedureScreen({ key: KEY, browser: true }).browser).toBe(true);
    expect(procedureScreen({ key: KEY, browser: false }).browser).toBe(false);
  });
});

describe('the hosts a call visited', () => {
  it('are the sites of its steps, once each and in lower case, and not one the host list turned away', () => {
    const f = fakeSteps(KEY, 'https://Docs.Example.com/');
    const screen = procedureScreen({ key: KEY, sessions: f.sessions, browser: true });
    f.navigate('https://docs.example.com/budget');
    f.click('button', 'Save');
    f.navigate('https://sheets.example.com/a');
    f.navigate('https://elsewhere.example.net/', { outcome: 'not-run' });
    f.handoff();
    expect(screen.visited()).toEqual(['docs.example.com', 'sheets.example.com']);
  });

  it('span the whole screen, not the steps after its mark', () => {
    const f = fakeSteps(KEY);
    const screen = procedureScreen({ key: KEY, sessions: f.sessions, browser: true });
    f.navigate('https://docs.example.com/a');
    f.navigate('https://sheets.example.com/b');
    f.sessions.mark(KEY, 2);
    f.navigate('https://docs.example.com/c');
    expect(screen.steps().map((s) => s.n)).toEqual([3]);
    expect(screen.visited()).toEqual(['docs.example.com', 'sheets.example.com']);
  });

  it('are none for work done only through the shell: the app\'s browser took no step', () => {
    const f = fakeSteps(KEY);
    expect(procedureScreen({ key: KEY, sessions: f.sessions, browser: false }).visited()).toEqual([]);
  });
});

describe('the hand-off', () => {
  it('is known from the typed values of this call, which stay known after they are forgotten', () => {
    const typed = createTypedValues();
    const screen = procedureScreen({ key: KEY, typed, browser: true });
    expect(screen.handedOff()).toBe(false);
    typed.add(['correct horse']);
    expect(screen.handedOff()).toBe(true);
    typed.clear();
    expect(screen.handedOff()).toBe(true);
    expect(screen.typedIn('use correct horse here')).toBe(false);
  });

  it('is known while a hand-off is active, before anything the person typed is known', () => {
    let active = false;
    const screen = procedureScreen({ key: KEY, typed: createTypedValues(), active: () => active, browser: true });
    expect(screen.handedOff()).toBe(false);
    active = true;
    expect(screen.handedOff()).toBe(true);
    expect(procedureScreen({ key: KEY, browser: true }).handedOff()).toBe(false);
  });

  it('is known from the service for a hand-off in an earlier call on the same screen', () => {
    let had = false;
    const screen = procedureScreen({ key: KEY, typed: createTypedValues(), handoff: { hadHandoff: (k) => had && k === KEY }, browser: true });
    expect(screen.handedOff()).toBe(false);
    had = true;
    expect(screen.handedOff()).toBe(true);
  });

  it('finds what the person typed in a text, in the plain, URL-encoded and JSON-escaped forms, and nothing in a text without it', () => {
    const typed = createTypedValues();
    typed.add(['pass word "1"']);
    const screen = procedureScreen({ key: KEY, typed, browser: true });
    expect(screen.typedIn('type pass word "1" into the field')).toBe(true);
    expect(screen.typedIn('type pass%20word%20%221%22 into the field')).toBe(true);
    expect(screen.typedIn('type pass word \\"1\\" into the field')).toBe(true);
    expect(screen.typedIn('type <value> into the field')).toBe(false);
    expect(procedureScreen({ key: KEY, browser: true }).typedIn('anything')).toBe(false);
  });
});

describe('the seam', () => {
  it('is the only file of the procedure memory that imports a browser or a screen module', () => {
    const dir = join(__dirname, '..', 'src', 'main', 'procedures');
    const offenders: string[] = [];
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'screen.ts')) {
      const text = readFileSync(join(dir, name), 'utf8');
      if (/from '\.\.\/(browser|screen)\//.test(text) || /import\('\.\.\/(browser|screen)\//.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
