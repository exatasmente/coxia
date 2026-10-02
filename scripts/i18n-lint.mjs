#!/usr/bin/env node
// Reports user-facing literal strings that are not going through t(), per file, for the string-extraction phase.
//   node scripts/i18n-lint.mjs                 table of files with the most untranslated strings
//   node scripts/i18n-lint.mjs --json          the same as JSON (file -> list of {line, text})
//   node scripts/i18n-lint.mjs --file <path>   every finding of one file
//   node scripts/i18n-lint.mjs --max <n>       exit 1 when the total is above n (a ratchet for CI)
//   node scripts/i18n-lint.mjs --keys          also check that pt-BR.json and en.json define the same keys
//   node scripts/i18n-lint.mjs --scope <p,q>   count only the files under these path prefixes (e.g. src/main,src/shared)
// It is a heuristic: JSX text, user-facing attributes (title, aria-label, placeholder, alt, label) and string literals that look like prose
// (two or more words, or an accented letter). Imports, console calls, regexes, CSS values and keys are skipped.
// The .ts files are read with a small tokenizer (strings, templates and their ${} expressions, comments, regex literals), so only real
// literals are judged. Text that is not for people goes in one of two ways, each with a reason in the code:
//   // i18n-ignore: <why>          on the line, or the line above: this literal is code, an id, a protocol or a model-facing tool text
//   // i18n-ignore-start: <why>    ... // i18n-ignore-end   the same for a block of lines
//   // i18n-lint: allow-file <why> in the first lines of a file: the whole file is data in a fixed language (JSON Schema docs, templates)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['src/renderer/src', 'src/main', 'src/shared'];
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


// Every string and template literal of a .ts file, with the line it starts on. A template counts by its static parts only
// (the expressions are scanned on their own), so "`#${iid}: ${stage}`" has no prose and "`Bloqueio na #${iid}`" has.
function tsLiterals(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  const lineAt = (pos) => text.slice(0, pos).split('\n').length;
  const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]/;
  let lastSignificant = '';
  const code = (stopAtBrace) => {
    let depth = 0;
    while (i < n) {
      const c = text[i];
      const next = text[i + 1];
      if (c === '/' && next === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && next === '*') {
        i = text.indexOf('*/', i + 2);
        i = i < 0 ? n : i + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        const start = i++;
        let value = '';
        while (i < n && text[i] !== c && text[i] !== '\n') {
          if (text[i] === '\\') i++;
          value += text[i++];
        }
        i++;
        out.push({ index: start, line: lineAt(start), value });
        lastSignificant = c;
        continue;
      }
      if (c === '`') {
        const start = i++;
        let value = '';
        while (i < n && text[i] !== '`') {
          if (text[i] === '\\') {
            i += 2;
            value += ' ';
            continue;
          }
          if (text[i] === '$' && text[i + 1] === '{') {
            i += 2;
            value += '\u0000';
            code(true);
            continue;
          }
          value += text[i++];
        }
        i++;
        out.push({ index: start, line: lineAt(start), value, template: true });
        lastSignificant = '`';
        continue;
      }
      if (c === '/' && (lastSignificant === '' || REGEX_AFTER.test(lastSignificant) || /(?:return|typeof|case)$/.test(text.slice(Math.max(0, i - 7), i).trim()))) {
        i++;
        let inClass = false;
        while (i < n && text[i] !== '\n') {
          if (text[i] === '\\') i++;
          else if (text[i] === '[') inClass = true;
          else if (text[i] === ']') inClass = false;
          else if (text[i] === '/' && !inClass) break;
          i++;
        }
        i++;
        while (/[a-z]/.test(text[i] ?? '')) i++;
        lastSignificant = '/';
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (stopAtBrace && depth === 0) {
          i++;
          return;
        }
        depth--;
      }
      if (!/\s/.test(c)) lastSignificant = c;
      i++;
    }
  };
  code(false);
  return out;
}

// Two or more words in one piece, or a piece with an accented letter: a lone "[" or ": " between two placeholders is not prose.
const wordsOf = (text) => {
  const pieces = text.split(/\n/);
  return pieces.some((p) => {
    // A word is plain letters between spaces: "merge-tree", "a/b" and "key:value" are code.
    const words = p.split(/\s+/).filter((w) => /^[("'«“]?\p{L}+[.,;:!?)"'»”…]*$/u.test(w));
    return (words.length >= 2 && words.some((w) => w.replace(/\P{L}/gu, '').length >= 3)) || /[À-ÿ]/.test(p);
  });
};

function findings(file) {
  const text = readFileSync(file, 'utf8');
  const out = [];
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  const lines = text.split('\n');
  const blocks = [];
  lines.forEach((l, i) => {
    if (/i18n-ignore-start/.test(l)) blocks.push([i + 1, lines.length]);
    else if (/i18n-ignore-end/.test(l) && blocks.length) blocks[blocks.length - 1][1] = i + 1;
  });
  const ignored = (n) => /i18n-ignore(?!-)/.test(lines[n - 1] ?? '') || /i18n-ignore(?!-)/.test(lines[n - 2] ?? '') || blocks.some(([a, b]) => n >= a && n <= b);
  const skippedLine = (n) => /^\s*(import|export .* from|\/\/|\*|\/\*)/.test(lines[n - 1]) || /console\.|logError\(/.test(lines[n - 1]) || ignored(n);
  if (/i18n-lint:\s*allow-file/.test(lines.slice(0, 6).join('\n'))) return [];
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
  if (file.endsWith('.ts')) {
    for (const lit of tsLiterals(text)) {
      // A template is judged by its static text: the placeholders between the pieces are not words.
      const raw = lit.template ? lit.value.replace(/\u0000/g, ' ') : lit.value;
      if (looksLikeProse(raw) && wordsOf(lit.template ? lit.value.replace(/\u0000/g, '\n') : raw)) add(lit.index, raw);
    }
  } else {
    for (const m of text.matchAll(LITERAL)) {
      const raw = m[1] ?? m[2] ?? m[3];
      if (looksLikeProse(raw)) add(m.index, raw);
    }
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
  const pt = new Set(load('pt-BR', 'wizard.pt-BR', 'main.pt-BR'));
  const en = new Set(load('en', 'wizard.en', 'main.en'));
  const missingEn = [...pt].filter((k) => !en.has(k));
  const missingPt = [...en].filter((k) => !pt.has(k));
  if (missingEn.length || missingPt.length) {
    console.error(`i18n keys differ. Missing in en.json: ${missingEn.join(', ') || '-'}. Missing in pt-BR.json: ${missingPt.join(', ') || '-'}.`);
    process.exit(1);
  }
  console.log(`i18n keys: ${pt.size} in both catalogs.`);
}

const scope = (value('--scope') ?? '').split(',').filter(Boolean);
if (scope.length) for (const name of Object.keys(report)) if (!scope.some((prefix) => name.startsWith(prefix))) delete report[name];
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
  const own = rows.filter(([name]) => /^src\/(main|shared)\//.test(name)).reduce((n, [, list]) => n + list.length, 0);
  console.log(`${String(own).padStart(5)}  of them in src/main + src/shared`);
}

const max = value('--max');
if (max !== null && total > Number(max)) {
  console.error(`i18n lint: ${total} untranslated strings, above the allowed ${max}`);
  process.exit(1);
}
