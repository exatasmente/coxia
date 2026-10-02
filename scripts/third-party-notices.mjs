#!/usr/bin/env node
// Generates THIRD_PARTY_NOTICES.md from what is installed in node_modules (production dependencies only) plus the Python sidecar
// requirements, and flags every license that is not permissive.
//   node scripts/third-party-notices.mjs              write THIRD_PARTY_NOTICES.md
//   node scripts/third-party-notices.mjs --check      exit 1 when the committed file is out of date (does not write)
//   node scripts/third-party-notices.mjs --stdout     print instead of writing
//   node scripts/third-party-notices.mjs --venv <dir> also compare the sidecar tables with the installed Python packages' metadata
// Run it after `npm ci` (it reads node_modules). The output has no dates, so it is stable between runs.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'THIRD_PARTY_NOTICES.md');

// The Claude Agent SDK is proprietary and is left out of the public packages (electron-builder.public.yml). It is reported on its own.
const NOT_REDISTRIBUTED = /^@anthropic-ai\//;

const LEVELS = ['permissive', 'weak copyleft', 'strong copyleft', 'unknown'];

const PERMISSIVE = new Set(
  [
    'MIT', 'MIT-0', 'ISC', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense',
    'Python-2.0', 'PSF-2.0', 'Zlib', 'CC-BY-3.0', 'CC-BY-4.0', 'WTFPL', 'OFL-1.1', 'Artistic-2.0',
  ].map((s) => s.toLowerCase()),
);
const WEAK = /^(mpl-|lgpl-|epl-|cddl-|cc-by-sa-)/i;
const STRONG = /^(gpl-|agpl-|sspl-|eupl-)/i;
const ALIASES = { 'apache 2.0': 'Apache-2.0', 'apache license 2.0': 'Apache-2.0', 'apache-2': 'Apache-2.0', 'mit license': 'MIT', 'bsd license': 'BSD' };

/** Maps the spelling found in a manifest to an SPDX-style id when it is a known alias. */
export function normalizeLicense(raw) {
  const text = String(raw ?? '').trim();
  return ALIASES[text.toLowerCase()] ?? text;
}

function rankOfId(id) {
  const key = id.replace(/\+$/, '');
  if (PERMISSIVE.has(key.toLowerCase())) return 0;
  if (WEAK.test(key)) return 1;
  if (STRONG.test(key)) return 2;
  return 3;
}

/**
 * Classifies an SPDX expression: 0 permissive, 1 weak copyleft, 2 strong copyleft, 3 unknown.
 * `A OR B` is as good as the best option, `A AND B` as bad as the worst; `X WITH exception` counts as X.
 */
export function classifyLicense(expression) {
  const text = normalizeLicense(expression);
  if (!text || /^(see license|unlicensed|custom|proprietary)/i.test(text)) return 3;
  const tokens = text.match(/\(|\)|\bAND\b|\bOR\b|\bWITH\b|[^\s()]+/g) ?? [];
  let pos = 0;
  const atom = () => {
    const tok = tokens[pos++];
    if (tok === '(') {
      const value = orExpr();
      if (tokens[pos] === ')') pos++;
      return value;
    }
    if (tokens[pos] === 'WITH') pos += 2;
    return tok === undefined ? 3 : rankOfId(tok);
  };
  const andExpr = () => {
    let value = atom();
    while (tokens[pos] === 'AND') {
      pos++;
      value = Math.max(value, atom());
    }
    return value;
  };
  const orExpr = () => {
    let value = andExpr();
    while (tokens[pos] === 'OR') {
      pos++;
      value = Math.min(value, andExpr());
    }
    return value;
  };
  return orExpr();
}

export const levelName = (rank) => LEVELS[rank] ?? 'unknown';

/** The license of a package.json, as one expression. */
export function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return normalizeLicense(pkg.license);
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return normalizeLicense(pkg.license.type);
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    return pkg.licenses.map((l) => normalizeLicense(typeof l === 'string' ? l : l.type)).join(' OR ');
  }
  return '';
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Finds `name` the way Node would: the requiring package's own node_modules, then each ancestor's, up to the project root. */
function resolvePackage(name, fromDir, root) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return dirname(candidate);
    if (dir === root || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

/** The production closure of the root package.json: dependencies and optionalDependencies, transitively, as installed. */
export function collectNpm(root = ROOT) {
  const rootPkg = readJson(join(root, 'package.json'));
  const found = new Map();
  const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({ name, from: root }));
  while (queue.length) {
    const { name, from } = queue.shift();
    const dir = resolvePackage(name, from, root);
    if (!dir) continue;
    const pkg = readJson(join(dir, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    if (found.has(key)) continue;
    let license = licenseOf(pkg);
    let note = NPM_NOTES[pkg.name] ?? '';
    if (!license) {
      const inferred = licenseFromFile(dir);
      if (inferred) {
        license = inferred;
        note = note || 'No license field in package.json; read from the license file.';
      }
    }
    found.set(key, { name: pkg.name, version: pkg.version, license, note, rank: classifyLicense(license), homepage: homepageOf(pkg) });
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push({ name: dep, from: dir });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
}

// Notes for the packages that need an explanation next to their license.
const NPM_NOTES = {
  elkjs: 'EPL-2.0 is a file-level copyleft. Used unmodified, as a dependency of Mermaid (graph layout); source: https://github.com/kieler/elkjs.',
};

/** Best effort for a package without a `license` field: recognise the common texts in its license file. */
export function licenseFromFile(dir) {
  const name = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!name) return '';
  const head = readFileSync(join(dir, name), 'utf8').slice(0, 1500);
  if (/Permission is hereby granted, free of charge/i.test(head)) return 'MIT';
  if (/Apache License\s+Version 2\.0/i.test(head)) return 'Apache-2.0';
  if (/Redistribution and use in source and binary forms/i.test(head)) return /Neither the name|endorse or promote/i.test(head) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(head)) return 'ISC';
  return '';
}

function homepageOf(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const url = pkg.homepage || repo || '';
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/');
}

// The sidecar's Python packages. `requirements.txt` names the direct ones; the rest is what they pull in, as resolved on the machine this
// table was last checked on (`--venv <dir>` compares it with an installed environment). None of it ships with Coxia: the voice setup
// installs it on the user's machine with uv. `license` follows the package's own metadata.
export const PYTHON = {
  'faster-whisper': { license: 'MIT', note: 'Speech-to-text.' },
  'edge-tts': { license: 'LGPL-3.0-only', note: 'Text-to-speech through Microsoft\'s online service; the text spoken is sent to that service. Used as an installed library, unmodified.' },
  av: { license: 'BSD-3-Clause', note: 'PyAV. Its wheels bundle FFmpeg and codec libraries (LGPL and GPL components such as libx264 and libx265); see the package\'s own notices.' },
  'kokoro-onnx': { license: 'MIT', note: 'Local text-to-speech (Kokoro). Depends on phonemizer and espeakng-loader, which are GPL-3.0 (below).' },
  soundfile: { license: 'BSD-3-Clause', note: 'Its wheels bundle libsndfile (LGPL-2.1).' },
  aiohappyeyeballs: { license: 'PSF-2.0' },
  aiohttp: { license: 'Apache-2.0 AND MIT' },
  aiosignal: { license: 'Apache-2.0' },
  anyio: { license: 'MIT' },
  attrs: { license: 'MIT' },
  certifi: { license: 'MPL-2.0', note: 'Mozilla CA bundle.' },
  cffi: { license: 'MIT-0' },
  click: { license: 'BSD-3-Clause' },
  cloudpickle: { license: 'BSD-3-Clause' },
  ctranslate2: { license: 'MIT' },
  dlinfo: { license: 'MIT' },
  espeakng_loader: { license: 'GPL-3.0-or-later', note: 'Ships the eSpeak NG library (GPL-3.0-or-later); the package metadata declares no license of its own.' },
  filelock: { license: 'MIT' },
  flatbuffers: { license: 'Apache-2.0' },
  frozenlist: { license: 'Apache-2.0' },
  fsspec: { license: 'BSD-3-Clause' },
  h11: { license: 'MIT' },
  hf_xet: { license: 'Apache-2.0' },
  httpcore: { license: 'BSD-3-Clause' },
  httpx: { license: 'BSD-3-Clause' },
  huggingface_hub: { license: 'Apache-2.0' },
  idna: { license: 'BSD-3-Clause' },
  joblib: { license: 'BSD-3-Clause' },
  multidict: { license: 'Apache-2.0' },
  numpy: { license: 'BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0' },
  onnxruntime: { license: 'MIT' },
  packaging: { license: 'Apache-2.0 OR BSD-2-Clause' },
  phonemizer: { license: 'GPL-3.0-or-later', note: 'Pulled in by kokoro-onnx.' },
  propcache: { license: 'Apache-2.0' },
  protobuf: { license: 'BSD-3-Clause' },
  pycparser: { license: 'BSD-3-Clause' },
  pyyaml: { license: 'MIT' },
  tabulate: { license: 'MIT' },
  tokenizers: { license: 'Apache-2.0' },
  tqdm: { license: 'MPL-2.0 AND MIT' },
  typing_extensions: { license: 'PSF-2.0' },
  yarl: { license: 'Apache-2.0' },
};

const pyKey = (name) => name.toLowerCase().replace(/[-.]/g, '_');
const PY_BY_KEY = new Map(Object.entries(PYTHON).map(([name, info]) => [pyKey(name), { name, ...info }]));

/** Direct requirements from a requirements.txt body: [{ name, version }]. */
export function parseRequirements(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [, name, version] = line.match(/^([A-Za-z0-9_.-]+)\s*(?:==\s*([^\s;]+))?/) ?? [];
      return { name, version: version ?? '' };
    })
    .filter((r) => r.name);
}

/** Reads `<site-packages>/*.dist-info/METADATA` of a venv: [{ name, version }]. */
export function readVenv(venv) {
  const lib = join(venv, 'lib');
  if (!existsSync(lib)) return [];
  const out = [];
  for (const py of readdirSync(lib).filter((d) => d.startsWith('python'))) {
    const site = join(lib, py, 'site-packages');
    if (!existsSync(site)) continue;
    for (const entry of readdirSync(site).filter((d) => d.endsWith('.dist-info'))) {
      const meta = readFileSync(join(site, entry, 'METADATA'), 'utf8');
      const name = meta.match(/^Name:\s*(.+)$/m)?.[1];
      const version = meta.match(/^Version:\s*(.+)$/m)?.[1];
      if (name) out.push({ name, version: version ?? '' });
    }
  }
  return out;
}

function pythonRows(requirements) {
  const direct = parseRequirements(requirements).map((r) => {
    const info = PY_BY_KEY.get(pyKey(r.name));
    return { ...r, license: info?.license ?? '', note: info?.note ?? '', rank: classifyLicense(info?.license ?? ''), direct: true };
  });
  const directKeys = new Set(direct.map((r) => pyKey(r.name)));
  const transitive = [...PY_BY_KEY.values()]
    .filter((info) => !directKeys.has(pyKey(info.name)))
    .map((info) => ({ name: info.name.replace(/_/g, '-'), version: '', license: info.license, note: info.note ?? '', rank: classifyLicense(info.license), direct: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { direct, transitive };
}

const esc = (s) => String(s).replace(/\|/g, '\\|');

function table(rows, columns) {
  const head = `| ${columns.map((c) => c.title).join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${columns.map((c) => esc(c.value(r))).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The whole document, from collected data. Pure, so it can be tested without node_modules. */
export function renderMarkdown({ npm, sdk, python, rootVersion }) {
  const out = [];
  const flaggedNpm = npm.filter((p) => p.rank > 0);
  out.push('# Third-party notices');
  out.push('');
  out.push(
    `Coxia ${rootVersion} is licensed under the Apache License, Version 2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). It is built on the open-source components listed here, each under its own license. This file is generated by \`node scripts/third-party-notices.mjs\` from the production dependencies installed in \`node_modules\` and from \`sidecar/requirements.txt\`; do not edit it by hand.`,
  );
  out.push('');
  out.push('## Contents');
  out.push('');
  out.push('- [Claude Agent SDK (not redistributed)](#claude-agent-sdk-not-redistributed)');
  out.push('- [Summary and license flags](#summary-and-license-flags)');
  out.push('- [Runtime bundled in the packages](#runtime-bundled-in-the-packages)');
  out.push('- [Fonts and icons](#fonts-and-icons)');
  out.push('- [npm production dependencies](#npm-production-dependencies)');
  out.push('- [Voice sidecar (Python, installed by the user)](#voice-sidecar-python-installed-by-the-user)');
  out.push('- [Speech models](#speech-models)');
  out.push('');

  out.push('## Claude Agent SDK (not redistributed)');
  out.push('');
  out.push(
    'The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` and its platform binaries) is proprietary software of Anthropic, PBC, covered by Anthropic\'s terms, not by an open-source license. **Coxia\'s public builds do not contain it and this project does not redistribute it**: `electron-builder.public.yml` excludes every `@anthropic-ai` package. On the first run the setup wizard shows Anthropic\'s terms and, if the person accepts, installs the SDK with `npm` into a folder of their own. Whoever installs it is bound by Anthropic\'s terms for their own use.',
  );
  out.push('');
  out.push('- Legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance>');
  out.push('- Commercial terms: <https://www.anthropic.com/legal/commercial-terms>');
  out.push('');
  out.push(
    'A build made from source with `npm run dist` (the personal build) does include the SDK for the person who made it; such a build must not be redistributed. The packages published on GitHub Releases come from `npm run dist:public`.',
  );
  out.push('');
  if (sdk.length) {
    out.push(table(sdk, [{ title: 'Package', value: (p) => p.name }, { title: 'Version', value: (p) => p.version }, { title: 'License field', value: (p) => p.license || '(none)' }]));
    out.push('');
  }

  out.push('## Summary and license flags');
  out.push('');
  out.push(`- npm production dependencies in the public build: **${npm.length}**.`);
  for (const [license, count] of countBy(npm, 'license').slice(0, 12)) out.push(`  - ${license || '(none declared)'}: ${count}`);
  const flaggedPython = [...python.direct, ...python.transitive].filter((p) => p.rank > 0);
  out.push('');
  if (!flaggedNpm.length) {
    out.push('**npm: every production dependency is under a permissive license.** No weak or strong copyleft, and no unknown license.');
  } else {
    out.push('**npm: dependencies that are not plainly permissive** (review each one; an `OR` expression is classified by its best option, `AND` by its worst):');
    out.push('');
    out.push(table(flaggedNpm, [{ title: 'Package', value: (p) => `${p.name}@${p.version}` }, { title: 'License', value: (p) => p.license || '(none declared)' }, { title: 'Class', value: (p) => levelName(p.rank) }, { title: 'Note', value: (p) => p.note }]));
  }
  out.push('');
  out.push('**Python sidecar** (installed on the user\'s machine, never shipped with Coxia): the following are not plainly permissive.');
  out.push('');
  out.push(table(flaggedPython, [{ title: 'Package', value: (p) => p.name }, { title: 'License', value: (p) => p.license || '(unknown)' }, { title: 'Class', value: (p) => levelName(p.rank) }, { title: 'Note', value: (p) => p.note }]));
  out.push('');
  out.push(
    'The voice sidecar is a separate process that Coxia starts and talks to over a pipe. Coxia\'s own code is not linked with these Python packages. Local text-to-speech (Kokoro) requires the GPL-3.0 phonemizer and eSpeak NG packages; if that matters for how you use or redistribute Coxia, use the Edge engine or leave voice off.',
  );
  out.push('');

  out.push('## Runtime bundled in the packages');
  out.push('');
  out.push(
    'The AppImage and `.deb` contain the Electron runtime (Electron itself is MIT; Chromium and Node.js components carry their own licenses, which electron-builder collects in the `LICENSES.chromium.html` file and the `LICENSE.electron.txt` file next to the executable). They are not repeated in the table below, which covers the JavaScript packages under `node_modules`.',
  );
  out.push('');

  out.push('## Fonts and icons');
  out.push('');
  out.push('- **IBM Plex Sans** and **IBM Plex Mono** (npm packages `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`): copyright IBM Corp., licensed under the SIL Open Font License 1.1 (<https://openfontlicense.org>). The license text ships with each package.');
  out.push('- The application and tray icons in `resources/` and the icons drawn in the interface are original to this project and covered by its Apache-2.0 license. No third-party icon set is used.');
  out.push('');

  out.push('## npm production dependencies');
  out.push('');
  out.push('The closure of the `dependencies` of `package.json` (and their `dependencies` and `optionalDependencies`), as installed, without the `@anthropic-ai` packages above. Development tools (Vite, Vitest, TypeScript, electron-builder and so on) are not shipped and are not listed.');
  out.push('');
  out.push(table(npm, [{ title: 'Package', value: (p) => p.name }, { title: 'Version', value: (p) => p.version }, { title: 'License', value: (p) => p.license || '(none declared)' }, { title: 'Class', value: (p) => (p.rank === 0 ? '' : levelName(p.rank)) }, { title: 'Note', value: (p) => p.note }]));
  out.push('');

  out.push('## Voice sidecar (Python, installed by the user)');
  out.push('');
  out.push('`sidecar/requirements.txt` is installed into a virtual environment on the user\'s machine by the voice setup, only when the person turns voice on. Coxia does not distribute these packages. Direct requirements first, then what they pull in (versions are whatever the resolver picks):');
  out.push('');
  out.push(table(python.direct, [{ title: 'Package', value: (p) => p.name }, { title: 'Pinned', value: (p) => p.version }, { title: 'License', value: (p) => p.license || '(unknown)' }, { title: 'Note', value: (p) => p.note }]));
  out.push('');
  out.push(table(python.transitive, [{ title: 'Package', value: (p) => p.name }, { title: 'License', value: (p) => p.license || '(unknown)' }, { title: 'Note', value: (p) => p.note }]));
  out.push('');

  out.push('## Speech models');
  out.push('');
  out.push('Models are downloaded on the user\'s machine, never bundled. Check each model\'s card for the current terms.');
  out.push('');
  out.push('- **Whisper** weights through faster-whisper / CTranslate2 conversions from Hugging Face (tiny, base, small): the original OpenAI Whisper weights are MIT.');
  out.push('- **Kokoro** (`kokoro-v1.0.onnx`, `voices-v1.0.bin`, from the kokoro-onnx releases): the Kokoro-82M model is Apache-2.0.');
  out.push('- **Microsoft Edge online voices** are a cloud service, not software we ship; the text to be spoken is sent to Microsoft when that engine is on. Microsoft\'s terms apply.');
  out.push('');
  return out.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

  const rootPkg = readJson(join(ROOT, 'package.json'));
  const all = collectNpm(ROOT);
  const npm = all.filter((p) => !NOT_REDISTRIBUTED.test(p.name));
  const sdk = all.filter((p) => NOT_REDISTRIBUTED.test(p.name));
  const python = pythonRows(readFileSync(join(ROOT, 'sidecar', 'requirements.txt'), 'utf8'));

  const venv = value('--venv');
  if (venv) {
    const installed = readVenv(venv);
    const known = new Set(PY_BY_KEY.keys());
    const missing = installed.filter((p) => !known.has(pyKey(p.name))).map((p) => `${p.name} ${p.version}`);
    const stale = [...known].filter((k) => !installed.some((p) => pyKey(p.name) === k));
    if (missing.length) console.error(`Python packages not in the table (add them to PYTHON): ${missing.join(', ')}`);
    if (stale.length) console.error(`In the table but not installed: ${stale.join(', ')}`);
  }

  const markdown = `${renderMarkdown({ npm, sdk, python, rootVersion: rootPkg.version })}\n`;
  if (flag('--stdout')) {
    process.stdout.write(markdown);
    return 0;
  }
  if (flag('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current === markdown) return 0;
    console.error('THIRD_PARTY_NOTICES.md is out of date: run `node scripts/third-party-notices.mjs` and commit the result.');
    return 1;
  }
  writeFileSync(OUT, markdown);
  const flagged = npm.filter((p) => p.rank > 0);
  console.log(`Wrote THIRD_PARTY_NOTICES.md: ${npm.length} npm packages${sdk.length ? ` (+${sdk.length} Claude Agent SDK packages, not redistributed)` : ''}, ${flagged.length} flagged.`);
  for (const p of flagged) console.log(`  flagged: ${p.name}@${p.version} ${p.license || '(none)'} [${levelName(p.rank)}]`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv);
