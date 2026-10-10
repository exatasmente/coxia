// What the person types while they hold the agent's screen (#178): rebuilt from the keys the viewer sent, kept in memory, masked out of the text the app hands the agent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TYPED_PLACEHOLDER, createTypedCollector, createTypedValues, exactMask } from '../src/main/screen/typedValues';

const down = (key: string) => ({ t: 'key', key, down: true });
const up = (key: string) => ({ t: 'key', key, down: false });
/** Each character as a press and a release. */
const typeText = (text: string) => [...text].flatMap((c) => [down(c), up(c)]);

function collect(...batches: unknown[][]): string[] {
  const c = createTypedCollector();
  for (const b of batches) c.feed(b);
  return c.values();
}

describe('the text rebuilt from keys', () => {
  it('reads printable keys of any layout, one code point each', () => {
    expect(collect(typeText('pässwörd-ç9'))).toEqual(['pässwörd-ç9']);
    expect(collect(typeText('code 😀 12'))).toEqual(['code 😀 12']);
  });

  it('takes Backspace into account, and a Backspace on an empty segment does nothing', () => {
    expect(collect([down('Backspace')], typeText('abcx'), [down('Backspace')], typeText('d'))).toEqual(['abcd']);
  });

  it('takes a shifted character as the key says it is', () => {
    expect(collect([down('Shift'), down('P'), up('P'), up('Shift')], typeText('ass'))).toEqual(['Pass']);
  });

  it('does not take a shortcut for text, and takes AltGraph compositions', () => {
    expect(collect([down('Control'), down('a'), up('a'), up('Control')], typeText('x'))).toEqual(['x']);
    expect(collect([down('Alt'), down('f'), up('f'), up('Alt')], [down('Meta'), down('l'), up('l'), up('Meta')], typeText('y'))).toEqual(['y']);
    expect(collect([down('AltGraph'), down('@'), up('@'), up('AltGraph')], typeText('q'))).toEqual(['@q']);
  });

  it('a modifier let go makes the next key text again, also across batches', () => {
    expect(collect([down('Control')], [up('Control')], typeText('ok'))).toEqual(['ok']);
    expect(collect([down('Control')], typeText('ok'))).toEqual([]);
  });

  it('ends a segment at Enter, Tab, Escape, the arrows, Home, End, Page keys, Delete and a button press', () => {
    for (const k of ['Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Delete']) {
      expect(collect(typeText('user'), [down(k)], typeText('word'))).toEqual(['user', 'word']);
    }
    expect(collect(typeText('user'), [{ t: 'button', b: 1, down: true }], typeText('word'))).toEqual(['user', 'word']);
    // A button let go, a move and a wheel are not breaks.
    expect(collect(typeText('us'), [{ t: 'move', x: 1, y: 1 }, { t: 'button', b: 1, down: false }, { t: 'scroll', dy: 1 }], typeText('er'))).toEqual(['user']);
  });

  it('ends the segment at Ctrl+Backspace, which deletes a span the app cannot size', () => {
    expect(collect(typeText('one two'), [down('Control'), down('Backspace'), up('Backspace'), up('Control')], typeText('3'))).toEqual(['one two', '3']);
  });

  it('ignores keys that are not text: names, dead keys, function keys', () => {
    expect(collect([down('Dead'), down('F5'), down('CapsLock'), down('Process')], typeText('ab'))).toEqual(['ab']);
  });

  it('ignores anything that is not an event, and a hostile shape does not throw', () => {
    const c = createTypedCollector();
    expect(() => c.feed([null, 7, 'a', {}, { t: 'key' }, { t: 'key', key: 5, down: true }, { t: 'key', key: 'a', down: 'yes' }, { get t(): string { throw new Error('boom'); } }])).not.toThrow();
    c.feed(typeText('ok'));
    expect(c.values()).toEqual(['ok']);
  });

  it('keeps a repeated segment once, and the open segment is part of the values', () => {
    expect(collect(typeText('same'), [down('Tab')], typeText('same'), [down('Tab')], typeText('open'))).toEqual(['same', 'open']);
  });

  it('keeps at most 512 characters of a segment and the latest 64 segments', () => {
    const [long] = collect(typeText('ab'.repeat(300)));
    expect(long).toHaveLength(512);
    const many = collect(...Array.from({ length: 70 }, (_, i) => [...typeText(`value-${i}`), down('Enter')]));
    expect(many).toHaveLength(64);
    expect(many[0]).toBe('value-6');
    expect(many.at(-1)).toBe('value-69');
  });

  it('drops a segment that is blank or one repeated character, which would mask every snapshot', () => {
    expect(collect(typeText('    '), [down('Tab')], typeText('aaaa'), [down('Tab')], typeText('....'), [down('Tab')], typeText('  \t'), [down('Tab')], typeText('real-one'))).toEqual(['real-one']);
    expect(collect(typeText('aaab'), [down('Tab')], typeText(' ab '))).toEqual(['aaab', ' ab ']);
  });

  it('forgets everything on clear, modifiers too', () => {
    const c = createTypedCollector();
    c.feed([down('Control'), ...typeText('xx')]);
    c.clear();
    c.feed(typeText('after'));
    expect(c.values()).toEqual(['after']);
  });
});

describe('masking what was typed', () => {
  const MARKER = 'zq-marker-4821';

  it('masks the value as it is, URL-encoded and JSON-escaped, on every read', () => {
    const typed = createTypedValues();
    const value = 'p@ss "w0rd"/x';
    typed.add([value]);
    const text = [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)].join(' | ');
    const out = typed.mask(`page: ${text}`);
    expect(out).toBe(`page: ${[TYPED_PLACEHOLDER, TYPED_PLACEHOLDER, TYPED_PLACEHOLDER].join(' | ')}`);
    expect(typed.mask(`later: ${value}`)).toBe(`later: ${TYPED_PLACEHOLDER}`);
  });

  it('masks a value in an address as a form writes it: a space as a plus, and ! \' ( ) * ~ percent-encoded', () => {
    const typed = createTypedValues();
    typed.add(['Passw0rd!', 'my pass(phrase)*~']);
    const out = typed.mask('GET /login?pw=Passw0rd%21&x=my+pass%28phrase%29%2A%7E&y=my%20pass%28phrase%29%2A%7E');
    expect(out).toBe(`GET /login?pw=${TYPED_PLACEHOLDER}&x=${TYPED_PLACEHOLDER}&y=${TYPED_PLACEHOLDER}`);
    expect(typed.hits('?pw=Passw0rd%21')).toBe(true);
  });

  it('masks a value written with every byte percent-encoded, in either case', () => {
    const typed = createTypedValues();
    typed.add(['Passw0rd!']);
    const all = [...Buffer.from('Passw0rd!')].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('');
    expect(typed.mask(`?pw=${all}&q=${all.toUpperCase()}`)).toBe(`?pw=${TYPED_PLACEHOLDER}&q=${TYPED_PLACEHOLDER}`);
    expect(typed.mask('?pw=passw0rd%21')).toBe('?pw=passw0rd%21');
  });

  it('does not take a blank or one-character value in, so it masks nothing of the page', () => {
    const typed = createTypedValues();
    typed.add(['    ', 'aaaa', '....']);
    expect(typed.mask('a page    with aaaa and ....')).toBe('a page    with aaaa and ....');
    expect(typed.had).toBe(true);
  });

  it('does not mask a value of fewer than 4 characters, and says it had a hand-off all the same', () => {
    const typed = createTypedValues();
    typed.add(['123']);
    expect(typed.mask('code 123')).toBe('code 123');
    expect(typed.hits('code 123')).toBe(false);
    expect(typed.had).toBe(true);
  });

  it('masks the longest form first, so a long value is not left in pieces', () => {
    const typed = createTypedValues();
    typed.add(['abcd', 'abcdefgh']);
    expect(typed.mask('x abcdefgh y abcd')).toBe(`x ${TYPED_PLACEHOLDER} y ${TYPED_PLACEHOLDER}`);
  });

  it('does not mask the placeholder it wrote, whatever the values are', () => {
    const typed = createTypedValues();
    typed.add(['secr', 'ret]']);
    expect(typed.mask('x secr y')).toBe(`x ${TYPED_PLACEHOLDER} y`);
  });

  it('takes the characters of a regular expression literally', () => {
    const typed = createTypedValues();
    typed.add(['a.b*c(d)']);
    expect(typed.mask('a.b*c(d) and axbbbc(d)')).toBe(`${TYPED_PLACEHOLDER} and axbbbc(d)`);
  });

  it('hits says whether any form of any value is in the text', () => {
    const typed = createTypedValues();
    expect(typed.hits(MARKER)).toBe(false);
    typed.add([MARKER]);
    expect(typed.hits(`x ${MARKER} y`)).toBe(true);
    expect(typed.hits(encodeURIComponent('zq marker/4821'))).toBe(false);
    expect(typed.hits('nothing here')).toBe(false);
  });

  it('adds up across intervals of the same call', () => {
    const typed = createTypedValues();
    typed.add(['first-value']);
    typed.add(['second-value']);
    expect(typed.mask('first-value second-value')).toBe(`${TYPED_PLACEHOLDER} ${TYPED_PLACEHOLDER}`);
  });

  it('had is false until a hand-off, true after, and true after clear while the values are gone', () => {
    const typed = createTypedValues();
    expect(typed.had).toBe(false);
    typed.add([MARKER]);
    expect(typed.had).toBe(true);
    typed.clear();
    expect(typed.had).toBe(true);
    expect(typed.mask(MARKER)).toBe(MARKER);
    expect(typed.hits(MARKER)).toBe(false);
  });

  it('a call with no values masks nothing', () => {
    expect(exactMask([])('as is')).toBe('as is');
  });
});

describe('nothing is written', () => {
  it('the module does not touch the disk, the console or the network', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'main', 'screen', 'typedValues.ts'), 'utf8');
    expect(src).not.toMatch(/node:fs|from 'fs'|writeFile|appendFile|createWriteStream|console\.|fetch\(|node:net|node:http/);
  });
});
