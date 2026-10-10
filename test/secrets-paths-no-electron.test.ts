// The acceptance of this change: the secrets module and the paths module, and everything they import, do not reach the desktop runtime. A host
// without a desktop fills the ports they read, so any import of the runtime anywhere under these two files is a regression. The walker below
// follows every relative import (value, type, dynamic) to find one.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..');
const ROOTS = ['src/main/secrets.ts', 'src/main/paths.ts'];

// `from 'x'` covers value, type and re-export imports; the other two catch a bare import and a dynamic or require one.
const SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const found: string[] = [];
  for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIER)) found.push((m[1] ?? m[2] ?? m[3] ?? m[4]) as string);
  return found;
}

function resolveFrom(file: string, spec: string): string | null {
  const base = resolve(dirname(file), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  return null;
}

describe('the secrets and paths modules without the desktop runtime', () => {
  it('reach the desktop runtime nowhere, and the walk really covers their imports', () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = ROOTS.map((r) => ({ file: resolve(REPO, r), chain: [r] }));
    while (queue.length > 0) {
      const { file, chain } = queue.shift() as { file: string; chain: string[] };
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of specifiersOf(file)) {
        if (spec === 'electron' || spec === 'node:electron') offenders.push([...chain, spec].join(' -> '));
        const next = spec.startsWith('.') ? resolveFrom(file, spec) : null;
        if (next) queue.push({ file: next, chain: [...chain, spec] });
      }
    }
    expect(offenders).toEqual([]);
    // The walk must not be vacuous: the two roots have a real closure of their own.
    expect([...seen].map((f) => f.replaceAll('\\', '/'))).toEqual(expect.arrayContaining([expect.stringContaining('src/main/secrets-core.ts'), expect.stringContaining('src/main/env.ts')]));
  });
});