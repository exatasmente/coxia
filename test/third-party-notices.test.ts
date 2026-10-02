import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The script is plain ESM JavaScript; it is loaded by URL so the typecheck does not need declarations for it.
const script = pathToFileURL(join(__dirname, '..', 'scripts', 'third-party-notices.mjs')).href;
const lib = (await import(/* @vite-ignore */ script)) as {
  classifyLicense: (expression: string) => number;
  licenseOf: (pkg: object) => string;
  parseRequirements: (text: string) => { name: string; version: string }[];
  collectNpm: (root: string) => { name: string; version: string; license: string; rank: number }[];
  licenseFromFile: (dir: string) => string;
  renderMarkdown: (data: object) => string;
};

describe('license classification', () => {
  it('treats the common permissive licenses as permissive', () => {
    for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'OFL-1.1', 'Python-2.0']) expect(lib.classifyLicense(id)).toBe(0);
  });

  it('flags weak and strong copyleft and unknown licenses', () => {
    expect(lib.classifyLicense('MPL-2.0')).toBe(1);
    expect(lib.classifyLicense('EPL-2.0')).toBe(1);
    expect(lib.classifyLicense('LGPL-3.0-only')).toBe(1);
    expect(lib.classifyLicense('GPL-3.0-or-later')).toBe(2);
    expect(lib.classifyLicense('AGPL-3.0')).toBe(2);
    expect(lib.classifyLicense('')).toBe(3);
    expect(lib.classifyLicense('SEE LICENSE IN README.md')).toBe(3);
    expect(lib.classifyLicense('Some-Custom-License')).toBe(3);
  });

  it('takes the best option of OR and the worst of AND', () => {
    expect(lib.classifyLicense('(MPL-2.0 OR Apache-2.0)')).toBe(0);
    expect(lib.classifyLicense('MIT AND GPL-3.0-only')).toBe(2);
    expect(lib.classifyLicense('(MIT OR GPL-2.0) AND BSD-2-Clause')).toBe(0);
    expect(lib.classifyLicense('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(2);
  });

  it('understands the old manifest spellings', () => {
    expect(lib.licenseOf({ license: 'Apache 2.0' })).toBe('Apache-2.0');
    expect(lib.licenseOf({ license: { type: 'MIT' } })).toBe('MIT');
    expect(lib.licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
    expect(lib.licenseOf({})).toBe('');
  });
});

describe('requirements', () => {
  it('reads pinned requirements and ignores comments and blank lines', () => {
    expect(lib.parseRequirements('# voice\nfaster-whisper==1.2.1\n\nedge-tts==7.2.7  # tts\nsoundfile\n')).toEqual([
      { name: 'faster-whisper', version: '1.2.1' },
      { name: 'edge-tts', version: '7.2.7' },
      { name: 'soundfile', version: '' },
    ]);
  });
});

function pkg(root: string, path: string, manifest: object, files: Record<string, string> = {}): void {
  const dir = join(root, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

describe('collectNpm', () => {
  it('follows production dependencies, nested copies and optional ones, and skips what is not installed', () => {
    const root = mkdtempSync(join(tmpdir(), 'notices-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { a: '1', b: '1' }, devDependencies: { dev: '1' } }));
    pkg(root, 'node_modules/a', { name: 'a', version: '1.0.0', license: 'MIT', dependencies: { c: '2' }, optionalDependencies: { missing: '1' } });
    pkg(root, 'node_modules/a/node_modules/c', { name: 'c', version: '2.0.0', license: 'ISC' });
    pkg(root, 'node_modules/b', { name: 'b', version: '1.0.0', license: 'GPL-3.0-only', dependencies: { c: '1' } });
    pkg(root, 'node_modules/c', { name: 'c', version: '1.0.0', license: 'MIT' }, { LICENSE: 'The MIT License\n\nPermission is hereby granted, free of charge, to any person' });
    pkg(root, 'node_modules/dev', { name: 'dev', version: '1.0.0', license: 'MIT' });

    const rows = lib.collectNpm(root);
    expect(rows.map((r) => `${r.name}@${r.version}`)).toEqual(['a@1.0.0', 'b@1.0.0', 'c@1.0.0', 'c@2.0.0']);
    expect(rows.find((r) => r.name === 'b')?.rank).toBe(2);
  });

  it('reads the license from the license file when the manifest has none', () => {
    const root = mkdtempSync(join(tmpdir(), 'notices-'));
    pkg(root, 'x', { name: 'x', version: '1.0.0' }, { license: 'The MIT License (MIT)\n\nPermission is hereby granted, free of charge, to any person' });
    expect(lib.licenseFromFile(join(root, 'x'))).toBe('MIT');
  });
});

describe('document', () => {
  const rows = [
    { name: 'left-pad', version: '1.0.0', license: 'MIT', note: '', rank: 0 },
    { name: 'gpl-lib', version: '2.0.0', license: 'GPL-3.0-only', note: '', rank: 2 },
  ];
  const doc = lib.renderMarkdown({ npm: rows, sdk: [{ name: '@anthropic-ai/claude-agent-sdk', version: '9.9.9', license: 'SEE LICENSE IN README.md' }], python: { direct: [], transitive: [] }, rootVersion: '1.2.3' });

  it('says the Claude Agent SDK is not redistributed and links Anthropic\'s terms', () => {
    expect(doc).toContain('do not contain it and this project does not redistribute it');
    expect(doc).toContain('https://www.anthropic.com/legal/commercial-terms');
    expect(doc).toContain('@anthropic-ai/claude-agent-sdk | 9.9.9');
  });

  it('flags the non-permissive dependency and lists every row', () => {
    expect(doc).toContain('gpl-lib@2.0.0 | GPL-3.0-only | strong copyleft');
    expect(doc).toContain('| left-pad | 1.0.0 | MIT |');
  });
});
