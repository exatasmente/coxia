// The acceptance of this change: the secrets module and the paths module, and everything they import, do not reach the desktop runtime. A host
// without a desktop fills the ports they read, so any import of the runtime anywhere under these two files is a regression.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkImports } from './helpers/importGraph';

const REPO = join(import.meta.dirname, '..');
const ROOTS = ['src/main/secrets.ts', 'src/main/paths.ts'];

describe('the secrets and paths modules without the desktop runtime', () => {
  it('reach the desktop runtime nowhere, and the walk really covers their imports', () => {
    const { seen, offenders } = walkImports(REPO, ROOTS, (spec) => spec === 'electron' || spec === 'node:electron');
    expect(offenders).toEqual([]);
    // The walk must not be vacuous: the two roots have a real closure of their own.
    expect([...seen].map((f) => f.replaceAll('\\', '/'))).toEqual(expect.arrayContaining([expect.stringContaining('src/main/secrets-core.ts'), expect.stringContaining('src/main/env.ts')]));
  });
});
