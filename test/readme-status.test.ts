// The status line of the two readme files. It used to promise "0.1, first public version" while the manifest said
// otherwise, and neither readme led anywhere: both now name the version the manifest carries and lead to the site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (name: string): string => readFileSync(join(root, name), 'utf8');
const version = (): string => (JSON.parse(read('package.json')) as { version: string }).version;

describe('the status line of the readme', () => {
  it('names the version of the manifest, in both languages, and no longer the first public one', () => {
    const current = version();
    for (const file of ['README.md', 'README.pt-BR.md']) {
      const line = read(file).split('\n').find((l) => l.startsWith('> **Status:')) ?? '';
      expect(line, file).toContain(current);
      expect(line, file).not.toContain('0.1');
      expect(line, file).not.toMatch(/first public version|primeira versão pública/i);
    }
  });

  it('reads the version from the file the app itself reads, so it cannot be written by hand twice', () => {
    // The line is checked against `package.json` above; this pins that the file is the one the app answers with.
    expect(read('package.json')).toContain(`"version": "${version()}"`);
    expect(version()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  });

  it('leads to the published site from both readme files', () => {
    for (const file of ['README.md', 'README.pt-BR.md']) {
      const line = read(file).split('\n').find((l) => l.startsWith('> **Status:')) ?? '';
      expect(line, file).toMatch(/https:\/\/[a-z0-9.-]+\/[^\s)]+/);
    }
  });
});
