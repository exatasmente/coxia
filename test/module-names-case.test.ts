import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Windows and macOS resolve imports case-insensitively and try `.ts` before `.tsx`: two modules of one folder whose names differ only by case (or only
// by extension) make `./Name` load the wrong one there, while the Linux build passes.
function clashes(dir: string): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...clashes(path));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    const key = entry.name.slice(0, -extname(entry.name).length).toLowerCase();
    const other = seen.get(key);
    if (other) out.push(`${join(dir, other)} / ${path}`);
    else seen.set(key, entry.name);
  }
  return out;
}

describe('module names', () => {
  it('no two modules of a folder differ only by case or extension', () => {
    expect(clashes('src')).toEqual([]);
  });
});
