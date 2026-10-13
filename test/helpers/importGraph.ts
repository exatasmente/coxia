import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// A walk over the relative imports of the source (value, type, re-export, bare, dynamic and require), for the tests that hold a boundary.

// `from 'x'` covers value, type and re-export imports; the other three catch a dynamic import, a bare import and a require.
const SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g;

export function specifiersOf(file: string): string[] {
  const found: string[] = [];
  for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIER)) found.push((m[1] ?? m[2] ?? m[3] ?? m[4]) as string);
  return found;
}

function resolveFrom(file: string, spec: string): string | null {
  const base = resolve(dirname(file), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  return null;
}

export interface Walk {
  /** Every file reached, roots included, as absolute paths. */
  seen: Set<string>;
  /** Each forbidden step, as the chain of imports from a root that leads to it. */
  offenders: string[];
}

/** Walks from the roots (relative to `repo`); a step is forbidden when `forbidden(spec, resolved)` says so, and the walk does not go past it. */
export function walkImports(repo: string, roots: string[], forbidden: (spec: string, resolved: string | null) => boolean): Walk {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = roots.map((r) => ({ file: resolve(repo, r), chain: [r] }));
  while (queue.length > 0) {
    const { file, chain } = queue.shift() as { file: string; chain: string[] };
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiersOf(file)) {
      const next = spec.startsWith('.') ? resolveFrom(file, spec) : null;
      if (forbidden(spec, next)) {
        offenders.push([...chain, spec].join(' -> '));
        continue;
      }
      if (next) queue.push({ file: next, chain: [...chain, spec] });
    }
  }
  return { seen, offenders };
}
