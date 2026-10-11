// The pure half of `scripts/evidence-sheet.mjs`: reading the command line, checking the input files and building the page the
// browser turns into one picture. Nothing here opens a browser, a socket or the network, so a test can run all of it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

export const EXTENSIONS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export const MAX_IMAGES = 48;
// A page taller than this is cut: a browser refuses to paint a texture much past 16k pixels, and a sheet that tall is not read anyway.
export const MAX_HEIGHT = 12000;
export const DEFAULT_WIDTH = 480;
export const GAP = 16;
const MIN_WIDTH = 80;
const MAX_WIDTH = 2400;
const MAX_COLS = MAX_IMAGES;

export const USAGE = `Usage: node scripts/evidence-sheet.mjs <out.png> <image>... [options]

Puts screenshots on one contact sheet (a PNG), each with a caption, rendered by headless Chromium.

Arguments:
  <out.png>              where the sheet is written (its folder is created if missing)
  <image>...             1 to ${MAX_IMAGES} files, .png .jpg .jpeg or .webp

Options:
  --cols N               tiles per row (default: the smaller of 4 and the number of images)
  --width PX             width of one tile, ${MIN_WIDTH} to ${MAX_WIDTH} (default: ${DEFAULT_WIDTH})
  --title TEXT           a heading above the grid (default: none)
  --caption "<file>=<text>"
                         replace one caption; <file> is the path as given or its file name; repeatable
                         (default caption: the file name without its extension)
  --theme light|dark     colours of the page (default: light)
  -h, --help             print this text

A sheet taller than ${MAX_HEIGHT} px is cut at ${MAX_HEIGHT} px and the command says so.
Needs Chromium: npx playwright install chromium

Exit codes: 0 written; 1 wrong arguments or an input file named in the message; 2 the rendering failed.`;

/** A mistake in what the person typed or pointed at: the message names the offender, the script exits 1. */
export class UsageError extends Error {}

const OPTIONS_WITH_VALUE = new Set(['--cols', '--width', '--title', '--caption', '--theme']);

/** Reads the command line into plain data; says nothing about the files (see `checkInputs`). */
export function parseArgs(argv) {
  const opts = { out: null, images: [], cols: null, width: DEFAULT_WIDTH, title: '', captions: [], theme: 'light', help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      let value;
      const eq = arg.indexOf('=');
      if (eq > 0) {
        value = arg.slice(eq + 1);
        arg = arg.slice(0, eq);
      }
      if (!OPTIONS_WITH_VALUE.has(arg)) throw new UsageError(`unknown option ${arg}`);
      if (value === undefined) {
        value = argv[++i];
        if (value === undefined) throw new UsageError(`${arg} needs a value`);
      }
      if (arg === '--cols') opts.cols = intOf(arg, value, 1, MAX_COLS);
      else if (arg === '--width') opts.width = intOf(arg, value, MIN_WIDTH, MAX_WIDTH);
      else if (arg === '--title') opts.title = value;
      else if (arg === '--theme') {
        if (value !== 'light' && value !== 'dark') throw new UsageError(`--theme must be light or dark, got "${value}"`);
        opts.theme = value;
      } else {
        const at = value.indexOf('=');
        if (at <= 0) throw new UsageError(`--caption must look like "<file>=<text>", got "${value}"`);
        opts.captions.push({ file: value.slice(0, at), text: value.slice(at + 1) });
      }
      continue;
    }
    positional.push(arg);
  }
  if (opts.help) return opts;
  if (positional.length === 0) throw new UsageError('missing <out.png> and the images');
  opts.out = positional[0];
  opts.images = positional.slice(1);
  if (opts.images.length === 0) throw new UsageError('missing the images: give at least one after <out.png>');
  return opts;
}

function intOf(name, value, min, max) {
  if (!/^\d+$/.test(value)) throw new UsageError(`${name} must be a whole number, got "${value}"`);
  const n = Number(value);
  if (n < min || n > max) throw new UsageError(`${name} must be between ${min} and ${max}, got ${n}`);
  return n;
}

/** The default caption of a file: its name without the extension. */
export function captionOf(file) {
  const name = basename(file);
  return name.slice(0, name.length - extname(name).length);
}

/**
 * Checks the files and settles what the page needs: one tile per image with its caption, the column count. Throws `UsageError`
 * naming the file at fault, so nothing is rendered from a half-valid list.
 */
export function checkInputs(opts) {
  if (extname(opts.out).toLowerCase() !== '.png') throw new UsageError(`the output must end in .png: ${opts.out}`);
  if (opts.images.length > MAX_IMAGES) throw new UsageError(`at most ${MAX_IMAGES} images, got ${opts.images.length}`);
  const out = resolve(opts.out);
  for (const file of opts.images) {
    if (!EXTENSIONS[extname(file).toLowerCase()]) throw new UsageError(`not a .png, .jpg, .jpeg or .webp file: ${file}`);
    if (!existsSync(file)) throw new UsageError(`file not found: ${file}`);
    if (!statSync(file).isFile()) throw new UsageError(`not a file: ${file}`);
    // The sheet would overwrite its own source.
    if (resolve(file) === out) throw new UsageError(`the output is also an input: ${file}`);
  }
  const overrides = new Map();
  for (const { file, text } of opts.captions) {
    const match = opts.images.find((image) => image === file || resolve(image) === resolve(file)) ?? opts.images.find((image) => basename(image) === file);
    if (!match) throw new UsageError(`--caption names a file that is not among the images: ${file}`);
    overrides.set(match, text);
  }
  const tiles = opts.images.map((file) => ({
    file,
    caption: overrides.has(file) ? overrides.get(file) : captionOf(file),
    mime: EXTENSIONS[extname(file).toLowerCase()],
  }));
  return { tiles, cols: opts.cols ? Math.min(opts.cols, tiles.length) : Math.min(4, tiles.length) };
}

/** Reads the bytes of the checked tiles; split from `checkInputs` so validation never loads a picture. */
export function loadTiles(tiles) {
  return tiles.map((tile) => ({ ...tile, data: readFileSync(tile.file) }));
}

/** Text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Colours live in the page: this is a picture for a pull request, not the app's interface, so it carries no token of the app.
const THEMES = {
  light: { bg: '#f4f5f7', card: '#ffffff', ink: '#1b1f24', muted: '#57606a', line: '#d0d7de' },
  dark: { bg: '#0d1117', card: '#161b22', ink: '#e6edf3', muted: '#9da7b3', line: '#30363d' },
};

/** The width in pixels of a sheet of `cols` tiles of `width` pixels: the viewport the page is rendered in. */
export function sheetWidth(cols, width) {
  return cols * width + (cols + 1) * GAP;
}

/** Where a page of `height` pixels is cut: `{ height, cut }`, `cut` true when the cap took something away. */
export function clipHeight(height, max = MAX_HEIGHT) {
  return height > max ? { height: max, cut: true } : { height, cut: false };
}

/**
 * The self-contained page: the pictures are data URLs and the policy forbids every other source, so the page can reach neither the
 * network nor a file. Each tile is `{ caption, mime, data }` with `data` a Buffer.
 */
export function htmlOf({ title = '', theme = 'light', cols, width = DEFAULT_WIDTH, tiles }) {
  const c = THEMES[theme] ?? THEMES.light;
  const figures = tiles
    .map(
      (tile) =>
        `<figure><img src="data:${tile.mime};base64,${Buffer.from(tile.data).toString('base64')}" alt="${escapeHtml(tile.caption)}"><figcaption>${escapeHtml(tile.caption)}</figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escapeHtml(title || 'Evidence sheet')}</title>
<style>
html, body { margin: 0; background: ${c.bg}; color: ${c.ink}; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
body { box-sizing: border-box; width: ${sheetWidth(cols, width)}px; padding: ${GAP}px; }
h1 { margin: 0 0 ${GAP}px; font-size: 22px; font-weight: 600; }
.grid { display: grid; grid-template-columns: repeat(${cols}, ${width}px); gap: ${GAP}px; align-items: start; }
figure { margin: 0; background: ${c.card}; border: 1px solid ${c.line}; border-radius: 6px; overflow: hidden; }
img { display: block; width: 100%; height: auto; border-bottom: 1px solid ${c.line}; }
figcaption { padding: 8px 10px; color: ${c.muted}; font-size: 13px; overflow-wrap: anywhere; }
</style></head>
<body>
${title ? `<h1>${escapeHtml(title)}</h1>\n` : ''}<div class="grid">
${figures}
</div>
</body></html>
`;
}
