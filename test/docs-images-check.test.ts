import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script, no declaration file
import { divergences } from '../scripts/docs-images-check.mjs';

// The check the CI job runs next to the public audit: what the documentation uses must correspond to what the list names and
// what the folder holds. The test builds a small tree of its own, so it does not depend on the images the repository has yet.

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

/** A tree with a list, a script, a README that references the image and the image itself; each part may be left out. */
const tree = (parts: { images?: string[]; entries?: { id: string; script: string }[]; reference?: string | null; withScript?: boolean } = {}): string => {
  const root = mkdtempSync(join(tmpdir(), 'coxia-docs-images-'));
  made.push(root);
  mkdirSync(join(root, 'scripts/captures'), { recursive: true });
  mkdirSync(join(root, 'docs/images'), { recursive: true });
  writeFileSync(join(root, 'scripts/captures/index.json'), JSON.stringify(parts.entries ?? [{ id: 'today', script: 'today.mjs' }]));
  if (parts.withScript !== false) writeFileSync(join(root, 'scripts/captures/today.mjs'), '// capture\n');
  for (const name of parts.images ?? ['today.png']) writeFileSync(join(root, 'docs/images', name), 'png');
  writeFileSync(join(root, 'README.md'), parts.reference === null ? '# Coxia\n' : `![The day](${parts.reference ?? 'docs/images/today.png'})\n`);
  writeFileSync(join(root, 'README.pt-BR.md'), '# Coxia\n');
  return root;
};

describe('the check of the documentation images', () => {
  it('passes when the list, the script, the reference and the image correspond', () => {
    expect(divergences(tree())).toEqual([]);
  });

  it('refuses a reference with no entry in the list', () => {
    const problems = divergences(tree({ reference: 'docs/images/ghost.png', images: ['today.png', 'ghost.png'] }));
    expect(problems.join('\n')).toContain('ghost.png');
  });

  it('refuses an entry of the list whose image is not in the folder', () => {
    expect(divergences(tree({ images: [] })).join('\n')).toContain('today');
  });

  it('refuses a script the list names that is not there', () => {
    expect(divergences(tree({ withScript: false })).join('\n')).toContain('today.mjs');
  });

  it('refuses an entry of the list the documentation never references', () => {
    expect(divergences(tree({ reference: null })).join('\n')).toContain('docs/images/today.png');
  });

  it('refuses an image in the folder that no entry of the list names', () => {
    expect(divergences(tree({ images: ['today.png', 'stray.png'] })).join('\n')).toContain('stray.png');
  });
});
