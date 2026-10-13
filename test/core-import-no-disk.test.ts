// The core is given its data folder at boot: importing any of its modules computes no path and writes nothing. Every file under src/main but
// the desktop shell is imported here with an empty data folder, which must still be empty afterwards.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..');
const MAIN = join(REPO, 'src/main');
const SHELL = ['index.ts', 'electronPorts.ts', 'screen/encoderWindow.ts'];

const coreFiles = (): string[] =>
  readdirSync(MAIN, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts') && !SHELL.includes(f));

describe('importing the core', () => {
  it('leaves an empty data folder empty', { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerimonias-import-'));
    process.env.CERIMONIAS_DATA_DIR = dir;
    const files = coreFiles();
    expect(files.length).toBeGreaterThan(200);
    const created: string[] = [];
    for (const f of files) {
      await import(join(MAIN, f));
      const now = readdirSync(dir);
      if (now.length > created.length) created.push(`${relative(REPO, join(MAIN, f))}: ${now.join(', ')}`);
      if (now.length) break;
    }
    expect(created).toEqual([]);
  });
});
