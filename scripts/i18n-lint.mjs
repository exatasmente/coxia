#!/usr/bin/env node
// Reports user-facing literal strings that are not going through t(), per file, for the string-extraction phase.
//   node scripts/i18n-lint.mjs                 table of files with the most untranslated strings
//   node scripts/i18n-lint.mjs --json          the same as JSON (file -> list of {line, text})
//   node scripts/i18n-lint.mjs --file <path>   every finding of one file
//   node scripts/i18n-lint.mjs --max <n>       exit 1 when the total is above n (a ratchet for CI)
//   node scripts/i18n-lint.mjs --scope <s>     only one area: renderer, main, shared or all (the default)
//   node scripts/i18n-lint.mjs --dir <path>    scan another folder (used by the tests)
//   node scripts/i18n-lint.mjs --keys          also check that every <area>.pt-BR.json has the same keys as its <area>.en.json, and that no catalog repeats a key
//   node scripts/i18n-lint.mjs --catalogs <path>  check the catalogs of another folder with --keys (used by the tests)
// It parses every file (@babel/parser, already in the lockfile through the Vite React plugin) and reports the user-facing text that does
// not go through t()/tv():
//   - JSX text, and string attributes that people read (title, aria-label, placeholder, alt, label, ...);
//   - string and template literals that look like prose (two or more words, an accented letter or a capitalized word) wherever they are
//     used: object values, returns, arguments (alert, new Error, setState...), and so on;
//   - a hard-coded locale ('pt-BR', 'en-US') handed to toLocale*String, localeCompare or Intl.* (the language comes from the workspace config).
// It skips imports, types, property names, comparisons, class names, console calls and DOM lookups. Text that is for the machine and not
// for a person (a font stack, a shell command, a protocol word, a model-facing tool text, a file of data in a fixed language) is allowed
// with a comment, each with its reason in the code:
//   // i18n-ignore: <why>          on the line, or the line above: this literal is code, an id or a protocol word
//   // i18n-ignore-next-line: <why>  on the line above
//   // i18n-ignore-start: <why>    ... // i18n-ignore-end   the same for a block of lines
//   // i18n-lint: allow-file <why> in the first lines of a file: the whole file is data in a fixed language

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from '@babel/parser';

const ROOT = new URL('..', import.meta.url).pathname;
const SCOPES = { renderer: ['src/renderer/src'], main: ['src/main'], shared: ['src/shared'], all: ['src/renderer/src', 'src/main', 'src/shared'] };
const SKIP_FILE = /\.(test|spec)\.|\.d\.ts$|\/node_modules\//;
const USER_ATTRS = new Set(['title', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'placeholder', 'alt', 'label', 'summary', 'tooltip']);
const SKIP_CALLEES = /^(console\.\w+|require|import|t|tv|\w+\.t|\w*\.?addEventListener|\w*\.?removeEventListener|\w*\.?querySelectorAll?|\w*\.?getElementById|\w+\.setAttribute|\w+\.getAttribute|\w+\.classList\.\w+|localStorage\.\w+|sessionStorage\.\w+|window\.matchMedia|matchMedia|CSS\.supports|\w+\.dispatchEvent|CustomEvent|Event|RegExp|\w+\.postMessage|logError)$/;
const LOCALE_CALLEES = /(toLocale\w*String|localeCompare|Intl\.\w+)$/;
const COMPARE_OPS = new Set(['===', '!==', '==', '!=', 'in']);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SCAN = value('--dir') ? [value('--dir')] : SCOPES[value('--scope') ?? 'all'];
if (!SCAN) {
  console.error(`i18n lint: unknown scope "${value('--scope')}" (renderer, main, shared or all)`);
  process.exit(2);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|jsx?)$/.test(name) && !SKIP_FILE.test(path)) yield path;
  }
}

const hasLetters = (text) => /\p{L}/u.test(text);

// Text a person would read, as opposed to an identifier, a path, a URL or a constant.
const looksLikeProse = (text) => {
  const t = text.trim();
  if (!hasLetters(t)) return false;
  if (/^(https?:|wss?:|data:|file:|\/|\.{1,2}\/|#|--|@|[\w-]+:\/\/)/.test(t)) return false;
  if (/^[A-Z0-9_]+$/.test(t)) return false;
  if (/[À-ɏ]/.test(t)) return true;
  if (/\p{L}{2,}[^\p{L}\n]*\s+[^\p{L}\n]*\p{L}{2,}/u.test(t)) return true;
  return /^\p{Lu}\p{Ll}{2,}[.!?:…]?$/u.test(t);
};

const nameOf = (node) => {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return `${nameOf(node.object)}.${node.computed ? '[]' : nameOf(node.property)}`;
  if (node.type === 'ThisExpression') return 'this';
  return '';
};

function analyze(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  if (/i18n-lint:\s*allow-file/.test(lines.slice(0, 6).join('\n'))) return [];
  const blocks = [];
  lines.forEach((l, i) => {
    if (/i18n-ignore-start/.test(l)) blocks.push([i + 1, lines.length]);
    else if (/i18n-ignore-end/.test(l) && blocks.length) blocks[blocks.length - 1][1] = i + 1;
  });
  const ast = parse(text, { sourceType: 'module', plugins: file.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'], errorRecovery: true });
  const out = [];
  const seen = new Set();
  const ignored = (line) =>
    /i18n-ignore(?!-next)/.test(lines[line - 1] ?? '') || /i18n-ignore-next-line/.test(lines[line - 2] ?? '') || blocks.some(([a, b]) => line >= a && line <= b);
  const add = (node, raw) => {
    const line = node.loc.start.line;
    const key = `${line}:${raw}`;
    if (seen.has(key) || ignored(line)) return;
    seen.add(key);
    out.push({ line, text: raw.trim().replace(/\s+/g, ' ').slice(0, 100) });
  };

  const attrOf = (parent, grand) => (parent.type === 'JSXAttribute' ? parent : parent.type === 'JSXExpressionContainer' && grand?.type === 'JSXAttribute' ? grand : null);
  const userAttr = (attr) => USER_ATTRS.has(attr.name.name ?? '');

  // The call a literal is an argument of, looking through conditionals, logical operators and parentheses.
  const enclosingCall = (stack) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const n = stack[i];
      if (n.type === 'CallExpression' || n.type === 'NewExpression' || n.type === 'OptionalCallExpression') return n;
      if (!['ConditionalExpression', 'LogicalExpression', 'ParenthesizedExpression', 'TemplateLiteral', 'BinaryExpression', 'TSAsExpression', 'ArrayExpression'].includes(n.type)) return null;
    }
    return null;
  };

  const inCodePosition = (node, stack) => {
    const parent = stack[stack.length - 1];
    if (!parent) return false;
    const grand = stack[stack.length - 2];
    switch (parent.type) {
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
      case 'TSLiteralType':
      case 'TSEnumMember':
      case 'TSExternalModuleReference':
      case 'TSImportType':
      case 'TSModuleDeclaration':
      case 'ImportAttribute':
        return true;
      case 'ObjectProperty':
      case 'ClassProperty':
      case 'TSPropertySignature':
        return parent.key === node && !parent.computed;
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return parent.computed && parent.property === node;
      case 'SwitchCase':
        return parent.test === node;
      case 'BinaryExpression':
        return COMPARE_OPS.has(parent.operator);
      case 'UnaryExpression':
        return parent.operator === 'typeof';
      default:
        break;
    }
    const attr = attrOf(parent, grand);
    if (attr) return !userAttr(attr);
    const call = enclosingCall(stack);
    if (call && SKIP_CALLEES.test(nameOf(call.callee))) return true;
    return false;
  };

  const hardLocale = (node, raw, stack) => {
    if (!/^(pt|en)(-[A-Za-z]{2})?$/.test(raw)) return false;
    const call = enclosingCall(stack);
    if (call && LOCALE_CALLEES.test(nameOf(call.callee))) {
      add(node, `hard-coded locale '${raw}': use intlLocale()`);
      return true;
    }
    return false;
  };

  const visit = (node, stack) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXText') {
      if (hasLetters(node.value)) add(node, node.value);
    } else if (node.type === 'StringLiteral') {
      if (!hardLocale(node, node.value, stack) && !inCodePosition(node, stack)) {
        const attr = attrOf(stack[stack.length - 1], stack[stack.length - 2]);
        if (attr && userAttr(attr) ? hasLetters(node.value) : looksLikeProse(node.value)) add(node, node.value);
      }
    } else if (node.type === 'TemplateLiteral') {
      if (!inCodePosition(node, stack)) {
        const chunks = node.quasis.map((q) => q.value.cooked ?? q.value.raw);
        const joined = chunks.join('\u0001');
        if (looksLikeProse(joined) || chunks.some((c) => /\p{L}{3,}/u.test(c) && /\s/.test(c))) add(node, joined.replace(/\u0001/g, '${}'));
      }
    }
    if (node.type.startsWith('TSTypeAliasDeclaration') || node.type === 'TSInterfaceDeclaration' || node.type === 'TSTypeAnnotation') return;
    stack.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments' || key === 'extra') continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) visit(c, stack);
      else if (child && typeof child === 'object') visit(child, stack);
    }
    stack.pop();
  };
  visit(ast.program, []);
  return out.sort((a, b) => a.line - b.line);
}

const report = {};
for (const dir of SCAN) {
  for (const file of walk(resolve(ROOT, dir))) {
    const found = analyze(file);
    if (found.length) report[relative(ROOT, file)] = found;
  }
}

if (flag('--keys')) {
  const dir = value('--catalogs') ? resolve(value('--catalogs')) : join(ROOT, 'src/shared/i18n');
  const areas = readdirSync(dir).filter((n) => n.endsWith('.pt-BR.json')).map((n) => n.slice(0, -'.pt-BR.json'.length));
  const keysOf = (file) => Object.keys(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  const problems = [];
  // JSON.parse keeps the last of two equal keys without a word, so a repeated key is looked for in the text: the catalogs are flat, one key per line.
  for (const n of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const seen = new Set();
    for (const [, key] of readFileSync(join(dir, n), 'utf8').matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) {
      if (seen.has(key)) problems.push(`${n}: "${key}" appears more than once`);
      seen.add(key);
    }
  }
  let count = 0;
  for (const area of areas) {
    let en;
    try {
      en = new Set(keysOf(`${area}.en.json`));
    } catch {
      problems.push(`${area}.en.json is missing`);
      continue;
    }
    const pt = new Set(keysOf(`${area}.pt-BR.json`));
    count += pt.size;
    for (const k of pt) if (!en.has(k)) problems.push(`${area}: "${k}" missing in en`);
    for (const k of en) if (!pt.has(k)) problems.push(`${area}: "${k}" missing in pt-BR`);
  }
  for (const n of readdirSync(dir)) if (n.endsWith('.en.json') && !areas.includes(n.slice(0, -'.en.json'.length))) problems.push(`${n} has no pt-BR twin`);
  if (problems.length) {
    console.error(`i18n keys differ:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`i18n keys: ${count} in both languages (${areas.length} catalogs).`);
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
