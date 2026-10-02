// Usage: node scripts/theme-audit.mjs [--before <git-rev>]
// 1) Counts literal colors per renderer file (token blocks in :root are not counted); with --before, shows rev vs working tree.
// 2) Checks WCAG contrast of the text/background token pairs in the light and dark themes. Exit 1 if any pair fails.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = 'src/renderer/src';
const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

// Removes the blocks whose selector starts with :root (the token definitions) and CSS comments.
function stripTokens(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutComments
    .replace(/@media[^{]*\{\s*:root[^{]*\{[^}]*\}\s*\}/g, '')
    .replace(/(?<=^|\})\s*:root[^{]*\{[^}]*\}/g, '');
}

function countLiterals(path, text) {
  const body = path.endsWith('.css') ? stripTokens(text) : text;
  return (body.match(LITERAL) ?? []).length;
}

function snapshot(rev) {
  const out = {};
  if (rev) {
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', rev, SRC], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /\.(tsx?|css)$/.test(f));
    for (const f of files) out[f] = countLiterals(f, execFileSync('git', ['show', `${rev}:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }));
  } else {
    for (const p of walk(join(ROOT, SRC))) out[relative(ROOT, p)] = countLiterals(p, readFileSync(p, 'utf8'));
  }
  return out;
}

function table(before, after) {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].sort();
  let b = 0;
  let a = 0;
  const rows = [];
  for (const n of names) {
    const x = before ? (before[n] ?? 0) : null;
    const y = after[n] ?? 0;
    if (!x && !y) continue;
    b += x ?? 0;
    a += y;
    rows.push(`${String(x ?? '').padStart(7)} ${String(y).padStart(6)}  ${n.replace(`${SRC}/`, '')}`);
  }
  console.log(`${'before'.padStart(7)} ${'after'.padStart(6)}  file`);
  console.log(rows.join('\n'));
  console.log(`${String(before ? b : '').padStart(7)} ${String(a).padStart(6)}  TOTAL`);
}

// ---- contrast ----
const css = readFileSync(join(ROOT, SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`block not found: ${selector}`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}
function vars(text) {
  const m = {};
  for (const [, k, v] of text.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) m[k] = v.trim();
  return m;
}
const light = vars(block(':root {'));
const darkAttr = vars(block(':root[data-theme="dark"] {'));
const darkMedia = vars(block(':root[data-theme="system"], :root:not([data-theme]) {'));
const same = Object.keys(darkAttr).length === Object.keys(darkMedia).length && Object.keys(darkAttr).every((k) => darkAttr[k] === darkMedia[k]);

const hex = (c) => {
  const h = c.replace('#', '');
  const f = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const t = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, pct) => a.map((v, i) => Math.round(v * (1 - pct) + b[i] * pct));

// [text token, background token]; text >= 4.5
const PAIRS = [
  ['ink', 'ground'], ['ink', 'surface'], ['ink-2', 'surface'], ['ink-2', 'ground'], ['muted', 'surface'], ['muted', 'ground'], ['faint', 'surface'], ['faint', 'ground'],
  ['ink', 'surface-2'], ['muted', 'surface-2'], ['link', 'surface'], ['link', 'ground'],
  ['faint', 'disabled-bg'], ['btn-dark-ink', 'btn-dark-bg'], ['muted', 'chip-quiet-bg'],
  ['teal-ink', 'teal-soft'], ['teal-ink', 'surface'], ['amber-ink', 'amber-soft'], ['amber-ink', 'surface'], ['warn', 'surface'], ['warn', 'ground'],
  ['blue-ink', 'blue-soft'], ['blue-ink', 'blue-chip'], ['blue-ink', 'surface'], ['red-ink', 'red-soft'], ['red-ink', 'red-faint'], ['red', 'surface'], ['red', 'ground'],
  ['orange-ink', 'surface-2'], ['dest-ink', 'surface'], ['ink-2', 'teal-soft'],
  ['white', 'teal-solid'], ['white', 'blue-solid'], ['white', 'red-solid'], ['white', 'warn-solid'], ['on-accent', 'teal-bright'], ['chip-teal-ink', 'chip-teal-bg'],
  ['on-night', 'night'], ['on-night-2', 'night-2'], ['on-night-3', 'night'], ['on-night-muted', 'night'], ['on-night-muted', 'night-2'],
  ['night-teal', 'night'], ['night-teal-2', 'night'], ['night-amber', 'night'], ['night-blue', 'night'], ['night-violet', 'night'], ['night-orange', 'night'], ['night-red', 'night'],
  ['night-amber', 'stage-block-bg'], ['night-blue', 'stage-ask-bg'], ['stage-teal-ink', 'stage-teal-bg'], ['stage-blue-ink', 'stage-blue-bg'], ['on-night-2', 'night-line'],
  ['white', 'blue-solid'],
];

function resolve(theme, name) {
  const v = theme[name];
  if (!v) throw new Error(`token --${name} missing`);
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(theme, ref[1]) : hex(v);
}

let failures = 0;
if (!same) { console.log('FAIL: the dark block of data-theme="dark" differs from the prefers-color-scheme one'); failures++; }
const AGENT = [...readFileSync(join(ROOT, SRC, 'api.ts'), 'utf8').match(/AGENT_COLORS = \[([^\]]*)\]/)[1].matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => hex(m[0]));
for (const [label, theme] of [['light', light], ['dark', { ...light, ...darkAttr }]]) {
  console.log(`\ncontrast ${label} (minimum 4.5:1)`);
  const lows = [];
  for (const [t, b] of PAIRS) {
    const r = ratio(resolve(theme, t), resolve(theme, b));
    if (r < 4.5) { lows.push(`  FAIL ${t} on ${b}: ${r.toFixed(2)}`); failures++; }
  }
  console.log(lows.length ? lows.join('\n') : `  ${PAIRS.length} pairs ok`);
  const lift = parseFloat(theme['who-lift']) / 100;
  const minAgent = Math.min(...AGENT.flatMap((c) => ['surface', 'ground'].map((bg) => ratio(mix(c, [255, 255, 255], lift), resolve(theme, bg)))));
  console.log(`  agent names in the transcript (lift ${theme['who-lift']}): worst ${minAgent.toFixed(2)}`);
  if (minAgent < 4.5) failures++;
  const minChip = Math.min(...AGENT.map((c) => ratio([255, 255, 255], c)));
  console.log(`  white on agent chips: worst ${minChip.toFixed(2)}`);
  if (minChip < 4.5) failures++;
}

{
  const i = process.argv.indexOf('--before');
  console.log('\nliteral colors per file');
  table(i >= 0 ? snapshot(process.argv[i + 1]) : null, snapshot());
}
process.exit(failures ? 1 : 0);
