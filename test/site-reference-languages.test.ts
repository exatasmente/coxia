// The reference pages of the site are not written by hand: the build writes one page per language of every document
// of `docs/` under `generated/reference/`, which is not versioned and which the site's language check reads, because
// that folder is where the pages built from the repository's documents are born. This case runs the generator over a
// real `docs/` folder and the language check over what it wrote, so a document that loses one of its two languages
// fails the check where the site is actually built, not only in a hand-written fixture.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module, no declaration file
import { writeSources } from '../site/.vitepress/build-sources.mjs';
// @ts-expect-error plain ESM module, no declaration file
import { checkLanguages } from '../site/scripts/check.mjs';
// @ts-expect-error plain ESM module, no declaration file
import { pagePath, referencePages } from '../site/scripts/docs-pages.mjs';

const root = join(import.meta.dirname, '..');

// A repository of its own, holding the real documents of `docs/` and the files the generator reads besides them, so
// that what is written is what the build of this repository writes and nothing of it lands in the tree.
const repository = (): string => {
  const at = mkdtempSync(join(tmpdir(), 'site-reference-'));
  cpSync(join(root, 'docs'), join(at, 'docs'), { recursive: true });
  writeFileSync(join(at, 'CHANGELOG.md'), readFileSync(join(root, 'CHANGELOG.md')));
  writeFileSync(join(at, 'package.json'), readFileSync(join(root, 'package.json')));
  mkdirSync(join(at, 'site'), { recursive: true });
  return at;
};

describe('the reference pages the build writes', () => {
  it('carries a page per language of every document of the repository, and the check names none of them', () => {
    const at = repository();
    writeSources(at);
    expect(referencePages(join(at, 'docs'))).toEqual(referencePages(join(root, 'docs')));
    // The page of a document is served at the address its path gives it, and its Portuguese half carries the mark.
    expect(readFileSync(join(at, 'site/generated/reference/runner.pt-br.md'), 'utf8')).toContain(`${pagePath('runner.md', 'en')} "English"`);
    expect(checkLanguages(join(at, 'site'))).toEqual([]);
  });

  it('fails, and names the half, when a document loses the language that other pages already carry', () => {
    const at = repository();
    const bilingual = referencePages(join(at, 'docs')).find((path: string) => readFileSync(join(at, 'docs', path), 'utf8').includes('\n## Português'));
    expect(bilingual).toBeTruthy();
    const source = join(at, 'docs', bilingual as string);
    const text = readFileSync(source, 'utf8');
    // The Portuguese half goes, and the build then writes the document the way it writes one the repository keeps in
    // a single language: the page the check reads is no longer a page of a pair, and only the document says it was.
    writeFileSync(source, text.slice(text.indexOf('\n## English')));
    writeSources(at);
    const served = pagePath(bilingual as string, 'en');
    expect(readFileSync(join(at, 'site/generated', 'reference', `${served.replace('/reference/', '')}.md`), 'utf8')).toContain('site: one-language');
    expect(checkLanguages(join(at, 'site'))).toContainEqual({ page: served, missing: `no page is served at ${served}.pt-br` });
  });

  it('fails, and names the half, when a page keeps the link to a language it no longer has beside it', () => {
    const at = repository();
    writeSources(at);
    const english = join(at, 'site/generated/reference/runner.md');
    // The language of the link is put into a code span, which is text the check ignores: the page still draws at the
    // Portuguese half, but a link to it is gone, so the page names the language it lost and leads nowhere.
    const kept = readFileSync(english, 'utf8').replace(/\[Português\]\((\/reference\/runner\.pt-br)[^)]*\)/, '`[$1]`');
    writeFileSync(english, kept);
    expect(checkLanguages(join(at, 'site'))).toContainEqual({
      page: '/reference/runner',
      missing: 'no page is served at /reference/runner.pt-br',
    });
  });
});
