#!/usr/bin/env node
// Public audit: fails when a file of the repository carries something that belongs to a company or a person instead of the project.
//
//   node scripts/public-audit.mjs                 audit every tracked file (and untracked ones that are not ignored)
//   node scripts/public-audit.mjs --counts        the same, plus the number of hits per rule, even when there are none
//   node scripts/public-audit.mjs --root <dir>    audit a folder instead of the current repository (used by the tests)
//   node scripts/public-audit.mjs --list-rules    print the rule ids
//
// What it hunts: the name, hosts, repositories, tools and accounts of the company the app was born in, real issue numbers, real people,
// private network addresses, emails outside reserved domains, secrets, and files that must never be tracked (scratch folders, logs,
// private profiles). Binary files are checked by path only.
//
// The company and personal patterns are stored encoded (RULES_B64), so this file does not spell the names it hunts: a public repository
// that lists them in a script would leak what the script is there to keep out. `--list-rules` prints their ids and messages, not the words.
//
// A false positive goes into scripts/public-audit.allow.json: { "rule": "...", "file": "path or glob", "match": "text the hit must contain", "reason": "why" }.
// `file` takes "*" (within a folder) and "**" (across folders). Keep that file short and justified: every entry is an exception.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RULES_B64 = [
  'W3siaWQiOiJjb21wYW55Iiwic291cmNlIjoic21hcnR6YXB8Zm9ydGljc3xrb2FsYXxxYVxcLmludGVybm98c3pcXC5jaGF0fFxc',
  'YlNaNFxcYiIsImZsYWdzIjoiaSIsInNhbXBsZSI6ImdpdC5zbWFydHphcC5leGFtcGxlIiwibWVzc2FnZSI6ImNvbXBhbnkgaG9z',
  'dCwgbmFtZSBvciBhY2NvdW50In0seyJpZCI6ImNvbXBhbnktcmVwbyIsInNvdXJjZSI6InN6NHxzei1wbGF5Ym9va3xzei1zZGR8',
  'aHViLXdoYXRzYXBwfGFnZW50LXNvY2tldC1tYW5hZ2VyfGhlcm1lcy1wb2MiLCJmbGFncyI6ImkiLCJzYW1wbGUiOiJ0aGUgc3o0',
  'IHJlcG9zaXRvcnkiLCJtZXNzYWdlIjoiY29tcGFueSByZXBvc2l0b3J5LCB0ZW1wbGF0ZSBvciBtYWNoaW5lIHBhdGgifSx7Imlk',
  'IjoicGVyc29uYWwtdG9vbCIsInNvdXJjZSI6ImRhaWx5LXJlcG9ydHxjbG9ja2lmeXxjbGF1ZGUtb3JcXGJ8b3BlbnJvdXRlci1r',
  'ZXl8cG9zdC1yZWxlYXNlLXN5bmN8cmVsYXRlZC13b3JrLXJhZGFyfHFhLXJlbGVhc2UtYnJhbmNofHRlc3Rhci1hdGl2aWRhZGUt',
  'Z2l0bGFiIiwiZmxhZ3MiOiJpIiwic2FtcGxlIjoicnVucyBkYWlseS1yZXBvcnQgbm90ZSIsIm1lc3NhZ2UiOiJwZXJzb25hbCBv',
  'ciBjb21wYW55IHRvb2wifSx7ImlkIjoicmVhbC1pc3N1ZS1udW1iZXIiLCJzb3VyY2UiOiJcXGIoMTU0OTl8MTU1MDB8MTU5NjV8',
  'MTQ4MTZ8MTQzMjd8MTQ1MDB8MTYwODZ8OTMwMnw3OTcpXFxiIiwiZmxhZ3MiOiIiLCJzYW1wbGUiOiJpc3N1ZSAxNTQ5OSIsIm1l',
  'c3NhZ2UiOiJyZWFsIGlzc3VlIG9yIG1lcmdlIHJlcXVlc3QgbnVtYmVyIn0seyJpZCI6InBlcnNvbiIsInNvdXJjZSI6Imx1aXoo',
  'PyEgbmV0byl8XFxiKFNhbXVlbHxSYWZhZWwpXFxifHNhbXVlbHAiLCJmbGFncyI6ImkiLCJzYW1wbGUiOiJhc2sgbHVpeiBhYm91',
  'dCBpdCIsIm1lc3NhZ2UiOiJyZWFsIHBlcnNvbiBuYW1lIG9yIGhhbmRsZSAodGhlIGF1dGhvciBhcHBlYXJzIG9ubHkgYXMgXCJM',
  'dWl6IE5ldG9cIikifSx7ImlkIjoiY2hhdC1wcm9kdWN0Iiwic291cmNlIjoiXFxiVGVhbXNcXGIiLCJmbGFncyI6IiIsInNhbXBs',
  'ZSI6InBhc3RlIGl0IGludG8gVGVhbXMiLCJtZXNzYWdlIjoiY29tcGFueSBjaGF0IHByb2R1Y3QgKHNheSBcInRlYW0gY2hhdFwi',
  'KSJ9XQ=='
].join('');

const decoded = JSON.parse(Buffer.from(RULES_B64, 'base64').toString('utf8'));

/** Rules that are safe to spell out. */
const GENERIC = [
  {
    id: 'private-ip',
    source: '\\b(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3})\\b',
    flags: '',
    sample: 'host 10.1.' + '2.3',
    message: 'address of a private network (use a documentation range: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)',
  },
  {
    id: 'secret',
    source: '-----BEGIN [A-Z ]*PRIVATE KEY-----|\\bsk-[A-Za-z0-9_-]{24,}|\\bghp_[A-Za-z0-9]{30,}|\\bglpat-[A-Za-z0-9_-]{20,}|\\bAKIA[0-9A-Z]{16}\\b',
    flags: '',
    sample: '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    message: 'something that looks like a key or a token',
  },
];

// Domains an email may have without being somebody's real address (reserved ones, the noreply address, and the code hosts whose "git@host:" remotes look like one).
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
const SAFE_DOMAIN = /(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.(test|invalid|local|example)|test|invalid|example|localhost)$|^users\.noreply\.github\.com$|^(github\.com|gitlab\.com|bitbucket\.org|(fcm\.)?googleapis\.com)$/i;

/** Paths that never belong in a public tree. */
const FORBIDDEN_PATHS = [
  { id: 'path', test: /^\.claude\//, message: 'agent session folder' },
  { id: 'path', test: /^(scratch|\.runlogs[^/]*)(\/|$)/, message: 'scratch or run log' },
  { id: 'path', test: /(^|\/)\.env($|\.)/, message: 'environment file' },
  { id: 'path', test: /\.(log|pem|p12|pfx|key)$/, message: 'log, certificate or key file' },
  { id: 'path', test: /(^|\/)legacy-profile\.json$/, message: 'private legacy profile (only the .example.json is public)' },
  { id: 'path', test: /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/, message: 'ssh key' },
];

export const RULES = [...decoded, ...GENERIC].map((r) => ({ ...r, regex: new RegExp(r.source, `${r.flags}g`) }));

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALLOWLIST = join(here, 'public-audit.allow.json');

/** "*" matches inside a folder, "**" across folders. */
export function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (c === '*') out += '[^/]*';
    else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function loadAllowlist(file = DEFAULT_ALLOWLIST) {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const entries = Array.isArray(raw) ? raw : raw.entries;
  return (entries ?? []).map((e) => {
    if (!e.rule || !e.file || !e.reason) throw new Error(`${file}: every entry needs "rule", "file" and "reason": ${JSON.stringify(e)}`);
    return { rule: e.rule, match: e.match ?? null, reason: e.reason, file: globToRegex(e.file) };
  });
}

function allowed(allow, rule, file, text) {
  return allow.some((a) => (a.rule === rule || a.rule === '*') && a.file.test(file) && (!a.match || text.includes(a.match)));
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/** Every hit in the given files: { file, line, rule, message, text }. `read(file)` returns a Buffer. */
export function auditFiles(files, read, allow = []) {
  const hits = [];
  const add = (file, line, rule, message, text) => {
    if (!allowed(allow, rule, file, text)) hits.push({ file, line, rule, message, text: text.length > 160 ? `${text.slice(0, 157)}...` : text });
  };
  for (const file of files) {
    for (const p of FORBIDDEN_PATHS) if (p.test.test(file)) add(file, 0, p.id, p.message, file);
    for (const r of RULES) {
      r.regex.lastIndex = 0;
      if (r.regex.test(file)) add(file, 0, r.id, `${r.message} (in the path)`, file);
    }
    let buf;
    try {
      buf = read(file);
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((text, i) => {
      for (const r of RULES) {
        r.regex.lastIndex = 0;
        const m = r.regex.exec(text);
        if (m) add(file, i + 1, r.id, r.message, text.trim());
      }
      EMAIL.lastIndex = 0;
      for (let m = EMAIL.exec(text); m; m = EMAIL.exec(text)) {
        if (!SAFE_DOMAIN.test(m[1])) add(file, i + 1, 'email', `email address outside the reserved domains (${m[0]})`, text.trim());
      }
    });
  }
  return hits;
}

function listFiles(root) {
  try {
    // A folder inside some other checkout (an export under an ignored path) is not a checkout of its own: walk it.
    const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (prefix) throw new Error('not the top of a checkout');
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // A path git lists may be gone from the disk (deleted, not committed yet): nothing to audit there.
    return out.split('\0').filter((f) => f && existsSync(join(root, f)));
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules') continue;
        const full = join(dir, name);
        const st = lstatSync(full);
        if (st.isDirectory()) walk(full);
        else if (st.isFile()) files.push(relative(root, full).split('\\').join('/'));
      }
    };
    walk(root);
    return files;
  }
}

export function auditRoot(root, allow) {
  const files = listFiles(root);
  return { files: files.length, hits: auditFiles(files, (f) => readFileSync(join(root, f)), allow) };
}

function main(argv) {
  if (argv.includes('--list-rules')) {
    for (const r of RULES) console.log(`${r.id.padEnd(20)} ${r.message}`);
    for (const p of FORBIDDEN_PATHS) console.log(`${p.id.padEnd(20)} ${p.message}`);
    console.log(`${'email'.padEnd(20)} email address outside the reserved domains`);
    return 0;
  }
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(here, '..');
  const allow = loadAllowlist();
  const { files, hits } = auditRoot(root, allow);
  const counts = new Map();
  for (const h of hits) counts.set(h.rule, (counts.get(h.rule) ?? 0) + 1);
  for (const h of hits) console.error(`${h.file}${h.line ? `:${h.line}` : ''}  [${h.rule}] ${h.message}\n    ${h.text}`);
  if (argv.includes('--counts')) {
    for (const id of [...RULES.map((r) => r.id), 'email', 'path']) console.log(`${id.padEnd(20)} ${counts.get(id) ?? 0}`);
  }
  if (hits.length) {
    console.error(`\npublic-audit: ${hits.length} hit(s) in ${new Set(hits.map((h) => h.file)).size} file(s) of ${files}. Fix them, or (for a real false positive) add a justified entry to scripts/public-audit.allow.json.`);
    return 1;
  }
  console.log(`public-audit: ${files} files, nothing that belongs to a company or a person.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
