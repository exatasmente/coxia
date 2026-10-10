// The site's own checks: every link of the built site resolves, and every page that carries a language carries both.
// Both are provoked here, because a check that cannot fail is not a check. The link check reads the address base of
// the build it is given, which is the only environment the site is published in: a build carries the base in its own
// addresses while the folder it was written to does not, so a check that ignored the base would call every link of a
// published build broken.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module, no declaration file
import { baseOf, candidatesOf, checkLanguages, checkLinks, checkSite, linksOf, targetOf, walkHtml } from '../site/scripts/check.mjs';
// @ts-expect-error plain ESM module, no declaration file
import { otherLanguageLink, pagePath, referenceRoute } from '../site/scripts/docs-pages.mjs';

const tree = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'site-check-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};

// What a build under an address base looks like: the pages are written under the plain folder, and every address they
// carry names the site under the base the host serves it from.
const underBase = (base: string): string =>
  tree({
    'index.html': `<a href="${base}guide/">Guide</a> <a href="${base}reference/runner.html">Runner</a> <link href="${base}assets/style.css">`,
    'guide/index.html': `<a href="${base}guide/install">Install</a> <a href="${base}reference/runner.html#x">Runner</a>`,
    'guide/install.html': `<a href="${base}">Home</a>`,
    'reference/runner.html': '<p>x</p>',
    'assets/style.css': 'a{}',
  });

describe('the address base of a build', () => {
  it('reads the base the site was built with from the page, whatever its value', () => {
    expect(baseOf(underBase('/cerimonias/'))).toBe('/cerimonias/');
    expect(baseOf(underBase('/site/'))).toBe('/site/');
  });

  it('leaves addresses alone when the site was built at the root', () => {
    expect(baseOf(tree({ 'index.html': '<link rel="stylesheet" href="/assets/style.css">' }))).toBe('/');
    expect(baseOf(tree({ 'index.html': '<p>no stylesheet</p>' }))).toBe('/');
    expect(baseOf(tree({ 'guide/index.html': '<p>x</p>' }))).toBe('/');
  });
});

describe('the links of the built site', () => {
  it('passes when every link lands on a page the site has, absolute or relative', () => {
    const dir = tree({
      'index.html': '<a href="/guide/">Guide</a> <a href="/reference/runner.html">Runner</a>',
      'guide/index.html': '<a href="../index.html">Home</a> <a href="/reference/runner.html#x">Runner</a>',
      'reference/runner.html': '<p>x</p>',
    });
    expect(checkLinks(dir)).toEqual([]);
  });

  it('resolves the links of a build made with an address base, which is how the site is published', () => {
    expect(baseOf(underBase('/cerimonias/'))).toBe('/cerimonias/');
    expect(checkLinks(underBase('/cerimonias/'))).toEqual([]);
  });

  it('still fails on a link of that build that points at a page the site does not have', () => {
    const dir = tree({
      'index.html': '<a href="/cerimonias/guide/">Guide</a> <a href="/cerimonias/reference/nowhere.html">Nowhere</a>',
      'guide/index.html': '<p>x</p>',
    });
    expect(checkLinks(dir)).toEqual([{ page: 'index.html', href: '/cerimonias/reference/nowhere.html', missing: 'reference/nowhere.html' }]);
  });

  it('takes the base off an address before it looks it up', () => {
    expect(targetOf(tree({ 'guide/index.html': '<p>x</p>' }), 'guide/index.html', '/cerimonias/guide/', '/cerimonias/')).toBe('guide/index.html');
    const dir = tree({ 'index.html': '<a href="/guide/">Guide</a>', 'guide/index.html': '<p>x</p>' });
    expect(checkLinks(dir, '/')).toEqual([]);
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

  it('reads the pair of a page of the site, which is the same name under a `pt-br/` folder', () => {
    // The guide, the use cases, the blog and the landing page of this site are written this way, and the check has to
    // accept them: the `.pt-BR.md` mark on the same name is the other shape, not the only one.
    const dir = tree({
      'index.md': 'x', 'pt-br/index.md': 'x',
      'guide/index.md': 'x', 'guide/pt-br/index.md': 'x',
      'use-cases/team.md': 'x', 'use-cases/pt-br/team.md': 'x',
    });
    expect(checkLanguages(dir)).toEqual([]);
    expect(candidatesOf('use-cases/team.md')).toEqual(['use-cases/team.pt-BR.md', 'use-cases/pt-br/team.md']);
  });

  it('fails on a page of the site that exists in one language only, in either shape, and names the one missing', () => {
    const dir = tree({
      'index.md': 'x', 'pt-br/index.md': 'x',
      'guide/index.md': 'x', 'guide/pt-br/index.md': 'x',
      'use-cases/team.md': 'x', 'use-cases/pt-br/index.md': 'x',
    });
    expect(checkLanguages(dir)).toEqual([{ page: 'use-cases/team.md', missing: 'use-cases/team.pt-BR.md' }]);
  });

  it('accepts a page built from a document that names its other language with a link, and catches one that lies', () => {
    // A reference page is built from the document it comes from, so its sources are not `x.md`/`pt-br/x.md`; it names
    // its pair with a link labelled in the language it leads to, and that link has to lead to its own pair.
    const good = tree({ 'runner.md': '<a href="/reference/runner.pt-br" title="Português">Português</a>', 'runner.pt-br.md': 'x' });
    expect(checkLanguages(good)).toEqual([]);
    const lying = tree({ 'voice.md': '<a href="/reference/screen.pt-br" title="Português">Português</a>' });
    expect(checkLanguages(lying)).toEqual([
      { page: 'voice.md', missing: 'the link to the other language points at /reference/screen.pt-br, not at /reference/voice' },
    ]);
  });

  it('accepts a page the repository itself writes in one language only, when it says so', () => {
    const dir = tree({ 'index.md': 'x', 'index.pt-BR.md': 'x', 'voice.md': 'Voice.\n\n<!-- site: one-language: the repository writes this document in one language only -->\n' });
    expect(checkLanguages(dir)).toEqual([]);
  });
});

describe('the link to the other language, and the address of a document', () => {
  it('finds the link that leads to the other language, and ignores a link that leads to a page', () => {
    expect(otherLanguageLink('<a href="/reference/runner.pt-br" title="Português">PT</a>')).toMatchObject({ href: '/reference/runner.pt-br', lang: 'pt-BR' });
    expect(otherLanguageLink('<a class="link" href="/guide/install" title="Install">Install</a>')).toBeNull();
    expect(otherLanguageLink('<a class="link" href="/guide/install">Install</a>')).toBeNull();
    expect(otherLanguageLink('<p>no link here</p>')).toBeNull();
  });

  it('keeps one rule for the address of a document, which the configuration and the sources both ask for', () => {
    expect(referenceRoute('Plugins/README.md')).toBe('/reference/plugins/index');
    expect(pagePath('Plugins/README.md', 'pt-BR')).toBe('/reference/plugins/index.pt-br');
    expect(pagePath('runner.md', 'en')).toBe('/reference/runner');
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
