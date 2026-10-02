#!/usr/bin/env node
// Reports user-facing literal strings that are not going through t(), per file, for the string-extraction phase.
//   node scripts/i18n-lint.mjs                 table of files with the most untranslated strings
//   node scripts/i18n-lint.mjs --json          the same as JSON (file -> list of {line, text})
//   node scripts/i18n-lint.mjs --file <path>   every finding of one file
//   node scripts/i18n-lint.mjs --max <n>       exit 1 when the total is above n (a ratchet for CI)
//   node scripts/i18n-lint.mjs --keys          also check that pt-BR.json and en.json define the same keys
// It is a heuristic: JSX text, user-facing attributes (title, aria-label, placeholder, alt, label) and string literals that look like prose
// (two or more words, or an accented letter). Imports, console calls, regexes, CSS values and keys are skipped.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['src/renderer/src', 'src/main'];
const SKIP_FILE = /\.(test|spec)\.|\.d\.ts$|\/node_modules\//;
const ATTR = /\b(?:title|aria-label|placeholder|alt|label)=(?:"([^"]*\p{L}[^"]*)"|'([^']*\p{L}[^']*)')/gu;
const JSX_TEXT = />\s*([^<>{}\n]*\p{L}[^<>{}\n]*?)\s*</gu;
const LITERAL = /(?<![\w.])(?:'([^'\\\n]{4,})'|"([^"\\\n]{4,})"|`([^`\\\n$]{4,})`)/gu;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|jsx?)$/.test(name) && !SKIP_FILE.test(path)) yield path;
  }
}

const looksLikeProse = (text) => {
  const t = text.trim();
  if (t.length < 4 || !/\p{L}/u.test(t)) return false;
  if (/^[\w./:@#%-]+$/.test(t)) return false; // identifiers, paths, urls, css
  if (/^(https?:|\/|\.|#|[A-Z_]+$)/.test(t)) return false;
  return /\s/.test(t) || /[À-ÿ]/.test(t);
};

function findings(file) {
  const text = readFileSync(file, 'utf8');
  const out = [];
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  const lines = text.split('\n');
  const skippedLine = (n) => /^\s*(import|export .* from|\/\/|\*|\/\*)/.test(lines[n - 1]) || /console\.|throw new Error|logError|\bt\(|\bt\('/.test(lines[n - 1]);
  const seen = new Set();
  const add = (index, raw) => {
    const line = lineOf(index);
    const key = `${line}:${raw}`;
    if (seen.has(key) || skippedLine(line)) return;
    seen.add(key);
    out.push({ line, text: raw.trim().slice(0, 100) });
  };
  if (file.endsWith('x')) {
    for (const m of text.matchAll(JSX_TEXT)) if (looksLikeProse(m[1]) || /^\p{Lu}\p{L}+$/u.test(m[1].trim())) add(m.index, m[1]);
    for (const m of text.matchAll(ATTR)) add(m.index, m[1] ?? m[2]);
  }
  for (const m of text.matchAll(LITERAL)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (looksLikeProse(raw)) add(m.index, raw);
  }
  return out.sort((a, b) => a.line - b.line);
}

const report = {};
for (const dir of SCAN) {
  for (const file of walk(join(ROOT, dir))) {
    const found = findings(file);
    if (found.length) report[relative(ROOT, file)] = found;
  }
}

if (flag('--keys')) {
  const load = (...names) => names.flatMap((n) => Object.keys(JSON.parse(readFileSync(join(ROOT, `src/shared/i18n/${n}.json`), 'utf8'))));
  const pt = new Set(load('pt-BR', 'wizard.pt-BR', 'minutes.pt-BR'));
  const en = new Set(load('en', 'wizard.en', 'minutes.en'));
  const missingEn = [...pt].filter((k) => !en.has(k));
  const missingPt = [...en].filter((k) => !pt.has(k));
  if (missingEn.length || missingPt.length) {
    console.error(`i18n keys differ. Missing in en.json: ${missingEn.join(', ') || '-'}. Missing in pt-BR.json: ${missingPt.join(', ') || '-'}.`);
    process.exit(1);
  }
  console.log(`i18n keys: ${pt.size} in both catalogs.`);
}

const total = Object.values(report).reduce((n, list) => n + list.length, 0);
const file = value('--file');

if (flag('--json')) {
  console.log(JSON.stringify(file ? { [file]: report[file] ?? [] } : report, null, 2));
} else if (file) {
  for (const f of report[file] ?? []) console.log(`${file}:${f.line}  ${f.text}`);
  console.log(`${(report[file] ?? []).length} untranslated string(s) in ${file}`);
} else {
  const rows = Object.entries(report).sort((a, b) => b[1].length - a[1].length);
  for (const [name, list] of rows.slice(0, 40)) console.log(`${String(list.length).padStart(5)}  ${name}`);
  if (rows.length > 40) console.log(`       ... and ${rows.length - 40} more file(s)`);
  console.log(`${String(total).padStart(5)}  total in ${rows.length} file(s)`);
}

const max = value('--max');
if (max !== null && total > Number(max)) {
  console.error(`i18n lint: ${total} untranslated strings, above the allowed ${max}`);
  process.exit(1);
}
