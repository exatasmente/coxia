// What the site cannot hold as files: one page per language of every reference document of `docs/`, the posts the
// blog opens with, and the history page — all of them written from the repository's own files into `site/generated/`,
// which is not versioned. VitePress scans its pages when it resolves the configuration, so this runs before the
// build, and nothing here is a second copy of the repository's text. It sits outside `.vitepress/` because the page
// scan does not walk into a dot-directory.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocksOf, pageFor, pagePath, referencePages, referenceRoute, titleOf } from '../scripts/docs-pages.mjs';
import { blogPosts, changelogOf, historyPage, postPage, versionOf } from '../scripts/changelog.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..', '..');
const docs = join(root, 'docs');
const README_AT_END = /README\.md$/;
export const sources = join(root, 'site', 'generated');

// The repository is public and its address is already in `package.json`: a document that links to a file of the
// repository which is not a page of the site (CONTRIBUTING.md, a cycle specification, a source folder) keeps working
// from the site as a link to the file on the host. The address is read from the manifest, never written by hand.
const repositoryUrl = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') ?? '';

/** The pages of the site, by the document they come from: what a link inside `docs/` can reach without leaving it. */
const referenceRoutes = new Map();
for (const path of referencePages(docs)) {
  const route = referenceRoute(path);
  referenceRoutes.set(path, route);
  referenceRoutes.set(path.replace(README_AT_END, ''), route);
  if (!pageFor(docs, path).single) referenceRoutes.set(path.replace(/\.md$/, '.pt-br') || path, pagePath(path, 'pt-BR'));
}

/** The address of a post's page, in the language it is read in. */
export const postPath = (post, lang) => `/blog/${lang === 'pt-BR' ? `pt-br/${post.slug}.pt-br` : post.slug}`;

/**
 * The text of a page, made safe for the generator's own compiler: a body may carry a `<stage>` or a `<nome>` as
 * ordinary text, and an unwrapped one would be read as a tag and break the build. Text inside a code span is left
 * alone, because the compiler already treats it as text and escaping it would show the entity itself.
 */
const escapeTags = (body) =>
  body
    .split(/(`+[^`]*`+)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/<\/?([A-Za-zÀ-ÿ][\wÀ-ÿ-]*)((?:\s[^<>]*)?)>/g, (_, name, attrs = '') => `&lt;${name}${attrs}&gt;`)))
    .join('');

/** Rewrites the relative links of one document: a document of the reference becomes its page, anything else the file on the host. */
function rewriteLinks(body, from) {
  return body.replace(/(\]\()([^)\s]+)(\))/g, (whole, open, href, close) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return whole;
    const [path, anchor = ''] = href.split(/(?=#)/);
    const target = resolve(dirname(join(docs, from)), path);
    const inside = target.startsWith(docs + '/') || target === docs;
    if (inside) {
      const rel = target.slice(docs.length + 1);
      const page = referenceRoutes.get(rel) ?? referenceRoutes.get(target.slice(docs.length + 1));
      if (page) return `${open}${page}${anchor}${close}`;
    }
    const repoPath = relative(root, target).split(sep).join('/');
    return repositoryUrl ? `${open}${repositoryUrl}/blob/main/${repoPath}${anchor}${close}` : whole;
  });
}

/** A generated page: its front matter, and its body handed over as the generator's own text container. */
const rendered = (title, body) => `---\ntitle: ${JSON.stringify(title)}\neditLink: false\n---\n\n${escapeTags(body)}\n`;

/** The words the link to the other language of a page carries, which is the language it leads to. */
const OTHER_LANGUAGES = [{ lang: 'pt-BR', word: 'Português' }, { lang: 'en', word: 'English' }];

/**
 * One reference document as a page: its title, its body, and whether the repository writes it in one language only.
 * A document the repository writes in both opens a page per language, and each names the other with a link: the
 * address language of a page is built here, and the site's check reads the same link to see that the pair is there.
 */
function view(path, want) {
  const text = readFileSync(join(docs, path), 'utf8');
  const blocks = blocksOf(text);
  const pt = blocks.find((b) => b.lang === 'pt-BR');
  const en = blocks.find((b) => b.lang === 'en')?.body ?? text;
  const body = want === 'pt-BR' ? pt?.body : en;
  const other = OTHER_LANGUAGES.find((o) => o.lang !== want);
  const pair = pt ? `\n\n---\n\n[${other.word}](${pagePath(path, other.lang)} "${other.word}")\n` : '';
  return { title: titleOf(path, text, want), body: `${rewriteLinks(body ?? '', path)}${pair}`, single: !pt };
}

/**
 * Where each generated page is served. The site writes them under `generated/`, which the page scan sees, and this
 * is what gives them the addresses the rest of the site links to: a reference page derives from the document's own
 * path, and a post from the version it is about.
 */
export function rewritesOf() {
  const rules = {};
  for (const path of referencePages(docs)) {
    const bare = referenceRoute(path).replace(/^\/reference\//, '');
    rules[`generated/reference/${bare}.md`] = `reference/${bare}.md`;
    if (!pageFor(docs, path).single) rules[`generated/reference/${bare}.pt-br.md`] = `reference/${bare}.pt-br.md`;
  }
  for (const post of blogPosts(changelogOf(root).sections)) {
    rules[`generated/blog/${post.slug}.md`] = `blog/${post.slug}.md`;
    rules[`generated/blog/pt-br/${post.slug}.pt-br.md`] = `blog/pt-br/${post.slug}.pt-br.md`;
  }
  rules['generated/blog/index.md'] = 'blog/index.md';
  rules['generated/blog/pt-br/index.pt-br.md'] = 'blog/pt-br/index.pt-br.md';
  rules['generated/changelog.md'] = 'changelog.md';
  rules['generated/changelog.pt-br.md'] = 'changelog.pt-br.md';
  return rules;
}

export function writeSources() {
  if (existsSync(sources)) rmSync(sources, { recursive: true, force: true });
  mkdirSync(sources, { recursive: true });

  for (const path of referencePages(docs)) {
    const page = pageFor(docs, path);
    const bare = referenceRoute(path).replace(/^\/reference\//, '');
    for (const want of page.single ? [page.lang] : ['en', 'pt-BR']) {
      const { title, body, single } = view(path, want);
      const target = join(sources, 'reference', `${bare}${want === 'pt-BR' ? '.pt-br' : ''}.md`);
      mkdirSync(dirname(target), { recursive: true });
      const marker = single ? '\n<!-- site: one-language: the repository writes this document in one language only -->\n' : '';
      writeFileSync(target, `${rendered(title, body)}${marker}`);
    }
  }

  const posts = blogPosts(changelogOf(root).sections);
  for (const lang of ['en', 'pt-BR']) {
    const pt = lang === 'pt-BR';
    const list = posts.map((p) => `- [${p.title}](${postPath(p, lang)})`).join('\n');
    const head = pt
      ? 'Um texto por versão publicada, escrito a partir da seção daquela versão no histórico de mudanças do repositório.'
      : 'A post per released version, written from that version’s section of the repository’s changelog.';
    const at = (rest) => join(sources, rest);
    mkdirSync(dirname(at(pt ? 'blog/pt-br/index.pt-br.md' : 'blog/index.md')), { recursive: true });
    writeFileSync(at(pt ? 'blog/pt-br/index.pt-br.md' : 'blog/index.md'), `# Blog\n\n${head}\n\n${list}\n`);
    writeFileSync(at(pt ? 'changelog.pt-br.md' : 'changelog.md'), rendered('Changelog', rewriteLinks(historyPage(root, lang), 'CHANGELOG.md')));
    for (const post of posts) {
      writeFileSync(at(pt ? `blog/pt-br/${post.slug}.pt-br.md` : `blog/${post.slug}.md`), rendered(post.title, rewriteLinks(postPage(post, lang), 'CHANGELOG.md')));
    }
  }
  return { pages: referencePages(docs), posts, version: versionOf(root) };
}

/** What the build and the check both read: the reference pages, the posts and the version of the repository. */
export function contentOf() {
  const sections = changelogOf(root).sections;
  return { pages: referencePages(docs).map((path) => ({ path, page: pageFor(docs, path) })), posts: blogPosts(sections), version: versionOf(root) };
}
