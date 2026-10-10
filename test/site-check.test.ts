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
import { baseOf, candidatesOf, checkAssets, checkLanguages, checkLinks, checkSite, linksOf, targetOf, walkHtml } from '../site/scripts/check.mjs';
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

// What a build under an address base looks like: the pages are written under the plain folder, every address they
// carry names the site under the base the host serves it from, and the page at the root is the one the base is read
// off — which is what `assets/style.css` is there for.
const underBase = (base: string): string =>
  tree({
    'index.html': `<a href="${base}guide/">Guide</a> <a href="${base}reference/runner.html">Runner</a> <link rel="stylesheet" href="${base}assets/style.css">`,
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
    // One address of a build that carries a base leads nowhere, and it is the only failure: the base is read off the
    // build, so every other address of it has to resolve before this one is named.
    const dir = tree({
      'index.html': '<a href="/cerimonias/guide/">Guide</a> <a href="/cerimonias/reference/nowhere.html">Nowhere</a> <link rel="stylesheet" href="/cerimonias/assets/app.js">',
      'guide/index.html': '<p>x</p>',
      'assets/app.js': '',
    });
    expect(baseOf(dir)).toBe('/cerimonias/');
    expect(checkLinks(dir)).toEqual([
      { page: 'index.html', href: '/cerimonias/reference/nowhere.html', missing: 'reference/nowhere.html' },
    ]);
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

// A page of the site carries the `Português | English` link at its top, which is how a reader leaves it; a page whose
// pair exists and whose text names nothing has lost its other language as far as the check is concerned.
const named = (href: string, title: string, body = 'x') => `<a href="${href}" title="${title}">${title}</a>\n\n${body}`;

describe('the languages of the pages', () => {
  it('passes when every page the site writes carries both languages, in either shape', () => {
    const dir = tree({
      'index.md': named('/pt-br/index', 'Português'), 'pt-br/index.md': named('/index', 'English'),
      'guide/install.md': named('/guide/pt-br/install', 'Português'), 'guide/pt-br/install.md': named('/guide/install', 'English'),
      'runner.md': named('/reference/runner.pt-br', 'Português'), 'runner.pt-br.md': named('/reference/runner', 'English'),
    });
    expect(checkLanguages(dir)).toEqual([]);
  });

  it('reads the pair of a page of the site, which is the same name under a `pt-br/` folder', () => {
    // The guide, the use cases, the blog and the landing page of this site are written this way, and the check has to
    // accept them: the `.pt-BR.md` mark on the same name is the other shape, not the only one.
    const dir = tree({
      'index.md': named('/pt-br/index', 'Português'), 'pt-br/index.md': named('/index', 'English'),
      'guide/index.md': named('/guide/pt-br/index', 'Português'), 'guide/pt-br/index.md': named('/guide/index', 'English'),
      'use-cases/team.md': named('/use-cases/pt-br/team', 'Português'), 'use-cases/pt-br/team.md': named('/use-cases/team', 'English'),
    });
    expect(checkLanguages(dir)).toEqual([]);
    expect(candidatesOf('use-cases/team.md')).toEqual(['use-cases/team.pt-BR.md', 'use-cases/team.pt-br.md', 'use-cases/pt-br/team.md']);
    expect(candidatesOf('use-cases/pt-br/team.md')).toEqual(['use-cases/team.md']);
  });

  it('fails on a page of the site that exists in one language only, in either shape, and names the one missing', () => {
    const dir = tree({
      'index.md': named('/pt-br/index', 'Português'), 'pt-br/index.md': named('/index', 'English'),
      'use-cases/team.md': 'x',
      'use-cases/pt-br/index.md': 'x',
    });
    // Two pages lost their pair. Which name it would have follows from the shape its own section is written in: the
    // `pt-br/` folder beside an English page, and the name it mirrors beside the Portuguese half of a pair.
    expect(checkLanguages(dir)).toEqual([
      { page: 'use-cases/pt-br/index.md', missing: 'use-cases/index.md' },
      { page: 'use-cases/team.md', missing: 'use-cases/pt-br/team.md' },
    ]);
  });

  it('takes the pair beside the page as its second language even when the page names nothing', () => {
    // The navigation reaches the pair, so a page whose pair is beside it passes with no link of its own — that is how
    // the pages of this site are written today. What is not allowed is naming a pair that is not the page's own.
    const dir = tree({ 'guide/index.md': '# Guide\n', 'guide/pt-br/index.md': '# Guia\n' });
    expect(checkLanguages(dir)).toEqual([]);
    const wrong = tree({
      'guide/index.md': named('/use-cases/pt-br/team', 'Português'),
      'guide/pt-br/index.md': named('/use-cases/team', 'English'),
    });
    expect(checkLanguages(wrong)).toEqual([
      { page: 'guide/index.md', missing: 'the link to the other language points at /use-cases/pt-br/team, not at /guide/pt-br/index' },
      { page: 'guide/pt-br/index.md', missing: 'the link to the other language points at /use-cases/team, not at /guide/index' },
    ]);
  });

  it('accepts a page built from a document that names its other language with a link, and catches one that lies', () => {
    // A reference page is built from the document it comes from, so its sources are not `x.md`/`pt-br/x.md`; it names
    // its pair with a link labelled in the language it leads to, and that link has to lead to its own pair.
    const good = tree({
      'runner.md': named('/reference/runner.pt-br', 'Português'),
      'runner.pt-br.md': named('/reference/runner', 'English'),
    });
    expect(checkLanguages(good)).toEqual([]);
    const lying = tree({ 'voice.md': named('/reference/screen.pt-br', 'Português'), 'voice.pt-br.md': named('/reference/voice', 'English') });
    expect(checkLanguages(lying)).toEqual([
      { page: 'voice.md', missing: 'the link to the other language points at /reference/screen.pt-br, not at /reference/voice.pt-br' },
    ]);
  });

  it('accepts a page the repository itself writes in one language only, when it says so', () => {
    const dir = tree({
      'index.md': named('/pt-br/index', 'Português'), 'pt-br/index.md': named('/index', 'English'),
      'voice.md': 'Voice.\n\n<!-- site: one-language: the repository writes this document in one language only -->\n',
    });
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
    expect(bad.languages).toEqual([{ page: 'index.md', missing: 'pt-br/index.md' }]);
    const good = tree({ 'index.html': '<p>x</p>' });
    const both = tree({ 'index.md': named('/pt-br/index', 'Português'), 'pt-br/index.md': named('/index', 'English') });
    expect(checkSite(both, good)).toMatchObject({ ok: true, links: [], languages: [] });
  });
});
