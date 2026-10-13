// No file of the core reaches the desktop runtime: only the desktop shell imports it, and it fills the ports (secrets, paths, host) the core
// reads. A headless host runs the same core, so an import of the runtime anywhere in it, or of a shell file, is a regression.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkImports } from './helpers/importGraph';

const REPO = join(import.meta.dirname, '..');
const MAIN = join(REPO, 'src/main');

// The desktop shell: the entry that opens the window and the tray, the file that fills the ports from the runtime, and the hidden window that
// records the agents' screen. Nothing else may import them.
const SHELL = ['src/main/index.ts', 'src/main/electronPorts.ts', 'src/main/screen/encoderWindow.ts'];

// The headless entry is a host of the core like the desktop is, and runs on plain Node: it is held to the same rule.
const HEADLESS = join(REPO, 'src/headless');

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => relative(REPO, join(dir, f)).replaceAll('\\', '/'));

const coreFiles = (): string[] => [...filesUnder(MAIN), ...filesUnder(HEADLESS)].filter((f) => !SHELL.includes(f));

describe('the core without the desktop runtime', () => {
  it('has no file that reaches electron or a file of the desktop shell, and the walk covers the whole core', () => {
    const roots = coreFiles();
    const shell = new Set(SHELL.map((f) => join(REPO, f)));
    const { seen, offenders } = walkImports(REPO, roots, (spec, resolved) => spec === 'electron' || spec === 'node:electron' || (resolved !== null && shell.has(resolved)));
    expect(offenders).toEqual([]);
    // Not vacuous: the core is most of src/main, and the files that used to reach the runtime are in it.
    expect(roots.length).toBeGreaterThan(200);
    expect(roots).toContain('src/headless/main.ts');
    expect([...seen].map((f) => relative(REPO, f).replaceAll('\\', '/'))).toEqual(
      expect.arrayContaining(['src/main/runner/module.ts', 'src/main/workspaces.ts', 'src/main/update.ts', 'src/main/updates.ts', 'src/main/wizard.ts', 'src/main/modules.ts']),
    );
  });

  it('the shell still reaches the runtime, so the walk would see one', () => {
    const { offenders } = walkImports(REPO, SHELL, (spec) => spec === 'electron');
    expect(offenders.length).toBeGreaterThan(0);
  });
});
