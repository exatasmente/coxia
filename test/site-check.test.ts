// The site's own checks: every link of the built site resolves, and every page that carries a language carries both.
// Both are provoked here, because a check that cannot fail is not a check.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module, no declaration file
import { checkLanguages, checkLinks, checkSite, linksOf, walkHtml } from '../site/scripts/check.mjs';

const tree = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'site-check-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};

describe('the links of the built site', () => {
  it('passes when every link lands on a page the site has, absolute or relative', () => {
    const dir = tree({
      'index.html': '<a href="/guide/">Guide</a> <a href="/reference/runner.html">Runner</a>',
      'guide/index.html': '<a href="../index.html">Home</a> <a href="/reference/runner.html#x">Runner</a>',
      'reference/runner.html': '<p>x</p>',
    });
    expect(checkLinks(dir)).toEqual([]);
  });

  it('fails on a link to a page the site does not have, and names it', () => {
    const dir = tree({
      'index.html': '<a href="/guide/">Guide</a> <a href="/reference/nowhere.html">Nowhere</a>',
      'guide/index.html': '<p>x</p>',
    });
    expect(checkLinks(dir)).toEqual([{ page: 'index.html', href: '/reference/nowhere.html', missing: 'reference/nowhere.html' }]);
  });

  it('fails on a relative link that climbs out of a page that exists', () => {
    const dir = tree({ 'guide/index.html': '<a href="nowhere.html">Nowhere</a>' });
    expect(checkLinks(dir).map((b: { href: string }) => b.href)).toEqual(['nowhere.html']);
  });

  it('leaves addresses of other sites, anchors and mail alone', () => {
    const dir = tree({ 'index.html': '<a href="https://example.com/x">x</a> <a href="#top">top</a> <a href="mailto:a@example.com">m</a>' });
    expect(checkLinks(dir)).toEqual([]);
  });

  it('reads the links of a page apart from the text around them', () => {
    expect(linksOf('<a href="/a">A</a> and [B](/b) and <a href="https://x.test/c">C</a>')).toEqual(['/a', '/b']);
    expect(walkHtml(tree({ 'a/index.html': '', 'b.html': '' }))).toEqual(['a/index.html', 'b.html']);
  });
});

describe('the languages of the pages', () => {
  it('passes when every page the site writes has its pair', () => {
    const dir = tree({ 'index.md': 'x', 'index.pt-BR.md': 'x', 'guide/install.md': 'x', 'guide/install.pt-BR.md': 'x' });
    expect(checkLanguages(dir)).toEqual([]);
  });

  it('fails on a page that exists in one language only, and names the one that is missing', () => {
    const dir = tree({ 'index.md': 'x', 'index.pt-BR.md': 'x', 'guide/install.md': 'x' });
    expect(checkLanguages(dir)).toEqual([{ page: 'guide/install.md', missing: 'guide/install.pt-BR.md' }]);
  });

  it('accepts a page the repository itself writes in one language only, when it says so', () => {
    const dir = tree({ 'index.md': 'x', 'index.pt-BR.md': 'x', 'voice.md': 'Voice.\n\n<!-- site: one-language: the repository writes this document in one language only -->\n' });
    expect(checkLanguages(dir)).toEqual([]);
  });
});

describe('both checks at once', () => {
  it('reports what is wrong and says so when nothing is', () => {
    const built = tree({ 'index.html': '<a href="/nowhere.html">x</a>' });
    const sources = tree({ 'index.md': 'x' });
    const bad = checkSite(sources, built);
    expect(bad.ok).toBe(false);
    expect(bad.links).toHaveLength(1);
    expect(bad.languages).toEqual([{ page: 'index.md', missing: 'index.pt-BR.md' }]);
    const good = tree({ 'index.html': '<p>x</p>' });
    const pair = tree({ 'index.md': 'x', 'index.pt-BR.md': 'x' });
    expect(checkSite(pair, good)).toMatchObject({ ok: true, links: [], languages: [] });
  });
});
