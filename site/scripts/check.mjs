// The site's own checks, at run time: every link of the built site resolves, and every page that carries a language
// carries both. Pure Node over the built folder, so the suite can provoke each failure without a browser.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HREF = /\bhref="([^"]+)"/g;

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

/** Where a link must land in the built folder: the file the server would serve for it. */
export function targetOf(dir, page, href) {
  const path = href.split('#')[0].split('?')[0];
  if (!path) return null;
  const from = path.startsWith('/') ? join(dir, path) : resolve(dir, dirname(page), path);
  for (const candidate of [from, join(from, 'index.html'), `${from}.html`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(dir, candidate).split(sep).join('/');
  }
  return { missing: relative(dir, from).split(sep).join('/') };
}

/** Every link of the built site that points at a page the site does not have. */
export function checkLinks(dir) {
  const broken = [];
  for (const page of walkHtml(dir)) {
    const html = readFileSync(join(dir, page), 'utf8');
    for (const href of linksOf(html)) {
      const target = targetOf(dir, page, href);
      if (target && typeof target === 'object') broken.push({ page, href, missing: target.missing });
    }
  }
  return broken;
}

/**
 * Every page of the sources that exists in one language only. A page written for the site is `x.md` in English and
 * either `x.pt-BR.md` beside it or `pt-br/x.md` in the folder of its section, which is how the pages of this site
 * are written; a generated reference page the repository writes in one language only carries the marker
 * `<!-- site: one-language -->` and is not a failure.
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
    // The other language of a page: the mark on its own name, or the `pt-br/` folder beside it.
    const candidates = [];
    if (page.endsWith('.pt-BR.md')) candidates.push(page.replace(/\.pt-BR\.md$/, '.md'));
    else {
      candidates.push(page.replace(/\.md$/, '.pt-BR.md'));
      const parts = page.split('/');
      candidates.push(parts[parts.length - 2] === 'pt-br' ? [...parts.slice(0, -2), ...parts.slice(-1)].join('/') : [...parts.slice(0, -1), 'pt-br', ...parts.slice(-1)].join('/'));
    }
    if (!candidates.some((c) => present.has(c))) missing.push({ page, missing: candidates[0] });
  }
  return missing;
}

/** Both checks at once: what the site's CI step runs. */
export function checkSite(root, built) {
  const links = checkLinks(built ?? join(root, '.vitepress', 'dist'));
  const languages = checkLanguages(root);
  return { links, languages, ok: !links.length && !languages.length };
}
