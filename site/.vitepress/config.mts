// The site of the repository: a landing page, the guide, the reference documentation of `docs/`, the use cases and
// the blog. Everything that can come from the repository's own files does: the reference is read where the documents
// already are, and the history and the blog come from `CHANGELOG.md` at build time. Nothing here is a second copy.
import { defineConfig } from 'vitepress';
import { pagePath } from '../scripts/docs-pages.mjs';
import { contentOf, postPath, rewritesOf, writeSources } from './build-sources.mjs';

// VitePress scans its pages when it resolves its configuration, before any hook of the build, so the generated
// sources are written while this module and its imports are evaluated: `vitepress build site`, `vitepress dev site`
// and `docs:check` all land here. The rewrites are what serves them at the addresses the rest of the site links to.
writeSources();

const { pages, posts, version } = contentOf();

const navigation = [
  { text: 'Guide', link: '/guide/' },
  { text: 'Reference', link: '/reference/' },
  { text: 'Use cases', link: '/use-cases/' },
  { text: 'Blog', link: '/blog/' },
  { text: 'Changelog', link: '/changelog' },
];

export default defineConfig({
  title: 'Coxia',
  description: 'Voice ceremonies and an agent fleet over a repository’s development cycle.',
  cleanUrls: true,
  // The site lives under the repository's own address on the host, so nothing here hard-codes it: the address comes
  // from the workflow when the site is published, and the local preview is served from the root.
  base: process.env.SITE_BASE ?? '/',
  srcExclude: ['README.md'],
  // The generated pages live under `generated/` and are served at the addresses the rest of the site links to.
  rewrites: rewritesOf(),
  transformPageData(pageData) {
    pageData.siteVersion = version;
  },
  themeConfig: {
    nav: navigation,
    sidebar: {
      '/guide/': [{ text: 'Guide', items: [
        { text: 'Install', link: '/guide/install' },
        { text: 'Your first workspace', link: '/guide/workspace' },
        { text: 'Your first ceremony', link: '/guide/ceremony' },
        { text: 'Your first run', link: '/guide/run' },
      ] }],
      '/use-cases/': [{ text: 'Use cases', items: [
        { text: 'One developer, a team of agents', link: '/use-cases/team' },
        { text: 'From an issue to a pull request', link: '/use-cases/issue-to-pr' },
        { text: 'A login on a virtual screen', link: '/use-cases/screen' },
        { text: 'The paired phone approves', link: '/use-cases/phone' },
      ] }],
      // Derived from the folder on every build: a document that lands in `docs/` needs no list edited here.
      '/reference/': [{ text: 'Reference', items: pages.map((p) => ({ text: p.page.title, link: pagePath(p.path, 'en') })) }],
      '/blog/': [{ text: 'Blog', items: [{ text: 'All posts', link: '/blog/' }, ...posts.map((p) => ({ text: p.title, link: postPath(p, 'en') }))] }],
    },
    socialLinks: [],
    footer: { message: 'Published from the repository’s own documentation.', copyright: `Coxia ${version}` },
  },
});

// The generated folder, for the check that reads the sources the site actually built.
export { content, postPath };
