// The site's own checks, at run time: every link of the built site resolves, and every page that carries a language
// carries both. Pure Node over the built folder, so the suite can provoke each failure without a browser.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { otherLanguageLink, referenceRoute } from './docs-pages.mjs';

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HREF = /\bhref="([^"]+)"/g;

// What VitePress writes beside its assets: when the site is built with an address base, every address it writes
// carries that base, while the folder it is built into does not, so the base has to be taken off before a link is
// looked up. The check reads the base from the build it is checking, never from the environment — two builds with
// different bases can sit side by side, and the workflow that publishes the site builds with a base that is written
// in no file of the tree.
const ASSET = /(?:href|src)="([^"]*?\/assets\/[A-Za-z0-9._-]+\.(?:js|css)[^"]*)"/;

/** The address base of a built site: the path the host serves it under, `/` when it is the root. */
export function baseOf(dir) {
  if (!existsSync(join(dir, 'index.html'))) return '/';
  const asset = ASSET.exec(readFileSync(join(dir, 'index.html'), 'utf8'))?.[1];
  if (!asset) return '/';
  const at = asset.indexOf('/assets/');
  return at > 0 ? `${asset.slice(0, at)}/` : '/';
}

/** Every `.html` file under `dir`, as `/`-separated paths relative to it. */
export function walkHtml(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.html')) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** The internal links of one page: the `href`s that point inside the site, in the order they appear. */
export function linksOf(html) {
  const found = [];
  for (const re of [HREF, LINK]) {
    re.lastIndex = 0;
    for (let m = re.exec(html); m; m = re.exec(html)) found.push([m.index, m[1]]);
  }
  return found
    .sort((a, b) => a[0] - b[0])
    .map(([, href]) => href)
    .filter((href) => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') && !href.startsWith('#'));
}

/** The path of a link with the base of the build taken off: what is left names a file of the built folder itself. */
export function withinBase(href, base) {
  let rest = href;
  while (base !== '/' && rest.startsWith(base)) rest = rest.slice(base.length);
  rest = rest.replace(/^\/+/, '');
  if (base === '/') return rest;
  return rest === '' ? '' : `/${rest}`;
}

/** Where a link must land in the built folder: the file the server would serve for it. */
export function targetOf(dir, page, href, base = '/') {
  const raw = href.split('#')[0].split('?')[0];
  const path = withinBase(raw, base);
  if (!path) return null;
  const from = raw.startsWith('/') ? join(dir, path) : resolve(dir, dirname(page), path);
  for (const candidate of [from, join(from, 'index.html'), `${from}.html`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(dir, candidate).split(sep).join('/');
  }
  return { missing: relative(dir, from).split(sep).join('/') };
}

/** Every link of the built site that points at a page the site does not have. */
export function checkLinks(dir, base = baseOf(dir)) {
  const broken = [];
  for (const page of walkHtml(dir)) {
    const html = readFileSync(join(dir, page), 'utf8');
    for (const href of linksOf(html)) {
      const target = targetOf(dir, page, href, base);
      if (target && typeof target === 'object') broken.push({ page, href, missing: target.missing });
    }
  }
  return broken;
}

/** The named files a built page loads — a stylesheet, a script or a font — with the base of the build taken off. */
export function assetsOf(dir, base = baseOf(dir)) {
  const out = [];
  const FILE = /(?:href|src)="([^"]*\/assets\/[^"]+)"|url\((["']?)([^)"']*\/assets\/[^)"']+)\2\)/g;
  for (const page of walkHtml(dir)) {
    const html = readFileSync(join(dir, page), 'utf8');
    for (const m of html.matchAll(FILE)) {
      const path = withinBase(m[1] ?? m[3], base).replace(/^\/+/, '');
      if (path) out.push({ page, path, file: join(dir, path) });
    }
  }
  return out;
}

/** The files a built page loads that the build did not write: a build that lost one of them serves a blank page. */
export function checkAssets(dir, base = baseOf(dir)) {
  return assetsOf(dir, base)
    .filter((a) => !existsSync(a.file))
    .map(({ page, path }) => ({ page, missing: path }));
}

/**
 * Every page of the sources that exists in one language only. A page written for the site is `x.md` in English and
 * either `x.pt-BR.md` beside it or `pt-br/x.md` in the folder of its section, which is how the pages of this site
 * are written; a page built from a document — those of the reference — names its other language with a link labelled
 * in that language, since its address is derived from the document and the sources are not in the name's shape. A
 * page the repository writes in one language only carries the marker `<!-- site: one-language -->` and is not a
 * failure.
 */
export function checkLanguages(root) {
  const pages = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'scripts' && name !== 'public' && name !== 'generated') walk(full);
      } else if (name.endsWith('.md')) pages.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  // `README.md` is the note that explains this folder to whoever opens the repository; it is not a page of the site.
  const kept = pages.filter((page) => page !== 'README.md');
  const present = new Set(kept);
  const missing = [];
  for (const page of kept) {
    if (readFileSync(join(root, page), 'utf8').includes('site: one-language')) continue;
    if (candidatesOf(page).some((c) => present.has(c))) continue;
    const pair = otherLanguageLink(readFileSync(join(root, page), 'utf8'));
    const expected = referenceRoute(page.replace(/\.md$/, ''));
    // The link has to lead to this page's own pair: one that leads somewhere else, or nowhere, is the page that lost
    // its other language whatever it says.
    if (pair && pair.href.replace(/^\//, '').replace(/\.pt-br$/, '') === expected.replace(/^\//, '')) continue;
    missing.push(pair ? { page, missing: `the link to the other language points at ${pair.href}, not at ${expected}` } : { page, missing: candidatesOf(page)[0] });
  }
  return missing;
}

/** Both checks at once: what the site's CI step runs. */
export function checkSite(root, built) {
  const links = checkLinks(built ?? join(root, '.vitepress', 'dist'));
  const languages = checkLanguages(root);
  return { links, languages, ok: !links.length && !languages.length };
}

/** The document a page's other language would live in: the mark on its own name, or the `pt-br/` folder beside it. */
export function candidatesOf(page) {
  if (page.endsWith('.pt-BR.md')) return [page.replace(/\.pt-BR\.md$/, '.md')];
  const parts = page.split('/');
  const folded = parts[parts.length - 2] === 'pt-br' ? [...parts.slice(0, -2), ...parts.slice(-1)] : [...parts.slice(0, -1), 'pt-br', ...parts.slice(-1)];
  return [page.replace(/\.md$/, '.pt-BR.md'), folded.join('/')];
}
