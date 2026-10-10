// The site's own checks, at run time: every link of the built site resolves, the files a page loads are there, and
// every page that carries a language carries both. Pure Node over the built folder and the sources, so the suite can
// provoke each failure without a browser.
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
export function targetOf(dir, page, href, base = baseOf(dir)) {
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
 * Every page of the sources that exists in one language only. A page written for the site is `x.md` in English, and
 * its other half is the same name under the `pt-br/` folder of its section, which is the shape the pages of this site
 * are written in; a page built from a document — those of the reference — is served under `/reference/`, one address
 * per half, so it names its other language with a link labelled in that language. A page the repository writes in one
 * language only carries the marker `<!-- site: one-language -->` and is not a failure.
 *
 * The name and the link are two conditions, not alternatives. A page whose pair exists and whose text leads nowhere
 * is a page a reader cannot leave, so it is reported like a page that links to the wrong half; and a page whose link
 * leads to a page that is not its own pair is reported even when its pair is there, since the pair it names is not
 * the one the site serves it next to.
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
    const text = readFileSync(join(root, page), 'utf8');
    if (text.includes('site: one-language')) continue;
    const candidates = candidatesOf(page);
    const hasPair = candidates.some((c) => present.has(c));
    const folded = inFold(page) || candidates.some((c) => inFold(c) && present.has(c));
    const expected = pairRouteOf(page, folded);
    const pair = otherLanguageLink(text);
    const linked = pair && pairAddressesOf(pair).includes(expected);
    // The pair is enough for a page whose text names nothing: a page written by hand may reach its pair from the
    // navigation alone. A page that does name one names the pair it has, and a link that leads elsewhere is a page
    // that has lost its other language whatever its files say.
    if (hasPair && (!pair || linked)) continue;
    if (pair && !linked) {
      missing.push({ page, missing: `the link to the other language points at ${pair.href}, not at ${expected}` });
      continue;
    }
    // The page has no pair anywhere, so the failure is the name it would have: the shape its own section is written
    // in, which is the `pt-br/` folder beside it. The mark on a name of its own is what a page built from a document
    // uses, never one written by hand, so it is never the name the page is told to add.
    missing.push({ page, missing: pair ? `no page is served at ${pair.href}` : candidates[candidates.length - 1] });
  }
  return missing;
}

/** Both checks at once: what the site's CI step runs. */
export function checkSite(root, built) {
  const dir = built ?? join(root, '.vitepress', 'dist');
  const links = checkLinks(dir);
  const languages = checkLanguages(root);
  const assets = checkAssets(dir);
  return { links, assets, languages, ok: !links.length && !assets.length && !languages.length };
}

/**
 * The file the other language of a page lives in: the same name under the `pt-br/` folder of its section, which is
 * the shape the pages of this site are written in, or the mark of the language on a name of its own, which is what
 * the pages built from a document use. A page that already is the Portuguese half of its pair reaches the name it
 * mirrors, not a name of its own beyond that.
 */
export function candidatesOf(page) {
  const marked = /\.pt-BR\.md$/i.test(page) || /\.pt-br\.md$/i.test(page);
  const bare = page.replace(/\.pt-BR\.md$/i, '.md').replace(/\.pt-br\.md$/i, '.md');
  const parts = bare.split('/');
  if (marked) return [bare];
  if (parts[parts.length - 2] === 'pt-br') return [[...parts.slice(0, -2), ...parts.slice(-1)].join('/')];
  return [`${bare.slice(0, -'.md'.length)}.pt-BR.md`, `${bare.slice(0, -'.md'.length)}.pt-br.md`, [...parts.slice(0, -1), 'pt-br', ...parts.slice(-1)].join('/')];
}

/**
 * The address the other language of a page is served at, in the shape its own sources are written in. The pair of a
 * page lives in the `pt-br/` folder of its section unless the page is one of those the site builds from a document,
 * which is served under `/reference/`, one address per half.
 */
export function pairRouteOf(page, folded = inFold(page)) {
  const bare = page.replace(/\.md$/, '').replace(/\.pt-BR$/i, '').replace(/\.pt-br$/i, '');
  const marked = /\.pt-br$/i.test(page.replace(/\.md$/, ''));
  if (folded) {
    const parts = bare.split('/');
    return parts[parts.length - 2] === 'pt-br'
      ? `/${[...parts.slice(0, -2), parts[parts.length - 1]].join('/')}`
      : `/${[...parts.slice(0, -1), 'pt-br', parts[parts.length - 1]].join('/')}`;
  }
  return `${referenceRoute(`${bare}.md`)}${marked ? '' : '.pt-br'}`;
}

/** A page whose other half lives in the `pt-br/` folder of its section: `pt-br/index.md`, `guide/pt-br/install.md`. */
const inFold = (p) => /(^|\/)pt-br\//.test(p);

/** The address a page's own link to the other language names, without its anchor or a trailing slash. */
const pairAddressesOf = (pair) => {
  const target = pair.href.split('#')[0].split('?')[0];
  return [target.replace(/\/$/, ''), target.replace(/([^/])$/, '$1/')];
};