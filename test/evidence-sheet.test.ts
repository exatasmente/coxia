import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_HEIGHT,
  MAX_IMAGES,
  UsageError,
  captionOf,
  checkInputs,
  clipHeight,
  escapeHtml,
  htmlOf,
  loadTiles,
  parseArgs,
  sheetWidth,
  // @ts-expect-error plain ESM module, no declaration file
} from '../scripts/evidence-sheet-core.mjs';

// The pure half of the contact-sheet command. The browser half is not run here: the suite never opens Chromium.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'evidence-sheet-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const made = (...names: string[]): string[] =>
  names.map((name) => {
    const file = join(dir, name);
    writeFileSync(file, PIXEL);
    return file;
  });
const out = () => join(dir, 'sheet.png');
const plan = (argv: string[]) => checkInputs(parseArgs(argv));

describe('parseArgs', () => {
  it('reads the output, the images and the defaults', () => {
    const opts = parseArgs(['sheet.png', 'a.png', 'b.png']);
    expect(opts).toMatchObject({ out: 'sheet.png', images: ['a.png', 'b.png'], cols: null, width: 480, title: '', theme: 'light', captions: [] });
  });

  it('reads every option, with a space or an equals sign, and keeps the repeated caption', () => {
    const opts = parseArgs(['o.png', 'a.png', '--cols', '3', '--width=300', '--title', 'My sheet', '--caption', 'a.png=First', '--caption=b.png=x=y', '--theme', 'dark']);
    expect(opts).toMatchObject({ cols: 3, width: 300, title: 'My sheet', theme: 'dark' });
    expect(opts.captions).toEqual([
      { file: 'a.png', text: 'First' },
      { file: 'b.png', text: 'x=y' },
    ]);
  });

  it('accepts options before the positional arguments', () => {
    expect(parseArgs(['--cols', '2', 'o.png', 'a.png'])).toMatchObject({ out: 'o.png', images: ['a.png'], cols: 2 });
  });

  it('answers --help without asking for anything else', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it.each([
    [[], /missing/],
    [['o.png'], /missing the images/],
    [['o.png', 'a.png', '--nope', '1'], /unknown option --nope/],
    [['o.png', 'a.png', '--cols'], /--cols needs a value/],
    [['o.png', 'a.png', '--cols', 'x'], /--cols must be a whole number/],
    [['o.png', 'a.png', '--cols', '0'], /--cols must be between/],
    [['o.png', 'a.png', '--width', '10'], /--width must be between/],
    [['o.png', 'a.png', '--theme', 'blue'], /--theme must be light or dark/],
    [['o.png', 'a.png', '--caption', 'no-equals'], /--caption must look like/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseArgs(argv as string[])).toThrow(message);
  });
});

describe('checkInputs', () => {
  it('uses the file name without extension as the caption and min(4, count) columns', () => {
    const files = made('one.png', 'two.JPG', 'three.webp');
    const { tiles, cols } = plan([out(), ...files]);
    expect(tiles.map((t: { caption: string }) => t.caption)).toEqual(['one', 'two', 'three']);
    expect(tiles.map((t: { mime: string }) => t.mime)).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(cols).toBe(3);
    expect(plan([out(), ...made('1.png', '2.png', '3.png', '4.png', '5.png')]).cols).toBe(4);
  });

  it('never gives more columns than there are images', () => {
    expect(plan([out(), ...made('a.png', 'b.png'), '--cols', '6']).cols).toBe(2);
    expect(plan([out(), ...made('c.png', 'd.png', 'e.png'), '--cols', '2']).cols).toBe(2);
  });

  it('replaces a caption by the path as given or by the file name', () => {
    const [a, b, c] = made('a.png', 'b.png', 'c.png');
    const { tiles } = plan([out(), a, b, c, '--caption', `${a}=By path`, '--caption', 'b.png=By name']);
    expect(tiles.map((t: { caption: string }) => t.caption)).toEqual(['By path', 'By name', 'c']);
  });

  it('allows an empty caption', () => {
    const [a] = made('a.png');
    expect(plan([out(), a, '--caption', 'a.png=']).tiles[0].caption).toBe('');
  });

  it('names a caption for a file that is not in the list', () => {
    const [a] = made('a.png');
    expect(() => plan([out(), a, '--caption', 'other.png=x'])).toThrow(/other\.png/);
  });

  it('names a missing file', () => {
    const [a] = made('a.png');
    const missing = join(dir, 'gone.png');
    expect(() => plan([out(), a, missing])).toThrow(`file not found: ${missing}`);
  });

  it('names a file with a wrong extension, even when it exists', () => {
    const gif = join(dir, 'anim.gif');
    writeFileSync(gif, 'x');
    expect(() => plan([out(), gif])).toThrow(`not a .png, .jpg, .jpeg or .webp file: ${gif}`);
  });

  it('names a folder given as an image', () => {
    const folder = join(dir, 'shots.png');
    mkdirSync(folder);
    expect(() => plan([out(), folder])).toThrow(`not a file: ${folder}`);
  });

  it('refuses an output that is not a png or that is one of the inputs', () => {
    const [a] = made('a.png');
    expect(() => plan([join(dir, 'sheet.jpg'), a])).toThrow(/must end in \.png/);
    expect(() => plan([a, a])).toThrow(`the output is also an input: ${a}`);
  });

  it(`accepts ${MAX_IMAGES} images and refuses one more`, () => {
    const names = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => `s${i}.png`);
    const files = made(...names);
    expect(plan([out(), ...files.slice(0, MAX_IMAGES)]).tiles).toHaveLength(MAX_IMAGES);
    expect(() => plan([out(), ...files])).toThrow(/at most 48 images, got 49/);
  });
});

describe('the height cap', () => {
  it('leaves a short sheet alone and cuts a tall one, saying so', () => {
    expect(clipHeight(900)).toEqual({ height: 900, cut: false });
    expect(clipHeight(MAX_HEIGHT)).toEqual({ height: MAX_HEIGHT, cut: false });
    expect(clipHeight(MAX_HEIGHT + 1)).toEqual({ height: MAX_HEIGHT, cut: true });
    expect(clipHeight(500, 400)).toEqual({ height: 400, cut: true });
  });

  it('sizes the sheet from the columns, the tile width and the gaps', () => {
    expect(sheetWidth(4, 480)).toBe(4 * 480 + 5 * 16);
  });
});

describe('htmlOf', () => {
  const tile = (caption: string, mime = 'image/png') => ({ caption, mime, data: PIXEL });

  it('embeds each picture as a data URL, with its caption and the title', () => {
    const html = htmlOf({ title: 'Round one', theme: 'light', cols: 2, width: 300, tiles: [tile('first'), tile('second', 'image/webp')] });
    expect(html).toContain(`src="data:image/png;base64,${PIXEL.toString('base64')}"`);
    expect(html).toContain('src="data:image/webp;base64,');
    expect(html).toContain('<figcaption>first</figcaption>');
    expect(html).toContain('<h1>Round one</h1>');
    expect(html).toContain('repeat(2, 300px)');
  });

  it('leaves the heading out when there is no title', () => {
    expect(htmlOf({ cols: 1, tiles: [tile('a')] })).not.toContain('<h1>');
  });

  it('keeps markup in a caption or a title as text', () => {
    const html = htmlOf({ title: '<img src=x onerror=alert(1)>', cols: 1, tiles: [tile('<script>alert(1)</script>"&\'')] });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<figcaption>&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;</figcaption>');
    expect(html).toContain('<h1>&lt;img src=x onerror=alert(1)&gt;</h1>');
  });

  it('names no source but data URLs: no http, no file, no link, script or import', () => {
    const html = htmlOf({ title: 'T', cols: 2, tiles: [tile('a'), tile('b', 'image/jpeg')] });
    expect(html).not.toMatch(/https?:/i);
    expect(html).not.toMatch(/file:/i);
    expect(html).not.toMatch(/<(script|link|iframe|object|embed)\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    const sources = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.startsWith('data:image/'))).toBe(true);
  });

  it('forbids by policy everything but inline data pictures', () => {
    expect(htmlOf({ cols: 1, tiles: [tile('a')] })).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`);
  });

  it('defines the colours of the chosen theme inside the page', () => {
    const light = htmlOf({ theme: 'light', cols: 1, tiles: [tile('a')] });
    const dark = htmlOf({ theme: 'dark', cols: 1, tiles: [tile('a')] });
    expect(light).not.toBe(dark);
    expect(dark).toContain('#0d1117');
    expect(light).toContain('#f4f5f7');
  });

  it('builds the page from files read by loadTiles', () => {
    const [a] = made('a.png');
    const { tiles, cols } = plan([out(), a]);
    const html = htmlOf({ cols, tiles: loadTiles(tiles) });
    expect(html).toContain(PIXEL.toString('base64'));
  });
});

describe('small helpers', () => {
  it('captionOf drops the folder and only the last extension', () => {
    expect(captionOf('/x/y/shot.one.png')).toBe('shot.one');
  });

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
